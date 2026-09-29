import { createMachineTokenProvider } from '@unified-auth/machine-token-provider';
import { env } from './config.js';
import {
  buildAttentionView,
  type AssistancePageWire,
  type AttentionSourceAvailability,
  type AttentionView,
  type ExecutionAttentionItemWire,
  type ExecutionAttentionResponseWire,
  type HumanRequiredAssistanceCaseWire,
  type OwnerAssistanceCaseWire,
  type RawAttentionSources,
} from './attention.js';

export interface ExecutionSourceDependencies {
  baseUrl: string;
  tokenProvider: () => Promise<string>;
}

export interface AttentionClientDependencies {
  baseUrl: string;
  tokenProvider: () => Promise<string>;
  requestTimeoutMs: number;
  fetch: typeof fetch;
  /** dsh-agent-core execution attention source; absent = source unavailable. */
  execution?: ExecutionSourceDependencies | null;
}

export interface AttentionClient {
  fetchAttention(): Promise<AttentionView>;
}

class SourceHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  requestTimeoutMs: number,
  tokenProvider: () => Promise<string>,
  url: string,
): Promise<T> {
  const token = await tokenProvider();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(new URL(url), {
      method: 'GET',
      headers: { authorization: 'Bearer ' + token },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SourceHttpError(
        response.status,
        'attention read failed: HTTP ' + response.status,
      );
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPaged<T>(
  deps: AttentionClientDependencies,
  path: string,
  cursorField: 'beforeCreatedAt' | 'beforeEscalatedAt',
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: { at: string; id: string } | null = null;

  do {
    const url = new URL(path, deps.baseUrl);
    url.searchParams.set('limit', '100');
    if (cursor) {
      const key = cursor.at + '|' + cursor.id;
      if (seenCursors.has(key)) {
        throw new Error('ATTENTION_PAGINATION_STALL: ' + key);
      }
      seenCursors.add(key);
      url.searchParams.set(cursorField, cursor.at);
      url.searchParams.set('beforeId', cursor.id);
    }

    const page = await fetchJson<AssistancePageWire<T>>(
      deps.fetch,
      deps.requestTimeoutMs,
      deps.tokenProvider,
      url.toString(),
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}

async function sourceOrUnavailable<T>(
  fn: () => Promise<T[]>,
): Promise<{ availability: AttentionSourceAvailability; items: T[] }> {
  try {
    return { availability: { available: true }, items: await fn() };
  } catch (error) {
    if (
      error instanceof SourceHttpError
      && (error.status === 403 || error.status === 404)
    ) {
      return {
        availability: { available: false, reason: 'HTTP_' + error.status },
        items: [],
      };
    }
    throw error;
  }
}

type ExecutionSourceResult = RawAttentionSources['execution'];

async function fetchExecutionAttention(
  deps: AttentionClientDependencies,
  exec: ExecutionSourceDependencies,
): Promise<ExecutionAttentionResponseWire> {
  const url = new URL('/workflow-execution/attention', exec.baseUrl);
  // dsh contract: the attention summary is zero-parameter — send no query.
  return fetchJson<ExecutionAttentionResponseWire>(
    deps.fetch,
    deps.requestTimeoutMs,
    exec.tokenProvider,
    url.toString(),
  );
}

/**
 * The execution source is read-only supplementary evidence: ANY failure
 * (not configured, 401/403/404/503, transport) degrades to an explicit
 * `unavailable` reason instead of hiding svc-workflow assistance or
 * crashing the command. Records are never fabricated.
 */
async function executionSourceOrUnavailable(
  deps: AttentionClientDependencies,
): Promise<ExecutionSourceResult> {
  const exec = deps.execution;
  if (!exec || !exec.baseUrl) {
    return {
      availability: { available: false, reason: 'DSH_BASE_URL_NOT_CONFIGURED' },
      items: [],
    };
  }
  try {
    const body = await fetchExecutionAttention(deps, exec);
    return {
      availability: { available: true },
      items: Array.isArray(body.items) ? body.items : [],
      ...(body.counts ? { counts: body.counts } : {}),
      ...(body.generatedAtMs !== undefined ? { generatedAtMs: body.generatedAtMs } : {}),
    };
  } catch (error) {
    const reason = error instanceof SourceHttpError
      ? 'HTTP_' + error.status
      : 'DSH_UNREACHABLE (' + (error instanceof Error ? error.message : String(error)) + ')';
    return {
      availability: { available: false, reason },
      items: [],
    };
  }
}

export function createAttentionClient(
  deps: AttentionClientDependencies,
): AttentionClient {
  if (!deps.baseUrl) {
    throw new Error('SVC_WORKFLOW_BASE_URL is required for attention');
  }
  if (typeof deps.tokenProvider !== 'function') {
    throw new Error('tokenProvider is required for attention');
  }
  if (!Number.isFinite(deps.requestTimeoutMs) || deps.requestTimeoutMs <= 0) {
    throw new Error('requestTimeoutMs must be positive');
  }

  return {
    async fetchAttention(): Promise<AttentionView> {
      const [owner, human, execution] = await Promise.all([
        sourceOrUnavailable(() => fetchPaged<OwnerAssistanceCaseWire>(
          deps,
          '/internal/v1/assistance-cases/owner-inbox',
          'beforeCreatedAt',
        )),
        sourceOrUnavailable(() => fetchPaged<HumanRequiredAssistanceCaseWire>(
          deps,
          '/internal/v1/assistance-cases/human-required',
          'beforeEscalatedAt',
        )),
        executionSourceOrUnavailable(deps),
      ]);

      const raw: RawAttentionSources = { owner, human, execution };
      return buildAttentionView(raw);
    },
  };
}

export function createAttentionClientFromEnv(): AttentionClient {
  const requestTimeoutMs = Number.parseInt(env.REQUEST_TIMEOUT_MS, 10);
  const doFetch = globalThis.fetch;

  const tokenProvider = createMachineTokenProvider({
    tokenEndpoint: env.SVC_AUTH_TOKEN_ENDPOINT,
    clientId: env.SVC_AUTH_MACHINE_CLIENT_ID,
    credentialProvider: () => env.SVC_AUTH_MACHINE_CLIENT_SECRET,
    resource: env.SVC_AUTH_MACHINE_RESOURCE,
    scopes: ['workflow.read'],
    timeoutMs: requestTimeoutMs,
    fetch: doFetch,
  });

  // The dsh execution attention endpoint requires a token carrying
  // `workflow.execute`; it is minted from the same machine credential with
  // its own resource/scope configuration. No static token is ever used.
  const dshBaseUrl = env.DSH_AGENT_CORE_BASE_URL;
  const execution: ExecutionSourceDependencies | null = dshBaseUrl
    ? {
        baseUrl: dshBaseUrl,
        tokenProvider: createMachineTokenProvider({
          tokenEndpoint: env.SVC_AUTH_TOKEN_ENDPOINT,
          clientId: env.SVC_AUTH_MACHINE_CLIENT_ID,
          credentialProvider: () => env.SVC_AUTH_MACHINE_CLIENT_SECRET,
          resource: env.DSH_AUTH_MACHINE_RESOURCE,
          scopes: env.DSH_AUTH_MACHINE_SCOPES.split(',').map((s) => s.trim()).filter(Boolean),
          timeoutMs: requestTimeoutMs,
          fetch: doFetch,
        }),
      }
    : null;

  return createAttentionClient({
    baseUrl: env.SVC_WORKFLOW_BASE_URL,
    tokenProvider,
    requestTimeoutMs,
    fetch: doFetch,
    execution,
  });
}
