import { createMachineTokenProvider } from '@unified-auth/machine-token-provider';
import { env } from './config.js';
import {
  buildAttentionView,
  type AssistancePageWire,
  type AttentionSourceAvailability,
  type AttentionView,
  type HumanRequiredAssistanceCaseWire,
  type OwnerAssistanceCaseWire,
  type RawAttentionSources,
} from './attention.js';

export interface AttentionClientDependencies {
  baseUrl: string;
  tokenProvider: () => Promise<string>;
  requestTimeoutMs: number;
  fetch: typeof fetch;
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
  deps: AttentionClientDependencies,
  pathOrUrl: string,
): Promise<T> {
  const token = await deps.tokenProvider();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.requestTimeoutMs);

  try {
    const response = await deps.fetch(new URL(pathOrUrl, deps.baseUrl), {
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

    const page = await fetchJson<AssistancePageWire<T>>(deps, url.toString());
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
      const [owner, human] = await Promise.all([
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
      ]);

      const raw: RawAttentionSources = { owner, human };
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

  return createAttentionClient({
    baseUrl: env.SVC_WORKFLOW_BASE_URL,
    tokenProvider,
    requestTimeoutMs,
    fetch: doFetch,
  });
}
