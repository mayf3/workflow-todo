// ---------------------------------------------------------------------------
// svc-workflow API contracts
// ---------------------------------------------------------------------------

export type WorkflowOperation = 'create' | 'detail' | 'transition' | 'timeline' | 'worklist';

export type AccessTokenProvider = () => string | Promise<string>;

export interface WorkflowClientConfig {
  baseUrl: string;
  accessTokenProvider: AccessTokenProvider;
  requestTimeoutMs?: number;
  maxAttempts?: number;
}

export interface WriteOptions {
  idempotencyKey: string;
}

export interface CreateWorkflowInstanceInput {
  domainId: string;
  definitionVersionId: string;
  metadata: JsonValue;
  contextPayload: JsonValue;
}

export interface CreateWorkflowInstanceResult {
  workflowInstanceId: string;
  workflowStateVersion: number;
  currentContextRevisionId: string;
  currentNodeVisitId: string;
  eventSequence: number;
}

export interface ExecuteWorkflowTransitionInput {
  transitionDefinitionId: string;
  expectedWorkflowStateVersion: number;
  submissionPayload?: JsonValue;
}

export interface ExecuteWorkflowTransitionResult {
  workflowInstanceId: string;
  workflowStateVersion: number;
  currentContextRevisionId: string;
  sourceNodeVisitId: string;
  currentNodeVisitId: string;
  submissionId: string | null;
  eventSequence: number;
}

export interface WorklistItem {
  detail: WorkflowInstanceDetailFull;
  upstreamSubmissions: SubmissionHistoryItem[];
  returnFeedbackEvents: WorkflowEventItem[];
  submissionsTruncated: boolean;
  returnEventsTruncated: boolean;
}

export interface WorklistPage {
  items: WorklistItem[];
  nextCursor: { createdAt: string; id: string } | null;
}

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
  workflowInstanceId: string;
  domainId: string;
  definitionVersionId: string;
  definitionVersionStatus: string;
  createdByPrincipalId: string;
  /** @deprecated use workflow_state_version (snake_case from API) */
  workflowStateVersion?: number;
  workflow_state_version: number;
  externalReference: string | null;
  externalUrl: string | null;
  metadata: JsonValue | null;
  createdAt: string;
  domainEnabled: boolean;
  isTerminal: boolean;
  currentNode: PublicNodeSummary;
}

export interface HistoricalParticipantSummary {
  workflowInstanceId: string;
  domainId: string;
  definitionVersionId: string;
  definitionVersionStatus: string;
  workflowStateVersion: number;
  createdAt: string;
  domainEnabled: boolean;
  isTerminal: boolean;
  currentNode: PublicNodeSummary;
}

export interface PublicNodeSummary {
  nodeId: string;
  nodeKey: string;
  displayName: string;
  nodeType: string;
}

export interface ContextRevision {
  contextRevisionId: string;
  workflowInstanceId: string;
  revisionNumber: number;
  previousRevisionId: string | null;
  payload: JsonValue;
  payloadDigest: string;
  createdByPrincipalId: string;
  createdAt: string;
}

export interface NodeVisit {
  nodeVisitId: string;
  workflowInstanceId: string;
  node: PublicNodeSummary;
  visitNumber: number;
  assigneePrincipalId: string | null;
  enteredByTransitionId: string | null;
  instructions: string | null;
  createdAt: string;
}

export interface OutgoingTransition {
  /** @deprecated use transition_id (snake_case from API) */
  transitionId?: string;
  transition_id: string;
  transition_key: string;
  display_name: string;
  transition_effect: string;
  target_node: PublicNodeSummary;
  submission_schema: JsonValue | null;
  executable_for_actor: boolean;
  blocked_reason: string | null;
}

export interface SubmissionHistoryItem {
  submissionId: string;
  workflowInstanceId: string;
  sourceNodeVisitId: string;
  sourceNode: PublicNodeSummary;
  contextRevisionId: string;
  authorPrincipalId: string;
  transitionId: string;
  transitionEffect: string;
  payload: JsonValue;
  payloadDigest: string;
  schemaVersion: string;
  createdAt: string;
}

export interface WorkflowEventItem {
  eventId: string;
  workflowInstanceId: string;
  eventSequence: number;
  eventSchemaVersion: string;
  commandId: string | null;
  causationId: string | null;
  correlationId: string | null;
  eventType: string;
  transitionEffect: string | null;
  sourceNodeVisitId: string | null;
  targetNodeVisitId: string | null;
  contextRevisionId: string | null;
  submissionId: string | null;
  eventData: JsonValue | null;
  eventDataDigest: string | null;
  actorPrincipalId: string;
  fromNodeId: string | null;
  toNodeId: string | null;
  oldWorkflowStateVersion: number;
  newWorkflowStateVersion: number;
  createdAt: string;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Domain-wide instance list (Efficiency Manager global view)
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

export type LifecycleFilter = 'active' | 'terminal' | 'all';

export interface DomainInstanceQuery {
  domainId: string;
  beforeCreatedAt?: string;
  beforeId?: string;
  limit?: number;
  definitionKey?: string;
  lifecycle?: LifecycleFilter;
  currentNodeKey?: string;
  assigneePrincipalId?: string;
}
