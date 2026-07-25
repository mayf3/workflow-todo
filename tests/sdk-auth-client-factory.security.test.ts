/**
 * Tests for SDK Auth Client Factory — Security Guarantees
 *
 * Verifies:
 * - No admin scopes or wildcard scopes are used
 * - client_secret and access token values do not leak into error messages
 */

import { describe, expect, it } from 'vitest';
import { createSdkAuthWorkflowClient, urlStr } from './helpers/sdk-auth-client-factory.helpers.js';

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
