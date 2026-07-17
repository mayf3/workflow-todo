import type {
  CreateWorkflowInstanceInput,
  CreateWorkflowInstanceResult,
  ExecuteWorkflowTransitionInput,
  ExecuteWorkflowTransitionResult,
  WorkflowClientConfig,
  WorkflowInstanceDetail,
  WorklistPage,
  WriteOptions,
} from './contracts.js';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly kind: 'configuration' | 'transport' | 'api' | 'protocol' | 'input',
    public readonly operation?: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly attempts?: number,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [250, 500];

export class WorkflowClient {
  private readonly baseUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly config: WorkflowClientConfig) {
    this.baseUrl = new URL(config.baseUrl);
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (this.maxAttempts < 1 || this.maxAttempts > 3) {
      throw new WorkflowError('maxAttempts must be 1-3', 'configuration');
    }
  }

  async assertSmokeReady(): Promise<void> {
    await this.request({ method: 'GET', path: '/version', authenticated: false });
    await this.request({ method: 'GET', path: '/readyz', authenticated: false });
  }

  async create(
    input: CreateWorkflowInstanceInput,
    options: WriteOptions,
  ): Promise<CreateWorkflowInstanceResult> {
    return this.request({
      method: 'POST',
      path: '/internal/v1/workflow-instances',
      body: input,
      idempotencyKey: options.idempotencyKey,
      parseSuccess: (data) => {
        validateShape(data, {
          workflowInstanceId: 'string',
          workflowStateVersion: 'number',
          currentContextRevisionId: 'string',
          currentNodeVisitId: 'string',
          eventSequence: 'number',
        });
        return data as CreateWorkflowInstanceResult;
      },
    });
  }

  async detail(workflowInstanceId: string): Promise<WorkflowInstanceDetail> {
    return this.request({
      method: 'GET',
      path: `/internal/v1/workflow-instances/${encodeURIComponent(workflowInstanceId)}`,
      parseSuccess: (data) => {
        if (
          typeof data !== 'object' ||
          data === null ||
          typeof (data as Record<string, unknown>).visibility !== 'string'
        ) {
          throw new WorkflowError('invalid detail response shape', 'protocol');
        }
        return data as WorkflowInstanceDetail;
      },
    });
  }

  async transition(
    workflowInstanceId: string,
    input: ExecuteWorkflowTransitionInput,
    options: WriteOptions,
  ): Promise<ExecuteWorkflowTransitionResult> {
    return this.request({
      method: 'POST',
      path: `/internal/v1/workflow-instances/${encodeURIComponent(workflowInstanceId)}/transitions`,
      body: input,
      idempotencyKey: options.idempotencyKey,
      parseSuccess: (data) => {
        validateShape(data, {
          workflowInstanceId: 'string',
          workflowStateVersion: 'number',
          currentContextRevisionId: 'string',
          sourceNodeVisitId: 'string',
          currentNodeVisitId: 'string',
          eventSequence: 'number',
        });
        return data as ExecuteWorkflowTransitionResult;
      },
    });
  }

  async worklistAssignedToMe(
    before?: { createdAt: string; id: string },
    limit?: number,
  ): Promise<WorklistPage> {
    const params = new URLSearchParams();
    if (before) {
      params.set('beforeCreatedAt', before.createdAt);
      params.set('beforeId', before.id);
    }
    if (limit !== undefined) params.set('limit', String(limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.request({
      method: 'GET',
      path: `/internal/v1/worklists/assigned-to-me${suffix}`,
      parseSuccess: (data) => data as WorklistPage,
    });
  }

  // -----------------------------------------------------------------------
  // Internal request plumbing
  // -----------------------------------------------------------------------

  private async request<T>(spec: {
    method: string;
    path: string;
    body?: unknown;
    idempotencyKey?: string;
    authenticated?: boolean;
    parseSuccess?: (data: unknown) => T;
  }): Promise<T> {
    const token =
      spec.authenticated === false
        ? undefined
        : await this.config.accessTokenProvider();

    const url = new URL(spec.path, this.baseUrl);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
    if (spec.idempotencyKey !== undefined) {
      validateIdempotencyKey(spec.idempotencyKey);
      headers['Idempotency-Key'] = spec.idempotencyKey;
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: spec.method,
          headers,
          body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        const transport = error instanceof DOMException && error.name === 'AbortError'
          ? 'timeout'
          : 'network';
        if (attempt < this.maxAttempts) {
          await this.sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
          continue;
        }
        throw new WorkflowError(`svc-workflow ${transport} failure`, 'transport', spec.path, undefined, undefined, attempt);
      }

      const text = await response.text();
      const operation = spec.path;

      if (response.ok) {
        try {
          const parsed = JSON.parse(text);
          return spec.parseSuccess ? spec.parseSuccess(parsed) : (parsed as T);
        } catch {
          throw new WorkflowError('svc-workflow returned an invalid response', 'protocol', operation, response.status, undefined, attempt);
        }
      }

      // Error handling
      const envelope = tryParseErrorEnvelope(text);
      const errorCode = envelope?.error?.code;
      const retry = attempt < this.maxAttempts && isRetryableResponse(response.status, errorCode);

      if (retry) {
        await this.sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
        continue;
      }

      if (envelope?.error) {
        throw new WorkflowError(
          envelope.error.message ?? 'unknown error',
          'api',
          operation,
          response.status,
          envelope.error.code,
          attempt,
        );
      }

      throw new WorkflowError('svc-workflow returned an error', 'protocol', operation, response.status, undefined, attempt);
    }

    throw new WorkflowError('svc-workflow request failed after all attempts', 'protocol', spec.path, undefined, undefined, this.maxAttempts);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateShape(data: unknown, shape: Record<string, string>): void {
  if (typeof data !== 'object' || data === null) {
    throw new WorkflowError('invalid response shape', 'protocol');
  }
  const obj = data as Record<string, unknown>;
  for (const [key, type] of Object.entries(shape)) {
    if (typeof obj[key] !== type) {
      throw new WorkflowError(`expected ${key} to be ${type}`, 'protocol');
    }
  }
}

function validateIdempotencyKey(value: string): void {
  if (
    value.length < 1 ||
    value.length > 128 ||
    ![...value].every((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x21 && code <= 0x7e;
    })
  ) {
    throw new WorkflowError(
      'Idempotency-Key must be 1-128 visible ASCII characters',
      'input',
    );
  }
}

function tryParseErrorEnvelope(text: string): { error?: { code?: string; message?: string } } | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRetryableResponse(status: number, code?: string): boolean {
  return (
    status === 503 ||
    (status === 425 && code === 'command_still_processing') ||
    (status === 408 && code === 'request_timeout')
  );
}
