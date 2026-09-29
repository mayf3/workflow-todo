import { describe, expect, it } from 'vitest';
import {
  buildAttentionView,
  parseAttentionArgs,
  type RawAttentionSources,
} from '../src/attention.js';
import { formatAttention } from '../src/formatters.js';

const ownerCase = {
  assistanceCaseId: '00000000-0000-4000-8000-000000000001',
  workflowInstanceId: '10000000-0000-4000-8000-000000000001',
  nodeVisitId: '20000000-0000-4000-8000-000000000001',
  status: 'OWNER_PENDING' as const,
  domainId: '30000000-0000-4000-8000-000000000001',
  definitionKey: 'demo',
  node: { displayName: 'Work' },
  request: { message: 'needs owner attention' },
  createdAt: '2026-09-29T01:00:00Z',
  escalatedAt: null,
};

const executionUnavailable: RawAttentionSources['execution'] = {
  availability: { available: false, reason: 'DSH_BASE_URL_NOT_CONFIGURED' },
  items: [],
};

function rawWithExecution(
  execution: RawAttentionSources['execution'],
  overrides: Partial<RawAttentionSources> = {},
): RawAttentionSources {
  return {
    owner: { availability: { available: true }, items: [ownerCase] },
    human: { availability: { available: true }, items: [] },
    execution,
    ...overrides,
  };
}

