import { describe, expect, it } from 'vitest';
import type { WorklistPage } from '../src/contracts.js';
import { legacyWorklistPageToView } from '../src/legacy-adapter.js';

// ---------------------------------------------------------------------------
// Helpers — build legacy WorklistPage objects
// ---------------------------------------------------------------------------

function makeLegacyPage(
  items: number,
  overrides: {
    title?: string;
    priority?: string | null;
    createdAt?: string;
    nodeKey?: string;
    nodeDisplay?: string;
    instanceId?: string;
    defVersionId?: string;
    ctxPayload?: Record<string, unknown>;
  } = {},
): WorklistPage {
  const entries = [];
  for (let i = 0; i < items; i++) {
    entries.push({
      detail: {
        instance: {
          workflowInstanceId: overrides.instanceId ?? `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
          domainId: 'd',
          definitionVersionId: overrides.defVersionId ?? '9b07afc4-d3a2-456d-8b96-13fdffbaf995',
          definitionVersionStatus: 'PUBLISHED',
          createdByPrincipalId: 'p',
          workflow_state_version: 1,
          workflowStateVersion: 1,
          externalReference: null,
          externalUrl: null,
          metadata: null,
          createdAt: overrides.createdAt ?? '2026-07-17T14:20:00Z',
          domainEnabled: true,
          isTerminal: false,
          currentNode: {
            nodeId: 'n1',
            nodeKey: overrides.nodeKey ?? 'propose',
            displayName: overrides.nodeDisplay ?? 'Propose',
            nodeType: 'DRAFT',
          },
        },
        currentContextRevisionId: 'ctx1',
        currentNodeVisitId: 'v1',
        currentContext: {
          contextRevisionId: 'ctx1',
          workflowInstanceId: 'w1',
          revisionNumber: 1,
          previousRevisionId: null,
          payload: overrides.ctxPayload ?? {
            title: overrides.title ?? `Legacy Item ${i + 1}`,
            ...(overrides.priority !== undefined ? { priority: overrides.priority } : {}),
          },
          payloadDigest: 'd1',
          createdByPrincipalId: 'p',
          createdAt: '2026-07-17T14:20:00Z',
        },
        currentVisit: {
          nodeVisitId: 'v1',
          workflowInstanceId: 'w1',
          node: {
            nodeId: 'n1',
            nodeKey: overrides.nodeKey ?? 'propose',
            displayName: overrides.nodeDisplay ?? 'Propose',
            nodeType: 'DRAFT',
          },
          visitNumber: 1,
          assigneePrincipalId: 'p',
          enteredByTransitionId: null,
          instructions: null,
          createdAt: '2026-07-17T14:20:00Z',
        },
        outgoingTransitions: [],
        outgoing_transitions: [],
      },
      upstreamSubmissions: [],
      returnFeedbackEvents: [],
      submissionsTruncated: false,
      returnEventsTruncated: false,
    });
  }
  return { items: entries, nextCursor: null } as unknown as WorklistPage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('legacyWorklistPageToView', () => {
  it('converts legacy page items to view model', () => {
    const page = makeLegacyPage(2);
    const view = legacyWorklistPageToView(page);

    expect(view.items).toHaveLength(2);
    expect(view.items[0].title).toBe('Legacy Item 1');
    expect(view.items[1].title).toBe('Legacy Item 2');
    expect(view.nextCursor).toBeNull();
  });

  it('maps all fields correctly', () => {
    const page = makeLegacyPage(1, {
      title: 'My Task',
      priority: 'medium',
      nodeKey: 'review',
      nodeDisplay: 'Review',
    });
    const item = legacyWorklistPageToView(page).items[0];

    expect(item.workflowInstanceId).toContain('11111111');
    expect(item.definitionVersionId).toBe('9b07afc4-d3a2-456d-8b96-13fdffbaf995');
    expect(item.definitionKey).toBe('9b07afc4…');
    expect(item.currentNodeKey).toBe('review');
    expect(item.currentNodeDisplayName).toBe('Review');
    expect(item.title).toBe('My Task');
    expect(item.priority).toBe('medium');
  });

  it('handles empty list', () => {
    const view = legacyWorklistPageToView(makeLegacyPage(0));
    expect(view.items).toHaveLength(0);
  });

  it('falls back when title is missing', () => {
    const page = makeLegacyPage(1, { ctxPayload: {} });
    const item = legacyWorklistPageToView(page).items[0];
    expect(item.title).toBe('(no title)');
  });

  it('sets null priority when absent from payload', () => {
    const page = makeLegacyPage(1, { ctxPayload: { title: 'No Priority' } });
    const item = legacyWorklistPageToView(page).items[0];
    expect(item.priority).toBeNull();
  });

  it('preserves cursor', () => {
    const page = makeLegacyPage(1);
    (page as unknown as Record<string, unknown>).nextCursor = {
      createdAt: '2026-07-17T14:20:00Z',
      id: 'cursor-1',
    };
    const view = legacyWorklistPageToView(page);
    expect(view.nextCursor).not.toBeNull();
    expect(view.nextCursor!.createdAt).toBe('2026-07-17T14:20:00Z');
    expect(view.nextCursor!.id).toBe('cursor-1');
  });
});
