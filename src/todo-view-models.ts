/**
 * Typed Todo View Models.
 *
 * These are display-only data structures representing how workflow-todo
 * presents work items to users. They are NOT Wire DTOs and NOT SDK types.
 *
 * The mapping from SDK / legacy API types to these view models is done
 * by dedicated adapters (see sdk-adapter.ts, legacy-adapter.ts).
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

// ---------------------------------------------------------------------------
// Create result
// ---------------------------------------------------------------------------

export interface TodoCreateResultView {
  workflowInstanceId: string;
  workflowStateVersion: number;
  eventSequence: number;
}

// ---------------------------------------------------------------------------
// Transition result
// ---------------------------------------------------------------------------

export interface TodoTransitionResultView {
  workflowInstanceId: string;
  workflowStateVersion: number;
  eventSequence: number;
}
