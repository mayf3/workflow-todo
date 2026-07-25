/**
 * Tests for SDK Auth Client Factory — Auth Failure Handling (Fail-Closed)
 *
 * Verifies that auth failures (401, 400, network error) and
 * workflow 403 errors do not result in any workflow API calls.
 */

import { describe, expect, it } from 'vitest';
import { createSdkAuthWorkflowClient, urlStr } from './helpers/sdk-auth-client-factory.helpers.js';

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
