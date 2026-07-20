// ---------------------------------------------------------------------------
// svc-workflow API contracts — display types for formatters
//
// These types describe the shape of API responses as consumed by the
// formatters.  The SDK (@workflow-foundation/sdk) provides its own typed
// client; these types are used only as cast targets in formatters which
// access fields via snake_case string keys.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workflow instance detail
// ---------------------------------------------------------------------------

export interface WorkflowInstanceDetailFull {
  instance: WorkflowInstanceSummary;
  currentContextRevisionId: string;
  currentNodeVisitId: string;
  currentContext: ContextRevision;
  currentVisit: NodeVisit;
  /** @deprecated use outgoing_transitions (snake_case from API) */
  outgoingTransitions?: OutgoingTransition[];
  outgoing_transitions: OutgoingTransition[];
}

export type WorkflowInstanceDetail =
  | { visibility: 'full'; detail: WorkflowInstanceDetailFull }
  | { visibility: 'historical_participant'; detail: { instance: HistoricalParticipantSummary } };

export interface WorkflowInstanceSummary {
  workflow_instance_id: string;
  domain_id: string;
  definition_version_id: string;
  definition_version_status: string;
  created_by_principal_id: string;
  workflow_state_version: number;
  external_reference: string | null;
  external_url: string | null;
  metadata: JsonValue | null;
  created_at: string;
  domain_enabled: boolean;
  is_terminal: boolean;
  current_node: PublicNodeSummary;
}

export interface HistoricalParticipantSummary {
  workflow_instance_id: string;
  domain_id: string;
  definition_version_id: string;
  definition_version_status: string;
  workflow_state_version: number;
  created_at: string;
  domain_enabled: boolean;
  is_terminal: boolean;
  current_node: PublicNodeSummary;
}

export interface PublicNodeSummary {
  node_id: string;
  node_key: string;
  display_name: string;
  node_type: string;
}

export interface ContextRevision {
  context_revision_id: string;
  workflow_instance_id: string;
  revision_number: number;
  previous_revision_id: string | null;
  payload: JsonValue;
  payload_digest: string;
  created_by_principal_id: string;
  created_at: string;
}

export interface NodeVisit {
  node_visit_id: string;
  workflow_instance_id: string;
  node: PublicNodeSummary;
  visit_number: number;
  assignee_principal_id: string | null;
  entered_by_transition_id: string | null;
  instructions: string | null;
  created_at: string;
}

export interface OutgoingTransition {
  transition_id: string;
  transition_key: string;
  display_name: string;
  transition_effect: string;
  target_node: PublicNodeSummary;
  submission_schema: JsonValue | null;
  executable_for_actor: boolean;
  blocked_reason: string | null;
}

// ---------------------------------------------------------------------------
// Transition result
// ---------------------------------------------------------------------------

export interface ExecuteWorkflowTransitionResult {
  workflowInstanceId: string;
  workflowStateVersion: number;
  currentContextRevisionId: string;
  sourceNodeVisitId: string;
  currentNodeVisitId: string;
  submissionId: string | null;
  eventSequence: number;
}

// ---------------------------------------------------------------------------
// Domain-wide instance list
// ---------------------------------------------------------------------------

export interface DomainInstanceSummary {
  workflow_instance_id: string;
  domain_id: string;
  definition_version_id: string;
  definition_key: string;
  created_by_principal_id: string;
  current_assignee_principal_id: string | null;
  current_node: PublicNodeSummary;
  is_terminal: boolean;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface DomainInstancePage {
  items: DomainInstanceSummary[];
  nextCursor: { createdAt: string; id: string } | null;
}

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
