/**
 * Legacy Adapter
 *
 * Bridges the legacy hand-written WorkflowClient response types
 * (from contracts.ts) to Todo View Models.
 *
 * This allows the formatters to use a single View Model type
 * regardless of whether the data comes from the legacy client
 * or the Workflow SDK.
 *
 * This adapter only maps fields — it does not make HTTP calls,
 * interpret workflow semantics, or modify response objects.
 */

import type { WorklistPage } from './contracts.js';
import type { TodoWorklistPageView, TodoWorklistItemView } from './todo-view-models.js';

// ---------------------------------------------------------------------------
// Worklist adapter
// ---------------------------------------------------------------------------

/**
 * Convert a legacy WorklistPage (from hand-written client) to
 * a TodoWorklistPageView.
 */
export function legacyWorklistPageToView(page: WorklistPage): TodoWorklistPageView {
  const items: TodoWorklistItemView[] = page.items.map((item) => {
    const inst = item.detail.instance;
    const node = inst.currentNode;
    const ctxPayload =
      typeof item.detail.currentContext?.payload === 'object' &&
      item.detail.currentContext?.payload !== null
        ? (item.detail.currentContext.payload as Record<string, unknown>)
        : {};

    return {
      workflowInstanceId: inst.workflowInstanceId,
      definitionVersionId: inst.definitionVersionId,
      definitionKey: inst.definitionVersionId.slice(0, 8) + '…',
      createdAt: inst.createdAt,
      currentNodeKey: node.nodeKey,
      currentNodeDisplayName: node.displayName,
      title: typeof ctxPayload.title === 'string' && ctxPayload.title.length > 0 ? ctxPayload.title : '(no title)',
      priority: typeof ctxPayload.priority === 'string' ? ctxPayload.priority : null,
    };
  });

  return {
    items,
    nextCursor: page.nextCursor
      ? { createdAt: page.nextCursor.createdAt, id: page.nextCursor.id }
      : null,
  };
}
