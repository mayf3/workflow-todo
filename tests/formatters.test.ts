import { describe, expect, it } from 'vitest';
import {
  formatWorklist,
  formatDetail,
  formatAdvanceResult,
  writeJson,
} from '../src/formatters.js';
import type {
  WorkflowInstanceDetail,
  ExecuteWorkflowTransitionResult,
} from '../src/contracts.js';
import type { TodoWorklistPageView } from '../src/todo-view-models.js';

// ---------------------------------------------------------------------------
// Helpers — build raw API-shaped objects (snake_case)
// ---------------------------------------------------------------------------

function makeWorklist(
  items: number,
  overrides: {
    instanceId?: string;
    defVersionId?: string;
    createdAt?: string;
    nodeKey?: string;
    nodeDisplay?: string;
    title?: string;
    description?: string;
    priority?: string | null;
  } = {},
): TodoWorklistPageView {
  const entries = [];
  for (let i = 0; i < items; i++) {
    entries.push({
      workflowInstanceId: overrides.instanceId ?? `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
      definitionVersionId: overrides.defVersionId ?? '9b07afc4-d3a2-456d-8b96-13fdffbaf995',
      definitionKey: (overrides.defVersionId ?? '9b07afc4-d3a2-456d-8b96-13fdffbaf995').slice(0, 8) + '…',
      createdAt: overrides.createdAt ?? '2026-07-17T14:20:00Z',
      currentNodeKey: overrides.nodeKey ?? 'propose',
      currentNodeDisplayName: overrides.nodeDisplay ?? 'Propose',
      title: overrides.title ?? `Test Item ${i + 1}`,
      priority: overrides.priority ?? null,
    });
  }
  return { items: entries, nextCursor: null };
}

function makeDetailFull(
  overrides: {
    title?: string;
    description?: string;
    priority?: string | null;
    acceptanceCriteria?: string;
    nodeKey?: string;
    nodeDisplay?: string;
    transitions?: Array<{
      effect?: string;
      targetDisplay?: string;
      executable?: boolean;
      blockedReason?: string | null;
    }>;
  } = {},
): WorkflowInstanceDetail {
  const ctxPayload: Record<string, unknown> = {
    title: overrides.title ?? 'Test Detail Title',
    description: overrides.description ?? 'A description with multiple\nlines\nhere.',
  };
  if (overrides.priority !== undefined && overrides.priority !== null) ctxPayload.priority = overrides.priority;
  if (overrides.acceptanceCriteria !== undefined) ctxPayload.acceptance_criteria = overrides.acceptanceCriteria;
  const nodeKey = overrides.nodeKey ?? 'efficiency_check';
  const nodeDisplay = overrides.nodeDisplay ?? 'Efficiency Check';
  const transitions = overrides.transitions ?? [];

  const detail = {
    instance: {
      workflow_instance_id: '22222222-2222-4222-8222-222222222222',
      domain_id: 'd',
      definition_version_id: '9b07afc4-d3a2-456d-8b96-13fdffbaf995',
      definition_version_status: 'PUBLISHED',
      created_by_principal_id: 'p',
      workflow_state_version: 3,
      external_reference: null,
      external_url: null,
      metadata: null,
      created_at: '2026-07-17T14:20:00Z',
      domain_enabled: true,
      is_terminal: false,
      current_node: { node_id: 'n1', node_key: nodeKey, display_name: nodeDisplay, node_type: 'NORMAL' },
    },
    current_context_revision_id: 'ctx1',
    current_node_visit_id: 'v1',
    current_context: {
      context_revision_id: 'ctx1',
      workflow_instance_id: 'w1',
      revision_number: 1,
      previous_revision_id: null,
      payload: ctxPayload as import('../src/contracts.js').JsonValue,
      payload_digest: 'd1',
      created_by_principal_id: 'p',
      created_at: '2026-07-17T14:20:00Z',
    },
    current_visit: {
      node_visit_id: 'v1',
      workflow_instance_id: 'w1',
      node: { node_id: 'n1', node_key: nodeKey, display_name: nodeDisplay, node_type: 'NORMAL' },
      visit_number: 2,
      assignee_principal_id: 'p',
      entered_by_transition_id: 't1',
      instructions: 'Review the proposal',
      created_at: '2026-07-17T14:20:00Z',
    },
    outgoing_transitions:
      transitions.length > 0
        ? transitions.map((t) => ({
            transition_id: 't1',
            transition_key: 'advance',
            display_name: 'Advance',
            transition_effect: t.effect ?? 'ADVANCE',
            target_node: {
              node_id: 'n2',
              node_key: 'execute',
              display_name: t.targetDisplay ?? 'Execute',
              node_type: 'NORMAL',
            },
            submission_schema: null,
            executable_for_actor: t.executable ?? true,
            blocked_reason: t.blockedReason ?? null,
          }))
        : [
            {
              transition_id: 't1',
              transition_key: 'advance-to-execute',
              display_name: 'Approve for execution',
              transition_effect: 'ADVANCE',
              target_node: { node_id: 'n2', node_key: 'execute', display_name: 'Execute', node_type: 'NORMAL' },
              submission_schema: null,
              executable_for_actor: true,
              blocked_reason: null,
            },
            {
              transition_id: 't2',
              transition_key: 'return-to-propose',
              display_name: 'Return to propose',
              transition_effect: 'RETURN',
              target_node: { node_id: 'n3', node_key: 'propose', display_name: 'Propose', node_type: 'DRAFT' },
              submission_schema: null,
              executable_for_actor: true,
              blocked_reason: null,
            },
          ],
  };

  return { visibility: 'full', detail } as unknown as WorkflowInstanceDetail;
}

// ---------------------------------------------------------------------------
// Worklist formatter tests
// ---------------------------------------------------------------------------

describe('formatWorklist', () => {
  it('shows count and titles for non-empty worklist', () => {
    const result = formatWorklist(makeWorklist(2));
    expect(result).toContain('2 work items');
    expect(result).toContain('Test Item 1');
    expect(result).toContain('Test Item 2');
  });

  it('shows node, instance, created for each item', () => {
    const result = formatWorklist(makeWorklist(1));
    expect(result).toContain('Node: Propose');
    expect(result).toContain('11111111-1111-4111-8111');
    expect(result).toContain('2026-07-17');
  });

  it('shows empty worklist message', () => {
    const result = formatWorklist(makeWorklist(0));
    expect(result).toBe('No work items assigned to this principal.');
  });

  it('shows priority when present', () => {
    const result = formatWorklist(makeWorklist(1, { priority: 'high', title: 'Important Task' }));
    expect(result).toContain('Priority: high');
  });

  it('handles Chinese and emoji', () => {
    const result = formatWorklist(makeWorklist(1, { title: '测试中文 📝', description: '描述文本' }));
    expect(result).toContain('测试中文 📝');
  });
});

// ---------------------------------------------------------------------------
// Detail formatter tests
// ---------------------------------------------------------------------------

describe('formatDetail', () => {
  it('shows title and key fields', () => {
    const result = formatDetail(makeDetailFull({ title: 'My Task' }));
    expect(result).toContain('My Task');
    expect(result).toContain('Instance: 22222222-2222-4222-8222-222222222222');
    expect(result).toContain('Current node:');
    expect(result).toContain('State version: 3');
  });

  it('shows description', () => {
    const result = formatDetail(makeDetailFull({ description: 'A description with multiple\nlines\nhere.' }));
    expect(result).toContain('A description with multiple');
    expect(result).toContain('lines');
  });

  it('shows acceptance criteria when present', () => {
    const result = formatDetail(makeDetailFull({ acceptanceCriteria: '- Must do X\n- Must do Y' }));
    expect(result).toContain('Acceptance criteria');
    expect(result).toContain('Must do X');
    expect(result).toContain('Must do Y');
  });

  it('shows available transitions', () => {
    const result = formatDetail(makeDetailFull({}));
    expect(result).toContain('Available transitions');
    expect(result).toContain('advance');
    expect(result).toContain('return');
  });

  it('shows blocked transitions with reason', () => {
    const result = formatDetail(
      makeDetailFull({
        transitions: [{ effect: 'ADVANCE', executable: false, blockedReason: 'Not your turn' }],
      }),
    );
    expect(result).toContain('blocked');
    expect(result).toContain('Not your turn');
  });

  it('omits description section when empty', () => {
    const result = formatDetail(makeDetailFull({ description: '' }));
    expect(result).not.toContain('Description\n');
  });

  it('omits acceptance criteria section when not present', () => {
    const result = formatDetail(makeDetailFull({}));
    expect(result).not.toContain('Acceptance criteria');
  });

  it('shows priority when present', () => {
    const result = formatDetail(makeDetailFull({ priority: 'high', title: 'High Priority' }));
    expect(result).toContain('Priority: high');
  });

  it('handles historical visibility', () => {
    const detail = {
      visibility: 'historical_participant',
      detail: {
        instance: {
          workflow_instance_id: '33333333-3333-4333-8333-333333333333',
          domain_id: 'd',
          definition_version_id: 'v1',
          definition_version_status: 'PUBLISHED',
          workflow_state_version: 2,
          created_at: '2026-07-17T14:20:00Z',
          domain_enabled: true,
          is_terminal: true,
          current_node: { node_id: 'n1', node_key: 'completed', display_name: 'Completed', node_type: 'TERMINAL' },
        },
      },
    } as unknown as WorkflowInstanceDetail;
    const result = formatDetail(detail);
    expect(result).toContain('historical');
    expect(result).toContain('Completed');
  });
});

// ---------------------------------------------------------------------------
// Advance formatter tests
// ---------------------------------------------------------------------------

describe('formatAdvanceResult', () => {
  it('shows success message with instance and state version', () => {
    const result: ExecuteWorkflowTransitionResult = {
      workflowInstanceId: '44444444-4444-4444-8444-444444444444',
      workflowStateVersion: 2,
      currentContextRevisionId: 'ctx2',
      sourceNodeVisitId: 'v1',
      currentNodeVisitId: 'v2',
      submissionId: 's1',
      eventSequence: 3,
    };
    const text = formatAdvanceResult('44444444-4444-4444-8444-444444444444', result);
    expect(text).toContain('Transition succeeded');
    expect(text).toContain('State version: 2');
    expect(text).toContain('Event sequence: 3');
  });
});

// ---------------------------------------------------------------------------
// JSON mode tests
// ---------------------------------------------------------------------------

describe('writeJson', () => {
  it('writes valid JSON to stdout', () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
    try {
      writeJson({ a: 1, b: [2, 3] });
    } finally {
      process.stdout.write = orig;
    }
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.a).toBe(1);
    expect(parsed.b).toEqual([2, 3]);
  });

  it('produces parseable JSON for worklist data', () => {
    const view = makeWorklist(2);
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
    try {
      writeJson(view);
    } finally {
      process.stdout.write = orig;
    }
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.items).toHaveLength(2);
  });
});
