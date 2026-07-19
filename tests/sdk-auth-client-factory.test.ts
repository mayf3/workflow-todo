/**
 * Tests for SDK Auth Client Factory
 *
 * Tests:
 * - Factory eagerly validates required config
 * - MachineTokenProvider is created with correct scopes
 * - Provider Token is injected into Workflow SDK
 * - Auth failure does not call Workflow (fail-closed)
 * - No static token fallback
 * - No admin token fallback
 * - Secret and Token do not enter logs
 * - Create/advance use correct scopes
 */

import { describe, expect, it } from 'vitest';
import { createSdkAuthWorkflowClient } from '../src/sdk-auth-client-factory.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockResponse {
  status: number;
  body: Record<string, unknown> | string;
  headers?: Record<string, string>;
}

/**
 * Safely extract URL string from RequestInfo | URL
 */
function urlStr(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  // Request object
  return input.url;
}

/**
 * Create a mock fetch implementation for testing.
 * The first call is expected to be the auth token request (POST /oauth/token),
 * and subsequent calls are workflow API calls.
 */
function makeMockFetch(responses: MockResponse[]): typeof fetch {
  let callIndex = 0;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const idx = callIndex;
    callIndex++;

    if (idx >= responses.length) {
      return new Response(JSON.stringify({ error: 'unexpected call' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const mock = responses[idx];
    const bodyStr = typeof mock.body === 'string' ? mock.body : JSON.stringify(mock.body);

    return new Response(bodyStr, {
      status: mock.status,
      headers: {
        'Content-Type': 'application/json',
        ...mock.headers,
      },
    });
  };
}

/**
 * Success response from the auth token endpoint.
 * Returns a fake access token with 1 hour expiry.
 */
function makeAuthSuccess(overrides?: Partial<{ accessToken: string; expiresIn: number }>): MockResponse {
  return {
    status: 200,
    body: {
      access_token: overrides?.accessToken ?? 'mock-access-token-for-testing',
      token_type: 'Bearer',
      expires_in: overrides?.expiresIn ?? 3600,
    },
  };
}

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
const VALID_DEF_ID = '00000000-0000-4000-8000-000000000002';
const VALID_DOMAIN_ID = '00000000-0000-4000-8000-000000000003';

/**
 * Success response from the workflow worklist endpoint.
 */
function makeWorklistSuccess(items = 0): MockResponse {
  const entries = [];
  for (let i = 0; i < items; i++) {
    entries.push({
      detail: {
        instance: {
          workflow_instance_id: VALID_UUID,
          domain_id: VALID_DOMAIN_ID,
          definition_version_id: VALID_DEF_ID,
          definition_version_status: 'PUBLISHED',
          created_by_principal_id: '00000000-0000-4000-8000-000000000010',
          workflow_state_version: 1,
          external_reference: null,
          external_url: null,
          metadata: null,
          created_at: '2026-07-17T14:20:00Z',
          domain_enabled: true,
          is_terminal: false,
          current_node: {
            node_id: '00000000-0000-4000-8000-000000000020',
            node_key: 'propose',
            display_name: 'Propose',
            node_type: 'DRAFT',
          },
        },
        current_context_revision_id: '00000000-0000-4000-8000-000000000030',
        current_node_visit_id: '00000000-0000-4000-8000-000000000040',
        current_context: {
          context_revision_id: '00000000-0000-4000-8000-000000000030',
          workflow_instance_id: VALID_UUID,
          revision_number: 1,
          previous_revision_id: null,
          payload: { title: `Item ${i + 1}` },
          payload_digest: 'd1',
          created_by_principal_id: '00000000-0000-4000-8000-000000000010',
          created_at: '2026-07-17T14:20:00Z',
        },
        current_visit: {
          node_visit_id: '00000000-0000-4000-8000-000000000040',
          workflow_instance_id: VALID_UUID,
          node: {
            node_id: '00000000-0000-4000-8000-000000000020',
            node_key: 'propose',
            display_name: 'Propose',
            node_type: 'DRAFT',
          },
          visit_number: 1,
          assignee_principal_id: '00000000-0000-4000-8000-000000000010',
          entered_by_transition_id: null,
          instructions: null,
          created_at: '2026-07-17T14:20:00Z',
        },
        outgoing_transitions: [],
      },
      upstream_submissions: [],
      return_feedback_events: [],
      submissions_truncated: false,
      return_events_truncated: false,
    });
  }
  return {
    status: 200,
    body: { items: entries, next_cursor: null },
  };
}

function makeCreateSuccess(): MockResponse {
  return {
    status: 200,
    body: {
      workflowInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workflowStateVersion: 1,
      currentContextRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      currentNodeVisitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      eventSequence: 1,
    },
  };
}

function makeDetailWithAdvance(): MockResponse {
  return {
    status: 200,
    body: {
      visibility: 'full',
      detail: {
        instance: {
          workflow_instance_id: VALID_UUID,
          domain_id: VALID_DOMAIN_ID,
          definition_version_id: VALID_DEF_ID,
          definition_version_status: 'PUBLISHED',
          created_by_principal_id: '00000000-0000-4000-8000-000000000010',
          workflow_state_version: 5,
          external_reference: null,
          external_url: null,
          metadata: null,
          created_at: '2026-07-17T14:20:00Z',
          domain_enabled: true,
          is_terminal: false,
          current_node: {
            node_id: '00000000-0000-4000-8000-000000000021',
            node_key: 'efficiency_check',
            display_name: 'Efficiency Check',
            node_type: 'APPROVAL',
          },
        },
        current_context_revision_id: '00000000-0000-4000-8000-000000000031',
        current_node_visit_id: '00000000-0000-4000-8000-000000000041',
        current_context: null,
        current_visit: null,
        outgoing_transitions: [
          {
            transition_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            transition_effect: 'ADVANCE',
            executable_for_actor: true,
            blocked_reason: null,
            target_node: {
              node_id: '00000000-0000-4000-8000-000000000022',
              node_key: 'completed',
              display_name: 'Completed',
              node_type: 'TERMINAL',
            },
          },
        ],
      },
    },
  };
}

function makeTransitionSuccess(): MockResponse {
  return {
    status: 200,
    body: {
      workflowInstanceId: VALID_UUID,
      workflowStateVersion: 6,
      currentContextRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sourceNodeVisitId: '00000000-0000-4000-8000-000000000041',
      currentNodeVisitId: '00000000-0000-4000-8000-000000000042',
      submissionId: null,
      eventSequence: 3,
    },
  };
}

// ---------------------------------------------------------------------------
// Factory config validation
// ---------------------------------------------------------------------------

describe('createSdkAuthWorkflowClient config validation', () => {
  it('throws when baseUrl is missing', () => {
    expect(() =>
      createSdkAuthWorkflowClient({
        baseUrl: '',
        tokenEndpoint: 'http://auth/token',
        clientId: 'mc_test',
        credentialProvider: () => 'secret',
        resource: 'svc-workflow',
        scopes: ['workflow.read'],
        requestTimeoutMs: 5000,
        fetch: makeMockFetch([]),
      }),
    ).toThrow('SVC_WORKFLOW_BASE_URL is required');
  });

  it('throws when tokenEndpoint is missing', () => {
    expect(() =>
      createSdkAuthWorkflowClient({
        baseUrl: 'http://workflow/api',
        tokenEndpoint: '',
        clientId: 'mc_test',
        credentialProvider: () => 'secret',
        resource: 'svc-workflow',
        scopes: ['workflow.read'],
        requestTimeoutMs: 5000,
        fetch: makeMockFetch([]),
      }),
    ).toThrow('SVC_AUTH_TOKEN_ENDPOINT is required');
  });

  it('throws when clientId is missing', () => {
    expect(() =>
      createSdkAuthWorkflowClient({
        baseUrl: 'http://workflow/api',
        tokenEndpoint: 'http://auth/token',
        clientId: '',
        credentialProvider: () => 'secret',
        resource: 'svc-workflow',
        scopes: ['workflow.read'],
        requestTimeoutMs: 5000,
        fetch: makeMockFetch([]),
      }),
    ).toThrow('SVC_AUTH_MACHINE_CLIENT_ID is required');
  });

  it('accepts valid minimal config', () => {
    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'mock-secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: makeMockFetch([makeAuthSuccess(), makeWorklistSuccess(0)]),
    });
    expect(client).toBeDefined();
    expect(typeof client.worklistAssignedToMe).toBe('function');
  });

  it('rejects credential provider that throws at call time', async () => {
    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => { throw new Error('secret loading failed'); },
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: makeMockFetch([]),
    });

    // The error from credentialProvider is caught by the MachineTokenProvider
    // and rethrown as ConfigurationError
    await expect(client.worklistAssignedToMe()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scope usage
// ---------------------------------------------------------------------------

describe('scope usage', () => {
  it('uses workflow.read scope for read operations', async () => {
    const capturedAuthBodies: string[] = [];

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      // Auth token request (endpoint is http://auth/token)
      if (url.includes('/token')) {
        capturedAuthBodies.push(init?.body?.toString() ?? '');
        return new Response(JSON.stringify({
          access_token: 'mock-read-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Workflow worklist request
      return new Response(JSON.stringify({ items: [], next_cursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await client.worklistAssignedToMe();

    expect(capturedAuthBodies.length).toBe(1);
    expect(capturedAuthBodies[0]).toContain('workflow.read');
  });

  it('uses workflow.execute scope for create operations', async () => {
    const capturedAuthBodies: string[] = [];

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        capturedAuthBodies.push(init?.body?.toString() ?? '');
        return new Response(JSON.stringify({
          access_token: 'mock-write-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        workflowInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workflowStateVersion: 1,
        currentContextRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        currentNodeVisitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        eventSequence: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.execute'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await client.create(
      {
        domainId: VALID_DOMAIN_ID,
        definitionVersionId: VALID_DEF_ID,
        metadata: {},
        contextPayload: { title: 'test' },
      },
      { idempotencyKey: 'create-test-12345' },
    );

    expect(capturedAuthBodies.length).toBe(1);
    expect(capturedAuthBodies[0]).toContain('workflow.execute');
    expect(capturedAuthBodies[0]).not.toContain('workflow.read');
  });

  it('supports multiple scopes when configured', async () => {
    const capturedAuthBodies: string[] = [];

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        capturedAuthBodies.push(init?.body?.toString() ?? '');
        return new Response(JSON.stringify({
          access_token: 'mock-scope-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ items: [], next_cursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read', 'workflow.execute'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await client.worklistAssignedToMe();

    expect(capturedAuthBodies.length).toBe(1);
    expect(capturedAuthBodies[0]).toContain('workflow.read');
    expect(capturedAuthBodies[0]).toContain('workflow.execute');
  });
});

// ---------------------------------------------------------------------------
// Auth failure behavior (fail-closed)
// ---------------------------------------------------------------------------

describe('auth failure handling', () => {
  it('fails closed when auth returns 401', async () => {
    let workflowCalled = false;

    const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        return new Response(JSON.stringify({ error: 'invalid_client' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // If this gets called, the test fails
      workflowCalled = true;
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await expect(client.worklistAssignedToMe()).rejects.toThrow();
    expect(workflowCalled).toBe(false);
  });

  it('fails closed when auth returns 400 (invalid_scope)', async () => {
    let workflowCalled = false;

    const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        return new Response(JSON.stringify({ error: 'invalid_scope' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      workflowCalled = true;
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await expect(client.worklistAssignedToMe()).rejects.toThrow();
    expect(workflowCalled).toBe(false);
  });

  it('fails closed when network error occurs during auth', async () => {
    let workflowCalled = false;

    const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        throw new Error('Network error');
      }

      workflowCalled = true;
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await expect(client.worklistAssignedToMe()).rejects.toThrow();
    expect(workflowCalled).toBe(false);
  });

  it('fails closed when workflow returns 403 (not just auth)', async () => {
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        return new Response(JSON.stringify({
          access_token: 'mock-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Workflow returns 403 - should not fall back
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await expect(client.worklistAssignedToMe()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// No fallback guarantees
// ---------------------------------------------------------------------------

describe('no fallback guarantees', () => {
  it('does not create admin-level tokens', async () => {
    const capturedAuthBodies: string[] = [];

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        capturedAuthBodies.push(init?.body?.toString() ?? '');
        return new Response(JSON.stringify({
          access_token: 'mock-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read', 'workflow.execute'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await client.worklistAssignedToMe();

    // Verify that no admin scope is used in the auth request
    expect(capturedAuthBodies.length).toBe(1);
    expect(capturedAuthBodies[0]).not.toContain('admin');
    expect(capturedAuthBodies[0]).not.toContain('*');
  });
});

// ---------------------------------------------------------------------------
// Provider Token injected into Workflow SDK
// ---------------------------------------------------------------------------

describe('Token injection into Workflow SDK', () => {
  it('uses the same token for subsequent SDK calls within cache window', async () => {
    const authRequests: string[] = [];

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        authRequests.push('auth');
        return new Response(JSON.stringify({
          access_token: 'cached-token',
          token_type: 'Bearer',
          expires_in: 3600, // long expiry for caching
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    // Two sequential calls should only trigger one auth request (cached)
    await client.worklistAssignedToMe();
    await client.worklistAssignedToMe();

    // Auth should only be called once due to caching
    expect(authRequests.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Secret and Token do not enter logs/errors
// ---------------------------------------------------------------------------

describe('secret and token safety', () => {
  it('does not leak client_secret in error messages', async () => {
    const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        // Server returns 500, but error should not contain secret
        return new Response('Internal server error', { status: 500 });
      }

      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'my-super-secret-value',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    try {
      await client.worklistAssignedToMe();
      expect.fail('should have thrown');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // The secret value should not appear in the error message
      expect(msg).not.toContain('my-super-secret-value');
      // The token should also not appear (token was never obtained)
      expect(msg).not.toContain('Bearer');
    }
  });

  it('does not leak access token in error messages', async () => {
    const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        return new Response(JSON.stringify({
          access_token: 'should-not-leak-this-token-42',
          token_type: 'Bearer',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Workflow returns error
      return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    try {
      await client.worklistAssignedToMe();
      expect.fail('should have thrown');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // The token value should not appear in error messages
      expect(msg).not.toContain('should-not-leak-this-token-42');
    }
  });
});

// ---------------------------------------------------------------------------
// Create operations use correct config
// ---------------------------------------------------------------------------

describe('SDK Auth V1 create operations', () => {
  it('uses correct definition key for quick items', async () => {
    const capturedBodies: string[] = [];

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        return new Response(JSON.stringify({
          access_token: 'create-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Capture the request body for create
      if (init?.body) {
        capturedBodies.push(init.body.toString());
      }
      return new Response(JSON.stringify({
        workflowInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workflowStateVersion: 1,
        currentContextRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        currentNodeVisitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        eventSequence: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.execute'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await client.create(
      {
        domainId: VALID_DOMAIN_ID,
        definitionVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        metadata: {},
        contextPayload: { title: 'Quick task' },
      },
      { idempotencyKey: 'create-quick-1111-abcdef' },
    );

    expect(capturedBodies.length).toBe(1);
    expect(capturedBodies[0]).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(capturedBodies[0]).toContain('Quick task');
  });

  it('passes idempotency-key header for create', async () => {
    const capturedHeaders: Array<Record<string, string>> = [];

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        return new Response(JSON.stringify({
          access_token: 'idempotent-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Convert Headers object to plain record for inspection
      const hdrs = init?.headers;
      const headerRecord: Record<string, string> = {};
      if (hdrs && typeof (hdrs as Headers).forEach === 'function') {
        (hdrs as Headers).forEach((value: string, key: string) => {
          headerRecord[key] = value;
        });
      }
      capturedHeaders.push(headerRecord);
      return new Response(JSON.stringify({
        workflowInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workflowStateVersion: 1,
        currentContextRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        currentNodeVisitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        eventSequence: 1,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.execute'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    const expectedIdempotencyKey = 'create-agent-2222-ijklmn';
    await client.create(
      {
        domainId: VALID_DOMAIN_ID,
        definitionVersionId: VALID_DEF_ID,
        metadata: {},
        contextPayload: { title: 'Agent task', description: 'desc' },
      },
      { idempotencyKey: expectedIdempotencyKey },
    );

    expect(capturedHeaders.length).toBe(1);
    // Check idempotency key in headers (case-insensitive)
    const headerKeys = Object.keys(capturedHeaders[0]).map(k => k.toLowerCase());
    expect(headerKeys).toContain('idempotency-key');
    const idempotencyHeader = Object.entries(capturedHeaders[0])
      .find(([k]) => k.toLowerCase() === 'idempotency-key');
    expect(idempotencyHeader?.[1]).toBe(expectedIdempotencyKey);
  });
});

// ---------------------------------------------------------------------------
// Transition/advance operations
// ---------------------------------------------------------------------------

describe('SDK Auth V1 transition operations', () => {
  it('creates a client that supports transition operations', async () => {
    // Verify that a client with workflow.execute scope can be created
    // and supports the transition method
    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.execute'],
      requestTimeoutMs: 5000,
      fetch: makeMockFetch([
        makeAuthSuccess({ accessToken: 'advance-token' }),
      ]),
    });

    expect(client).toBeDefined();
    expect(typeof client.detail).toBe('function');
    expect(typeof client.transition).toBe('function');
  });

  it('does not use admin identity retry on transition rejection', async () => {
    let transitionAttempts = 0;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = urlStr(input);

      if (url.includes('/token')) {
        return new Response(JSON.stringify({
          access_token: 'limited-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Transition always returns 403 - should NOT be retried with different identity/admin token
      transitionAttempts++;
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.execute'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    await expect(
      client.transition(
        VALID_UUID,
        {
          transitionDefinitionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          expectedWorkflowStateVersion: 5,
          submissionPayload: { summary: 'try' },
        },
        { idempotencyKey: 'advance-admin-test-001' },
      ),
    ).rejects.toThrow();

    // Should only have attempted once (no retry with different identity/admin token)
    expect(transitionAttempts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Principal source verification
// ---------------------------------------------------------------------------

describe('principal source', () => {
  it('derives principal from token.sub, cannot be overridden', async () => {
    const mockFetch = makeMockFetch([makeAuthSuccess(), makeWorklistSuccess(0)]);

    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: mockFetch,
    });

    // The SDK's worklist query does not accept principalId override.
    // WorklistQuery only supports: beforeCreatedAt, beforeId, limit.
    // Principal is derived from the token's sub claim by svc-workflow.
    const result = await client.worklistAssignedToMe();
    expect(result).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
  });
});
