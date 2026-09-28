import { describe, expect, it, vi } from 'vitest';
import { createAttentionClient } from '../src/attention-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('attention client', () => {
  it('uses GET-only authoritative reads, bearer auth, and stable pagination', async () => {
    const calls: Array<{ url: string; method: string; auth: string | null }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        auth: new Headers(init?.headers).get('authorization'),
      });

      if (url.includes('owner-inbox') && !url.includes('beforeCreatedAt')) {
        return jsonResponse({
          items: [{
            assistanceCaseId: '00000000-0000-4000-8000-000000000001',
            workflowInstanceId: '10000000-0000-4000-8000-000000000001',
            nodeVisitId: '20000000-0000-4000-8000-000000000001',
            status: 'OWNER_PENDING',
            domainId: '30000000-0000-4000-8000-000000000001',
            definitionKey: 'demo',
            node: { displayName: 'Work' },
            request: { message: 'one' },
            createdAt: '2026-09-29T01:00:00Z',
            escalatedAt: null,
          }],
          nextCursor: {
            at: '2026-09-29T01:00:00Z',
            id: '00000000-0000-4000-8000-000000000001',
          },
        });
      }

      if (url.includes('owner-inbox')) {
        return jsonResponse({ items: [], nextCursor: null });
      }

      if (url.includes('human-required')) {
        return jsonResponse({ items: [], nextCursor: null });
      }

      return jsonResponse({}, 404);
    });

    const client = createAttentionClient({
      baseUrl: 'http://workflow.test',
      tokenProvider: async () => 'read-token',
      requestTimeoutMs: 1000,
      fetch: fetchMock as typeof fetch,
    });

    const view = await client.fetchAttention();
    expect(view.items).toHaveLength(1);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(calls.every((call) => call.auth === 'Bearer read-token')).toBe(true);
    expect(calls.some((call) => call.url.includes('beforeCreatedAt='))).toBe(true);
  });

  it('keeps a forbidden optional source unavailable without mutation fallback', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('owner-inbox')) {
        return jsonResponse({ items: [], nextCursor: null });
      }
      return jsonResponse({ error: { code: 'forbidden' } }, 403);
    });

    const view = await createAttentionClient({
      baseUrl: 'http://workflow.test',
      tokenProvider: async () => 'read-token',
      requestTimeoutMs: 1000,
      fetch: fetchMock as typeof fetch,
    }).fetchAttention();

    expect(view.sources.ownerAssistance.available).toBe(true);
    expect(view.sources.humanRequired).toEqual({
      available: false,
      reason: 'HTTP_403',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed on service errors and invalid configuration', async () => {
    expect(() => createAttentionClient({
      baseUrl: '',
      tokenProvider: async () => 'x',
      requestTimeoutMs: 1000,
      fetch,
    })).toThrow(/SVC_WORKFLOW_BASE_URL/);

    const client = createAttentionClient({
      baseUrl: 'http://workflow.test',
      tokenProvider: async () => 'read-token',
      requestTimeoutMs: 1000,
      fetch: (async () => jsonResponse({}, 503)) as typeof fetch,
    });

    await expect(client.fetchAttention()).rejects.toThrow(/HTTP 503/);
  });
});
