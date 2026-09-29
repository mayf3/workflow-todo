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

  it('aggregates dsh execution attention with GET, bearer auth, and zero query parameters', async () => {
    const dshCalls: Array<{ url: string; method: string; auth: string | null }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const entry = {
        url,
        method: init?.method ?? 'GET',
        auth: new Headers(init?.headers).get('authorization'),
      };

      if (url.includes('owner-inbox')) {
        return jsonResponse({
          items: [{
            assistanceCaseId: '00000000-0000-4000-8000-000000000001',
            workflowInstanceId: '10000000-0000-4000-8000-000000000001',
            nodeVisitId: '20000000-0000-4000-8000-000000000001',
            status: 'OWNER_PENDING',
            domainId: '30000000-0000-4000-8000-000000000001',
            definitionKey: 'demo',
            node: { displayName: 'Work' },
            request: { message: 'needs owner attention' },
            createdAt: '2026-09-29T01:00:00Z',
            escalatedAt: null,
          }],
          nextCursor: null,
        });
      }
      if (url.includes('human-required')) {
        return jsonResponse({ items: [], nextCursor: null });
      }
      dshCalls.push(entry);
      return jsonResponse({
        items: [
          {
            workflowInstanceId: '10000000-0000-4000-8000-000000000001',
            nodeVisitId: '20000000-0000-4000-8000-000000000001',
            executionState: 'STALE_NO_PROGRESS',
            reason: 'ledger judgment stale_no_progress',
            attemptCount: 3,
            attemptBudgetExhausted: true,
            agentId: 'agent-a',
            sessionId: 'sess-1',
            updatedAtMs: Date.parse('2026-09-29T01:30:00Z'),
          },
          {
            workflowInstanceId: '10000000-0000-4000-8000-000000000002',
            nodeVisitId: '20000000-0000-4000-8000-000000000002',
            executionState: 'OUTCOME_UNKNOWN',
            reason: 'run outcome unknown — reconciliation required',
            updatedAtMs: Date.parse('2026-09-29T04:00:00Z'),
          },
        ],
        counts: { OUTCOME_UNKNOWN: 1, OWNER_PENDING: 0, RUN_ENDED_NO_TRANSITION: 0, STALE_NO_PROGRESS: 1, BLOCKED: 0 },
        generatedAtMs: Date.parse('2026-09-29T06:00:00Z'),
      });
    });

    const view = await createAttentionClient({
      baseUrl: 'http://workflow.test',
      tokenProvider: async () => 'read-token',
      requestTimeoutMs: 1000,
      fetch: fetchMock as typeof fetch,
      execution: {
        baseUrl: 'http://dsh.test',
        tokenProvider: async () => 'dsh-token',
      },
    }).fetchAttention();

    expect(dshCalls).toHaveLength(1);
    expect(dshCalls[0].method).toBe('GET');
    expect(dshCalls[0].auth).toBe('Bearer dsh-token');
    expect(dshCalls[0].url).toBe('http://dsh.test/workflow-execution/attention');

    expect(view.items).toHaveLength(2);
    const assistance = view.items.find((item) => item.kind === 'assistance');
    expect(assistance?.executionEvidence).toMatchObject({
      source: 'dsh-agent-core/execution-attention',
      executionState: 'STALE_NO_PROGRESS',
      attemptBudgetExhausted: true,
    });
    const execution = view.items.find((item) => item.kind === 'execution');
    expect(execution?.executionState).toBe('OUTCOME_UNKNOWN');
    expect(view.sources.executionAttention).toEqual({ available: true });
    expect(view.executionCounts?.OUTCOME_UNKNOWN).toBe(1);
  });

  it('degrades an unavailable dsh source with an explicit reason while keeping svc assistance', async () => {
    const cases: Array<{
      name: string;
      dshStatus?: number;
      reject?: boolean;
      expectedReason: string;
    }> = [
      { name: 'forbidden', dshStatus: 403, expectedReason: 'HTTP_403' },
      { name: 'missing endpoint', dshStatus: 404, expectedReason: 'HTTP_404' },
      { name: 'runtime not wired', dshStatus: 503, expectedReason: 'HTTP_503' },
      { name: 'unauthenticated', dshStatus: 401, expectedReason: 'HTTP_401' },
      { name: 'unreachable', reject: true, expectedReason: 'DSH_UNREACHABLE' },
    ];

    for (const testCase of cases) {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('owner-inbox')) {
          return jsonResponse({
            items: [{
              assistanceCaseId: '00000000-0000-4000-8000-000000000001',
              workflowInstanceId: '10000000-0000-4000-8000-000000000001',
              nodeVisitId: '20000000-0000-4000-8000-000000000001',
              status: 'OWNER_PENDING',
              domainId: '30000000-0000-4000-8000-000000000001',
              definitionKey: 'demo',
              node: { displayName: 'Work' },
              request: { message: 'needs owner attention' },
              createdAt: '2026-09-29T01:00:00Z',
              escalatedAt: null,
            }],
            nextCursor: null,
          });
        }
        if (url.includes('human-required')) {
          return jsonResponse({ items: [], nextCursor: null });
        }
        if (testCase.reject) {
          throw new Error('connect ECONNREFUSED');
        }
        return jsonResponse({ error: { code: 'x' } }, testCase.dshStatus ?? 500);
      });

      const view = await createAttentionClient({
        baseUrl: 'http://workflow.test',
        tokenProvider: async () => 'read-token',
        requestTimeoutMs: 1000,
        fetch: fetchMock as typeof fetch,
        execution: {
          baseUrl: 'http://dsh.test',
          tokenProvider: async () => 'dsh-token',
        },
      }).fetchAttention();

      expect(view.sources.executionAttention, testCase.name).toMatchObject({
        available: false,
      });
      expect(view.sources.executionAttention.available).toBe(false);
      expect(
        view.sources.executionAttention.reason ?? '',
        testCase.name,
      ).toMatch(new RegExp('^' + testCase.expectedReason));
      if (testCase.reject) {
        expect(view.sources.executionAttention.reason).toContain('ECONNREFUSED');
      }
      expect(view.items).toHaveLength(1);
      expect(view.items[0].source).toBe('svc-workflow/owner-inbox');
      expect(view.executionCounts).toBeUndefined();
    }
  });

  it('reports the execution source unavailable without any dsh call when not configured', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('owner-inbox') || url.includes('human-required')) {
        return jsonResponse({ items: [], nextCursor: null });
      }
      return jsonResponse({}, 404);
    });

    const view = await createAttentionClient({
      baseUrl: 'http://workflow.test',
      tokenProvider: async () => 'read-token',
      requestTimeoutMs: 1000,
      fetch: fetchMock as typeof fetch,
    }).fetchAttention();

    expect(view.sources.executionAttention).toEqual({
      available: false,
      reason: 'DSH_BASE_URL_NOT_CONFIGURED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
