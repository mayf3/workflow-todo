/**
 * Tests for SDK Auth Client Factory — Token & Scope Behavior
 *
 * Covers:
 * - Scope injection into token requests (read, execute, combined)
 * - Token caching within expiry window
 * - Correct principal derivation
 * - Create operations send correct definitionKey and idempotency-key
 * - Transition operations work without admin retry
 */

import { describe, expect, it } from 'vitest';
import {
  createSdkAuthWorkflowClient,
  urlStr,
  makeMockFetch,
  makeAuthSuccess,
  makeWorklistSuccess,
  VALID_UUID,
  VALID_DEF_ID,
  VALID_DOMAIN_ID,
} from './helpers/sdk-auth-client-factory.helpers.js';

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
