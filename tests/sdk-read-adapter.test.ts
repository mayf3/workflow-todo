import { describe, expect, it } from 'vitest';
import { sdkWorklistPageToView } from '../src/sdk-read-adapter.js';
import type { TodoWorklistPageView, TodoWorklistItemView } from '../src/todo-view-models.js';

// ---------------------------------------------------------------------------
// SDK WorklistPage type — matching the SDK's wire format (snake_case)
// We construct these manually as the adapter transforms them.
// ---------------------------------------------------------------------------

interface SdkWorklistPage {
  items: SdkWorklistItem[];
  next_cursor: { created_at: string; id: string } | null;
}

interface SdkWorklistItem {
  detail: {
    instance: {
      workflow_instance_id: string;
      domain_id: string;
      definition_version_id: string;
      definition_version_status: string;
      created_by_principal_id: string;
      workflow_state_version: number;
      external_reference: string | null;
      external_url: string | null;
      metadata: unknown;
      created_at: string;
      domain_enabled: boolean;
      is_terminal: boolean;
      current_node: {
        node_id: string;
        node_key: string;
        display_name: string;
        node_type: string;
      };
    };
    current_context_revision_id: string;
    current_node_visit_id: string;
    current_context: {
      context_revision_id: string;
      workflow_instance_id: string;
      revision_number: number;
      previous_revision_id: string | null;
      payload: unknown;
      payload_digest: string;
      created_by_principal_id: string;
      created_at: string;
    };
    current_visit: {
      node_visit_id: string;
      workflow_instance_id: string;
      node: { node_id: string; node_key: string; display_name: string; node_type: string };
      visit_number: number;
      assignee_principal_id: string | null;
      entered_by_transition_id: string | null;
      instructions: string | null;
      created_at: string;
    };
    outgoing_transitions: Array<Record<string, unknown>>;
  };
  upstream_submissions: Array<Record<string, unknown>>;
  return_feedback_events: Array<Record<string, unknown>>;
  submissions_truncated: boolean;
  return_events_truncated: boolean;
}

const INSTANCE_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANCE_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DOMAIN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DEFINITION_ID = '9b07afc4-d3a2-456d-8b96-13fdffbaf995';

function makeSdkItem(overrides: {
  instanceId?: string;
  definitionVersionId?: string;
  createdAt?: string;
  nodeKey?: string;
  nodeDisplay?: string;
  payload?: Record<string, unknown> | null;
}): SdkWorklistItem {
  const node = {
    node_id: 'n1',
    node_key: overrides.nodeKey ?? 'propose',
    display_name: overrides.nodeDisplay ?? 'Propose',
    node_type: 'DRAFT',
  };
  const payload = 'payload' in overrides ? (overrides.payload ?? null) : { title: 'Test Task', priority: 'high' };
  return {
    detail: {
      instance: {
        workflow_instance_id: overrides.instanceId ?? INSTANCE_ID_A,
        domain_id: DOMAIN_ID,
        definition_version_id: overrides.definitionVersionId ?? DEFINITION_ID,
        definition_version_status: 'PUBLISHED',
        created_by_principal_id: 'p1',
        workflow_state_version: 1,
        external_reference: null,
        external_url: null,
        metadata: null,
        created_at: overrides.createdAt ?? '2026-07-18T10:00:00Z',
        domain_enabled: true,
        is_terminal: false,
        current_node: node,
      },
      current_context_revision_id: 'ctx1',
      current_node_visit_id: 'v1',
      current_context: {
        context_revision_id: 'ctx1',
        workflow_instance_id: overrides.instanceId ?? INSTANCE_ID_A,
        revision_number: 1,
        previous_revision_id: null,
        payload,
        payload_digest: 'd1',
        created_by_principal_id: 'p1',
        created_at: '2026-07-18T10:00:00Z',
      },
      current_visit: {
        node_visit_id: 'v1',
        workflow_instance_id: overrides.instanceId ?? INSTANCE_ID_A,
        node,
        visit_number: 1,
        assignee_principal_id: 'p1',
        entered_by_transition_id: null,
        instructions: null,
        created_at: '2026-07-18T10:00:00Z',
      },
      outgoing_transitions: [],
    },
    upstream_submissions: [],
    return_feedback_events: [],
    submissions_truncated: false,
    return_events_truncated: false,
  };
}

