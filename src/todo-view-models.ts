/**
 * Typed Todo View Models.
 *
 * These are display-only data structures representing how workflow-todo
 * presents work items to users. They are NOT Wire DTOs and NOT SDK types.
 *
 * The mapping from SDK types to these view models is done by dedicated
 * adapters (see sdk-read-adapter.ts).
 */

// ---------------------------------------------------------------------------
// Worklist (assigned-to-me)
// ---------------------------------------------------------------------------

export interface TodoWorklistItemView {
  workflowInstanceId: string;
  definitionVersionId: string;
  definitionKey: string;
  createdAt: string;
  currentNodeKey: string;
  currentNodeDisplayName: string;
  title: string;
  priority: string | null;
}

export interface TodoWorklistPageView {
  items: TodoWorklistItemView[];
  nextCursor: { createdAt: string; id: string } | null;
}
