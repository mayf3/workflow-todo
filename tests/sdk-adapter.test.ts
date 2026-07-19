import { describe, expect, it } from 'vitest';
import type {
  WorklistPage,
  CreateWorkflowInstanceResponse,
  ExecuteWorkflowTransitionResponse,
  WorkflowError as SDKWorkflowErrorType,
} from '@workflow-foundation/sdk';
import {
  toWorklistPageView,
  toCreateResultView,
  toTransitionResultView,
  toProductError,
} from '../src/sdk-adapter.js';

// ---------------------------------------------------------------------------
// Helpers — build SDK-shaped objects (snake_case from wire protocol)
// ---------------------------------------------------------------------------

function makeSDKWorklistPage(
  items: number,
  overrides: {
    title?: string;
    priority?: string | null;
    nodeKey?: string;
    nodeDisplay?: string;
  } = {},
): WorklistPage {
  const entries = [];
  for (let i = 0; i < items; i++) {
    entries.push({
      detail: {
        instance: {
          workflow_instance_id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
          domain_id: 'd',
          definition_version_id: '9b07afc4-d3a2-456d-8b96-13fdffbaf995',
          definition_version_status: 'PUBLISHED',
          created_by_principal_id: 'p',
          workflow_state_version: 1,
          external_reference: null,
          external_url: null,
          metadata: null,
          created_at: '2026-07-17T14:20:00Z',
          domain_enabled: true,
          is_terminal: false,
          current_node: {
            node_id: 'n1',
            node_key: overrides.nodeKey ?? 'propose',
            display_name: overrides.nodeDisplay ?? 'Propose',
            node_type: 'DRAFT',
          },
        },
        current_context_revision_id: 'ctx1',
        current_node_visit_id: 'v1',
        current_context: {
          context_revision_id: 'ctx1',
          workflow_instance_id: 'w1',
          revision_number: 1,
          previous_revision_id: null,
          payload: {
            title: overrides.title ?? `SDK Item ${i + 1}`,
            ...(overrides.priority !== undefined ? { priority: overrides.priority } : {}),
          },
          payload_digest: 'd1',
          created_by_principal_id: 'p',
          created_at: '2026-07-17T14:20:00Z',
        },
        current_visit: {
          node_visit_id: 'v1',
          workflow_instance_id: 'w1',
          node: {
            node_id: 'n1',
            node_key: overrides.nodeKey ?? 'propose',
            display_name: overrides.nodeDisplay ?? 'Propose',
            node_type: 'DRAFT',
          },
          visit_number: 1,
          assignee_principal_id: 'p',
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
  return { items: entries, next_cursor: null } as unknown as WorklistPage;
}

// ---------------------------------------------------------------------------
// toWorklistPageView
// ---------------------------------------------------------------------------

describe('toWorklistPageView', () => {
  it('converts SDK worklist items to view model', () => {
    const sdkPage = makeSDKWorklistPage(2);
    const view = toWorklistPageView(sdkPage);

    expect(view.items).toHaveLength(2);
    expect(view.items[0].title).toBe('SDK Item 1');
    expect(view.items[1].title).toBe('SDK Item 2');
    expect(view.nextCursor).toBeNull();
  });

  it('maps all fields correctly', () => {
    const sdkPage = makeSDKWorklistPage(1, {
      title: 'Test Task',
      priority: 'high',
      nodeKey: 'efficiency_check',
      nodeDisplay: 'Efficiency Check',
    });
    const view = toWorklistPageView(sdkPage);
    const item = view.items[0];

    expect(item.workflowInstanceId).toContain('11111111');
    expect(item.definitionVersionId).toBe('9b07afc4-d3a2-456d-8b96-13fdffbaf995');
    expect(item.definitionKey).toBe('9b07afc4…');
    expect(item.currentNodeKey).toBe('efficiency_check');
    expect(item.currentNodeDisplayName).toBe('Efficiency Check');
    expect(item.title).toBe('Test Task');
    expect(item.priority).toBe('high');
    expect(item.createdAt).toBe('2026-07-17T14:20:00Z');
  });

  it('handles empty list', () => {
    const view = toWorklistPageView(makeSDKWorklistPage(0));
    expect(view.items).toHaveLength(0);
  });

  it('uses fallback title when missing', () => {
    const sdkPage = makeSDKWorklistPage(1, { title: '' });
    // Empty string is not a valid title, should fallback
    const item = toWorklistPageView(sdkPage).items[0];
    expect(item.title).toBe('(no title)');
  });

  it('sets null priority when absent', () => {
    const sdkPage = makeSDKWorklistPage(1);
    const item = toWorklistPageView(sdkPage).items[0];
    expect(item.priority).toBeNull();
  });

  it('preserves cursor when present', () => {
    const sdkPage = makeSDKWorklistPage(1);
    (sdkPage as unknown as Record<string, unknown>).next_cursor = {
      created_at: '2026-07-17T14:20:00Z',
      id: 'cursor-id',
    };
    const view = toWorklistPageView(sdkPage);
    expect(view.nextCursor).not.toBeNull();
    expect(view.nextCursor!.createdAt).toBe('2026-07-17T14:20:00Z');
    expect(view.nextCursor!.id).toBe('cursor-id');
  });
});

// ---------------------------------------------------------------------------
// toCreateResultView
// ---------------------------------------------------------------------------

describe('toCreateResultView', () => {
  it('maps create response fields', () => {
    const result: CreateWorkflowInstanceResponse = {
      workflowInstanceId: 'aaa',
      workflowStateVersion: 1,
      currentContextRevisionId: 'ctx1',
      currentNodeVisitId: 'visit1',
      eventSequence: 5,
    };

    const view = toCreateResultView(result);
    expect(view.workflowInstanceId).toBe('aaa');
    expect(view.workflowStateVersion).toBe(1);
    expect(view.eventSequence).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// toTransitionResultView
// ---------------------------------------------------------------------------

describe('toTransitionResultView', () => {
  it('maps transition response fields', () => {
    const result: ExecuteWorkflowTransitionResponse = {
      workflowInstanceId: 'bbb',
      workflowStateVersion: 2,
      currentContextRevisionId: 'ctx2',
      sourceNodeVisitId: 'src-visit',
      currentNodeVisitId: 'dst-visit',
      submissionId: null,
      eventSequence: 7,
    };

    const view = toTransitionResultView(result);
    expect(view.workflowInstanceId).toBe('bbb');
    expect(view.workflowStateVersion).toBe(2);
    expect(view.eventSequence).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// toProductError
// ---------------------------------------------------------------------------

describe('toProductError', () => {
  it('maps configuration error', () => {
    const err = { kind: 'configuration', message: 'bad config' };
    const pe = toProductError(err);
    expect(pe.message).toContain('configuration');
  });

  it('maps transport error', () => {
    const err = { kind: 'transport' };
    const pe = toProductError(err);
    expect(pe.message).toContain('reach');
  });

  it('maps 401 api error', () => {
    const err = { kind: 'api', status: 401, message: 'unauthorized' };
    const pe = toProductError(err);
    expect(pe.message).toContain('Authentication');
  });

  it('maps 403 api error', () => {
    const err = { kind: 'api', status: 403, message: 'forbidden' };
    const pe = toProductError(err);
    expect(pe.message).toContain('permission');
  });

  it('maps 409 state conflict', () => {
    const err = {
      kind: 'api',
      status: 409,
      code: 'workflow_state_version_conflict',
      message: 'conflict',
    };
    const pe = toProductError(err);
    expect(pe.message).toContain('state has changed');
  });

  it('maps 429 rate limit', () => {
    const err = { kind: 'api', status: 429, message: 'too many' };
    const pe = toProductError(err);
    expect(pe.message).toContain('Too many');
  });

  it('maps 5xx api error generically', () => {
    const err = { kind: 'api', status: 500, message: 'server error' };
    const pe = toProductError(err);
    expect(pe.userAction).toContain('try again');
  });

  it('maps protocol error', () => {
    const err = { kind: 'protocol', message: 'invalid response' };
    const pe = toProductError(err);
    expect(pe.message).toContain('unexpected');
  });

  it('maps unknown error gracefully', () => {
    const pe = toProductError({});
    expect(pe.message).toBe('An unexpected error occurred');
  });

  it('maps error with status 422', () => {
    const err = { kind: 'api', status: 422, message: 'invalid input' };
    const pe = toProductError(err);
    expect(pe.message).toContain('Invalid request');
  });
});