function makeSdkPage(items: SdkWorklistItem[], cursor?: { created_at: string; id: string } | null): SdkWorklistPage {
  return { items, next_cursor: cursor ?? null };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sdkWorklistPageToView', () => {
  // -----------------------------------------------------------------------
  // Single page
  // -----------------------------------------------------------------------

  it('converts single page with one item', () => {
    const sdkPage = makeSdkPage([makeSdkItem({})]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);

    expect(view.items).toHaveLength(1);
    expect(view.items[0].workflowInstanceId).toBe(INSTANCE_ID_A);
    expect(view.items[0].definitionVersionId).toBe(DEFINITION_ID);
    expect(view.items[0].definitionKey).toBe('9b07afc4…');
    expect(view.items[0].createdAt).toBe('2026-07-18T10:00:00Z');
    expect(view.items[0].currentNodeKey).toBe('propose');
    expect(view.items[0].currentNodeDisplayName).toBe('Propose');
    expect(view.items[0].title).toBe('Test Task');
    expect(view.items[0].priority).toBe('high');
    expect(view.nextCursor).toBeNull();
  });

  it('converts single page with multiple items', () => {
    const sdkPage = makeSdkPage([
      makeSdkItem({ instanceId: INSTANCE_ID_A, payload: { title: 'Task A' } }),
      makeSdkItem({ instanceId: INSTANCE_ID_B, payload: { title: 'Task B' } }),
    ]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);

    expect(view.items).toHaveLength(2);
    expect(view.items[0].title).toBe('Task A');
    expect(view.items[1].title).toBe('Task B');
  });

  // -----------------------------------------------------------------------
  // Empty list
  // -----------------------------------------------------------------------

  it('handles empty items array', () => {
    const sdkPage = makeSdkPage([]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);

    expect(view.items).toHaveLength(0);
    expect(view.nextCursor).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Cursor
  // -----------------------------------------------------------------------

  it('maps next_cursor to nextCursor', () => {
    const cursor = { created_at: '2026-07-18T10:00:00Z', id: INSTANCE_ID_A };
    const sdkPage = makeSdkPage([makeSdkItem({})], cursor);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);

    expect(view.nextCursor).toEqual({ createdAt: cursor.created_at, id: cursor.id });
  });

  it('handles null cursor', () => {
    const sdkPage = makeSdkPage([makeSdkItem({})], null);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);

    expect(view.nextCursor).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Title and priority extraction
  // -----------------------------------------------------------------------

  it('extracts title from context payload', () => {
    const sdkPage = makeSdkPage([makeSdkItem({ payload: { title: 'My Custom Task' } })]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);
    expect(view.items[0].title).toBe('My Custom Task');
  });

  it('falls back to (no title) when title is missing', () => {
    const sdkPage = makeSdkPage([makeSdkItem({ payload: { description: 'no title here' } })]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);
    expect(view.items[0].title).toBe('(no title)');
  });

  it('falls back when payload is null', () => {
    const sdkPage = makeSdkPage([makeSdkItem({ payload: null as unknown as Record<string, unknown> })]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);
    expect(view.items[0].title).toBe('(no title)');
    expect(view.items[0].priority).toBeNull();
  });

  it('extracts priority when present', () => {
    const sdkPage = makeSdkPage([makeSdkItem({ payload: { title: 'T', priority: 'urgent' } })]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);
    expect(view.items[0].priority).toBe('urgent');
  });

  it('sets null priority when missing', () => {
    const sdkPage = makeSdkPage([makeSdkItem({ payload: { title: 'T' } })]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);
    expect(view.items[0].priority).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Node mapping
  // -----------------------------------------------------------------------

  it('maps node key and display name', () => {
    const sdkPage = makeSdkPage([makeSdkItem({ nodeKey: 'efficiency_check', nodeDisplay: 'Efficiency Check' })]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);
    expect(view.items[0].currentNodeKey).toBe('efficiency_check');
    expect(view.items[0].currentNodeDisplayName).toBe('Efficiency Check');
  });

  // -----------------------------------------------------------------------
  // View model completeness
  // -----------------------------------------------------------------------

  it('all view model fields are populated', () => {
    const sdkPage = makeSdkPage([makeSdkItem({
      instanceId: INSTANCE_ID_A,
      definitionVersionId: DEFINITION_ID,
      createdAt: '2026-07-18T12:00:00Z',
      nodeKey: 'review',
      nodeDisplay: 'Review',
      payload: { title: 'Complete Task', priority: 'medium' },
    })]);
    const view = sdkWorklistPageToView(sdkPage as Parameters<typeof sdkWorklistPageToView>[0]);

    const item = view.items[0];
    // Verify every field exists and has the expected type
    expect(typeof item.workflowInstanceId).toBe('string');
    expect(typeof item.definitionVersionId).toBe('string');
    expect(typeof item.definitionKey).toBe('string');
    expect(typeof item.createdAt).toBe('string');
    expect(typeof item.currentNodeKey).toBe('string');
    expect(typeof item.currentNodeDisplayName).toBe('string');
    expect(typeof item.title).toBe('string');
    expect(item.priority === null || typeof item.priority === 'string').toBe(true);
  });
});
