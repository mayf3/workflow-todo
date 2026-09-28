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
    };

    const view = buildAttentionView(raw);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].attentionState).toBe('HUMAN_REQUIRED');
    expect(view.items[0].nodeVisitId).toBe(ownerCase.nodeVisitId);
    expect(view.sources.executionAttention).toEqual({
      available: false,
      reason: 'DSH_EXECUTION_ATTENTION_NOT_WIRED',
    });
  });

  it('sorts by attention time then assistance case id', () => {
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
    });

    const text = formatAttention(view);
    expect(text).toContain('[OWNER_PENDING] needs owner attention');
    expect(text).toContain('Human required: unavailable (HTTP_403)');
    expect(text).toContain('DSH_EXECUTION_ATTENTION_NOT_WIRED');
  });
});
