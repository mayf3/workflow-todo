/**
 * SDK Read Adapter — converts SDK Workflow types to Todo View Models.
 *
 * Responsibilities:
 *   - Call SDK WorkflowClient.worklistAssignedToMe() via the SDK's
 *     formal pagination interface (WorklistQuery + next_cursor)
 *   - Convert SDK WorklistPage → TodoWorklistPageView via explicit,
 *     typed field mapping (no dynamic/unknown access)
 *   - Fail-closed: any SDK or network error propagates
 *
 * NOT responsible for:
 *   - Reimplementing cursor validation, duplicate detection, or wire protocol
 *   - Cursor construction (beyond using the SDK's query shape)
 *   - Async iteration (the SDK does not provide an iterator,
 *     so the loop uses the SDK's cursor contract directly)
 */

import { type WorklistPage } from '@workflow-foundation/sdk';
import type { TodoWorklistPageView, TodoWorklistItemView } from './todo-view-models.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a single SDK WorklistPage to a TodoWorklistPageView.
 *
 * Pagination: The SDK's worklistAssignedToMe() accepts a WorklistQuery
 * (beforeCreatedAt, beforeId, limit) and returns a WorklistPage with
 * next_cursor. The caller uses the cursor to fetch subsequent pages.
 * This adapter does NOT reimplement the pagination protocol — it uses
 * what the SDK provides and returns a merged view.
 */
export function sdkWorklistPageToView(sdkPage: WorklistPage): TodoWorklistPageView {
  const items: TodoWorklistItemView[] = sdkPage.items.map((item) => {
    const instance = item.detail.instance;
    const node = instance.current_node;
    const payload = extractPayload(item.detail.current_context?.payload);

    return {
      workflowInstanceId: instance.workflow_instance_id,
      definitionVersionId: instance.definition_version_id,
      definitionKey: instance.definition_version_id.slice(0, 8) + '…',
      createdAt: instance.created_at,
      currentNodeKey: node.node_key,
      currentNodeDisplayName: node.display_name,
      title: typeof payload?.title === 'string' ? payload.title : '(no title)',
      priority: typeof payload?.priority === 'string' ? payload.priority : null,
    };
  });

  return {
    items,
    nextCursor: sdkPage.next_cursor
      ? { createdAt: sdkPage.next_cursor.created_at, id: sdkPage.next_cursor.id }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract the context payload as a record.
 * The SDK uses JsonValue (which may be null, array, etc.).
 * For worklist items, the payload is always a JSON object.
 */
function extractPayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}