describe('attention view', () => {
  it('parses only output-mode args', () => {
    expect(parseAttentionArgs(['--json'])).toEqual({ mode: 'json' });
    expect(parseAttentionArgs([])).toEqual({ mode: 'text' });
    expect(parseAttentionArgs(['--owner']).error).toMatch(/unexpected/);
  });

  it('deduplicates owner + human rows and preserves richer owner coordinates', () => {
    const raw: RawAttentionSources = {
      owner: {
        availability: { available: true },
        items: [{
          ...ownerCase,
          status: 'HUMAN_REQUIRED',
          escalatedAt: '2026-09-29T02:00:00Z',
        }],
      },
      human: {
        availability: { available: true },
        items: [{
          assistanceCaseId: ownerCase.assistanceCaseId,
          workflowInstanceId: ownerCase.workflowInstanceId,
          status: 'HUMAN_REQUIRED',
          domainId: ownerCase.domainId,
          definitionKey: ownerCase.definitionKey,
          node: ownerCase.node,
          request: ownerCase.request,
          createdAt: ownerCase.createdAt,
          escalatedAt: '2026-09-29T02:00:00Z',
        }],
      },
      execution: executionUnavailable,
    };

    const view = buildAttentionView(raw);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].attentionState).toBe('HUMAN_REQUIRED');
    expect(view.items[0].nodeVisitId).toBe(ownerCase.nodeVisitId);
    expect(view.sources.executionAttention).toEqual({
      available: false,
      reason: 'DSH_BASE_URL_NOT_CONFIGURED',
    });
  });

  it('sorts by attention time then identity', () => {
    const raw: RawAttentionSources = {
      owner: {
        availability: { available: true },
        items: [
          ownerCase,
          {
            ...ownerCase,
            assistanceCaseId: '00000000-0000-4000-8000-000000000002',
            createdAt: '2026-09-29T03:00:00Z',
          },
        ],
      },
      human: {
        availability: { available: false, reason: 'HTTP_403' },
        items: [],
      },
      execution: { availability: { available: true }, items: [] },
    };

    expect(buildAttentionView(raw).items.map((item) => item.assistanceCaseId)).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
    ]);
  });

  it('formats source availability without inventing execution items', () => {
    const view = buildAttentionView({
      owner: { availability: { available: true }, items: [ownerCase] },
      human: { availability: { available: false, reason: 'HTTP_403' }, items: [] },
      execution: executionUnavailable,
    });

    const text = formatAttention(view);
    expect(text).toContain('[OWNER_PENDING] needs owner attention');
    expect(text).toContain('Human required: unavailable (HTTP_403)');
    expect(text).toContain('Execution attention: unavailable (DSH_BASE_URL_NOT_CONFIGURED)');
    expect(text).not.toContain('dsh-agent-core/execution-attention\n');
  });

  it('aggregates mixed assistance and execution facts, linking only on exact visit identity', () => {
    const view = buildAttentionView(rawWithExecution({
      availability: { available: true },
      items: [
        {
          // Same (workflowInstanceId, nodeVisitId) as the assistance case → linked evidence.
          workflowInstanceId: ownerCase.workflowInstanceId,
          nodeVisitId: ownerCase.nodeVisitId,
          executionState: 'STALE_NO_PROGRESS',
          reason: 'ledger judgment stale_no_progress — execution made no progress',
          attemptId: '40000000-0000-4000-8000-000000000001',
          generation: 2,
          attemptCount: 3,
          attemptBudgetExhausted: true,
          agentId: 'agent-a',
          sessionId: 'sess-1',
          startedAtMs: Date.parse('2026-09-29T00:30:00Z'),
          updatedAtMs: Date.parse('2026-09-29T01:30:00Z'),
        },
        {
          // Different instance → stays a separate source-backed entry.
          workflowInstanceId: '10000000-0000-4000-8000-000000000002',
          nodeVisitId: '20000000-0000-4000-8000-000000000002',
          executionState: 'OUTCOME_UNKNOWN',
          reason: 'run outcome unknown — reconciliation required',
          attemptCount: 1,
          updatedAtMs: Date.parse('2026-09-29T04:00:00Z'),
        },
        {
          // Same instance, different visit → no stable shared identity → separate entry.
          workflowInstanceId: ownerCase.workflowInstanceId,
          nodeVisitId: '20000000-0000-4000-8000-000000000003',
          executionState: 'BLOCKED',
          reason: 'resolution blocked',
          updatedAtMs: Date.parse('2026-09-29T05:00:00Z'),
        },
      ],
      counts: { OUTCOME_UNKNOWN: 1, OWNER_PENDING: 0, RUN_ENDED_NO_TRANSITION: 0, STALE_NO_PROGRESS: 1, BLOCKED: 1 },
      generatedAtMs: Date.parse('2026-09-29T06:00:00Z'),
    }));

    expect(view.items).toHaveLength(3);

    const assistance = view.items.find((item) => item.kind === 'assistance');
    expect(assistance?.assistanceCaseId).toBe(ownerCase.assistanceCaseId);
    expect(assistance?.executionEvidence).toMatchObject({
      source: 'dsh-agent-core/execution-attention',
      nodeVisitId: ownerCase.nodeVisitId,
      executionState: 'STALE_NO_PROGRESS',
      attemptCount: 3,
      attemptBudgetExhausted: true,
      agentId: 'agent-a',
      sessionId: 'sess-1',
    });

    const executionItems = view.items.filter((item) => item.kind === 'execution');
    expect(executionItems.map((item) => item.executionState).sort()).toEqual([
      'BLOCKED',
      'OUTCOME_UNKNOWN',
    ]);
    for (const item of executionItems) {
      expect(item.source).toBe('dsh-agent-core/execution-attention');
      expect(item.workflowInstanceId).toBeTruthy();
      expect(item.detailRef).toContain('/workflow-execution/traces');
    }

    const outcomeUnknown = executionItems.find((item) => item.executionState === 'OUTCOME_UNKNOWN');
    expect(outcomeUnknown?.attentionAt).toBe('2026-09-29T04:00:00.000Z');
    expect(view.executionCounts).toEqual({
      OUTCOME_UNKNOWN: 1,
      OWNER_PENDING: 0,
      RUN_ENDED_NO_TRANSITION: 0,
      STALE_NO_PROGRESS: 1,
      BLOCKED: 1,
    });
  });

  it('keeps the plain assistance view when dsh is available but reports zero execution attention', () => {
    const view = buildAttentionView(rawWithExecution({
      availability: { available: true },
      items: [],
      counts: { OUTCOME_UNKNOWN: 0, OWNER_PENDING: 0, RUN_ENDED_NO_TRANSITION: 0, STALE_NO_PROGRESS: 0, BLOCKED: 0 },
      generatedAtMs: Date.parse('2026-09-29T06:00:00Z'),
    }));

    expect(view.items).toHaveLength(1);
    expect(view.items[0].kind).toBe('assistance');
    expect(view.items[0].executionEvidence).toBeUndefined();
    expect(view.sources.executionAttention).toEqual({ available: true });
    expect(view.executionCounts).toEqual(
      { OUTCOME_UNKNOWN: 0, OWNER_PENDING: 0, RUN_ENDED_NO_TRANSITION: 0, STALE_NO_PROGRESS: 0, BLOCKED: 0 },
    );
  });

  it('preserves machine-readable provenance and availability in json output', () => {
    const view = buildAttentionView(rawWithExecution({
      availability: { available: false, reason: 'HTTP_403' },
      items: [],
    }));

    const parsed = JSON.parse(JSON.stringify(view)) as {
      items: Array<{ source?: string; kind?: string; executionEvidence?: { source?: string } }>;
      sources: { executionAttention: { available: boolean; reason?: string } };
    };

    expect(parsed.sources.executionAttention).toEqual({
      available: false,
      reason: 'HTTP_403',
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].source).toBe('svc-workflow/owner-inbox');
    expect(parsed.items[0].kind).toBe('assistance');
    expect(parsed.items[0].executionEvidence).toBeUndefined();

    const linked = buildAttentionView(rawWithExecution({
      availability: { available: true },
      items: [{
        workflowInstanceId: ownerCase.workflowInstanceId,
        nodeVisitId: ownerCase.nodeVisitId,
        executionState: 'STALE_NO_PROGRESS',
        reason: 'stale',
      }],
    }));
    const linkedJson = JSON.parse(JSON.stringify(linked)) as {
      items: Array<{ executionEvidence?: { source?: string; executionState?: string } }>;
    };
    expect(linkedJson.items[0].executionEvidence).toMatchObject({
      source: 'dsh-agent-core/execution-attention',
      executionState: 'STALE_NO_PROGRESS',
    });
  });

  it('renders execution entries and linked evidence in the text formatter', () => {
    const view = buildAttentionView(rawWithExecution({
      availability: { available: true },
      items: [{
        workflowInstanceId: '10000000-0000-4000-8000-000000000002',
        nodeVisitId: '20000000-0000-4000-8000-000000000002',
        executionState: 'OUTCOME_UNKNOWN',
        reason: 'run outcome unknown — reconciliation required',
        attemptCount: 2,
        attemptBudgetExhausted: true,
        agentId: 'agent-a',
        sessionId: 'sess-1',
        updatedAtMs: Date.parse('2026-09-29T04:00:00Z'),
      }],
    }));

    const text = formatAttention(view);
    expect(text).toContain('[OUTCOME_UNKNOWN] run outcome unknown — reconciliation required');
    expect(text).toContain('Source: dsh-agent-core/execution-attention');
    expect(text).toContain('Attempts: 2 (budget exhausted)');
    expect(text).toContain('Agent: agent-a');
    expect(text).toContain('Execution attention: available');
  });
});
