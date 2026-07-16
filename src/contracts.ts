// ---------------------------------------------------------------------------
// svc-workflow API contracts
// ---------------------------------------------------------------------------

export type WorkflowOperation = 'preflight' | 'create' | 'detail' | 'transition' | 'timeline' | 'worklist';

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
  outgoingTransitions: OutgoingTransition[];
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
  workflowStateVersion: number;
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
  transitionId: string;
  transitionKey: string;
  displayName: string;
  transitionEffect: string;
  targetNode: PublicNodeSummary;
  submissionSchema: JsonValue | null;
  executableForActor: boolean;
  blockedReason: string | null;
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
