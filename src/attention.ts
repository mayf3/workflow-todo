import { parseOutputMode, type OutputMode } from './cli-args.js';

export type AttentionState = 'OWNER_PENDING' | 'HUMAN_REQUIRED';

export type AttentionItemSource =
  | 'svc-workflow/owner-inbox'
  | 'svc-workflow/human-required'
  | 'dsh-agent-core/execution-attention';

export interface ExecutionAttentionEvidence {
  source: 'dsh-agent-core/execution-attention';
  nodeVisitId: string;
  executionState: string;
  reason?: string;
  attemptId?: string;
  generation?: number;
  attemptCount?: number;
  attemptBudgetExhausted?: boolean;
  agentId?: string;
  sessionId?: string;
  updatedAtMs?: number;
}

export interface AttentionItem {
  /** 'assistance' = svc-workflow business truth; 'execution' = dsh ledger evidence. */
  kind: 'assistance' | 'execution';
  source: AttentionItemSource;
  /** Assistance items: OWNER_PENDING | HUMAN_REQUIRED. Execution items: the dsh executionState. */
  attentionState: string;
  workflowInstanceId: string;
  nodeVisitId: string | null;
  /** Present only for kind === 'assistance'. */
  assistanceCaseId?: string;
  domainId?: string;
  definitionKey?: string;
  nodeDisplayName?: string;
  message: string;
  createdAt?: string;
  attentionAt: string;
  detailRef: string;
  /** Present only for kind === 'execution'. */
  executionState?: string;
  attemptId?: string;
  generation?: number;
  attemptCount?: number;
  attemptBudgetExhausted?: boolean;
  agentId?: string;
  sessionId?: string;
  updatedAtMs?: number;
  /**
   * Execution facts linked onto an assistance entry. Populated only when a dsh
   * execution item shares the stable (workflowInstanceId, nodeVisitId) identity
   * with this assistance entry; never inferred from time or title similarity.
   */
  executionEvidence?: ExecutionAttentionEvidence;
}

export interface AttentionSourceAvailability {
  available: boolean;
  reason?: string;
}

export interface AttentionView {
  items: AttentionItem[];
  sources: {
    ownerAssistance: AttentionSourceAvailability;
    humanRequired: AttentionSourceAvailability;
    executionAttention: AttentionSourceAvailability;
  };
  /** Fleet-level attention-state counts, verbatim from dsh when available. */
  executionCounts?: Record<string, number>;
  /** dsh projection generation time (epoch ms), verbatim when available. */
  executionGeneratedAtMs?: number;
}

export interface OwnerAssistanceCaseWire {
  assistanceCaseId: string;
  workflowInstanceId: string;
  nodeVisitId: string;
  status: AttentionState;
  domainId: string;
  definitionKey: string;
  node?: { displayName?: string };
  request?: { message?: string };
  createdAt: string;
  escalatedAt?: string | null;
}

export interface HumanRequiredAssistanceCaseWire {
  assistanceCaseId: string;
  workflowInstanceId: string;
  status: 'HUMAN_REQUIRED';
  domainId: string;
  definitionKey: string;
  node?: { displayName?: string };
  request?: { message?: string };
  createdAt: string;
  escalatedAt: string;
}

export interface AssistancePageWire<T> {
  items: T[];
  nextCursor: { at: string; id: string } | null;
}

/**
 * Wire shape of one item from dsh-agent-core
 * GET /workflow-execution/attention (WORKFLOW_EXECUTION_CONTROL_V1).
 * Absent dsh facts stay absent here — nothing is defaulted or inferred.
 */
export interface ExecutionAttentionItemWire {
  workflowInstanceId: string;
  nodeVisitId: string;
  executionState: string;
  reason?: string;
  attemptId?: string;
  generation?: number;
  attemptCount?: number;
  attemptBudgetExhausted?: boolean;
  agentId?: string;
  sessionId?: string;
  startedAtMs?: number;
  updatedAtMs?: number;
}

export interface ExecutionAttentionResponseWire {
  items: ExecutionAttentionItemWire[];
  counts?: Record<string, number>;
  generatedAtMs?: number;
}

export interface RawAttentionSources {
  owner: {
    availability: AttentionSourceAvailability;
    items: OwnerAssistanceCaseWire[];
  };
  human: {
    availability: AttentionSourceAvailability;
    items: HumanRequiredAssistanceCaseWire[];
  };
  execution: {
    availability: AttentionSourceAvailability;
    items: ExecutionAttentionItemWire[];
    counts?: Record<string, number>;
    generatedAtMs?: number;
  };
}

export function parseAttentionArgs(args: string[]): { mode: OutputMode; error?: string } {
  const parsed = parseOutputMode(args);
  if (parsed.error) return { mode: parsed.mode, error: parsed.error };
  if (parsed.remainingArgs.length > 0) {
    return {
      mode: parsed.mode,
      error: 'unexpected attention argument: ' + parsed.remainingArgs[0],
    };
  }
  return { mode: parsed.mode };
}

function safeMessage(value: { message?: string } | undefined): string {
  return typeof value?.message === 'string' ? value.message : '';
}

function toOwnerItem(item: OwnerAssistanceCaseWire): AttentionItem {
  const attentionAt = item.status === 'HUMAN_REQUIRED' && item.escalatedAt
    ? item.escalatedAt
    : item.createdAt;

  return {
    kind: 'assistance',
    source: 'svc-workflow/owner-inbox',
    attentionState: item.status,
    workflowInstanceId: item.workflowInstanceId,
    nodeVisitId: item.nodeVisitId,
    assistanceCaseId: item.assistanceCaseId,
    domainId: item.domainId,
    definitionKey: item.definitionKey,
    nodeDisplayName: item.node?.displayName ?? '',
    message: safeMessage(item.request),
    createdAt: item.createdAt,
    attentionAt,
    detailRef: '/internal/v1/assistance-cases/' + item.assistanceCaseId,
  };
}

function toHumanItem(item: HumanRequiredAssistanceCaseWire): AttentionItem {
  return {
    kind: 'assistance',
    source: 'svc-workflow/human-required',
    attentionState: 'HUMAN_REQUIRED',
    workflowInstanceId: item.workflowInstanceId,
    nodeVisitId: null,
    assistanceCaseId: item.assistanceCaseId,
    domainId: item.domainId,
    definitionKey: item.definitionKey,
    nodeDisplayName: item.node?.displayName ?? '',
    message: safeMessage(item.request),
    createdAt: item.createdAt,
    attentionAt: item.escalatedAt,
    detailRef: '/internal/v1/assistance-cases/' + item.assistanceCaseId,
  };
}

function executionTimestampMs(wire: ExecutionAttentionItemWire): number | undefined {
  return wire.updatedAtMs ?? wire.startedAtMs;
}

function toExecutionEvidence(wire: ExecutionAttentionItemWire): ExecutionAttentionEvidence {
  return {
    source: 'dsh-agent-core/execution-attention',
    nodeVisitId: wire.nodeVisitId,
    executionState: wire.executionState,
    ...(wire.reason !== undefined ? { reason: wire.reason } : {}),
    ...(wire.attemptId !== undefined ? { attemptId: wire.attemptId } : {}),
    ...(wire.generation !== undefined ? { generation: wire.generation } : {}),
    ...(wire.attemptCount !== undefined ? { attemptCount: wire.attemptCount } : {}),
    ...(wire.attemptBudgetExhausted !== undefined
      ? { attemptBudgetExhausted: wire.attemptBudgetExhausted }
      : {}),
    ...(wire.agentId !== undefined ? { agentId: wire.agentId } : {}),
    ...(wire.sessionId !== undefined ? { sessionId: wire.sessionId } : {}),
    ...(wire.updatedAtMs !== undefined ? { updatedAtMs: wire.updatedAtMs } : {}),
  };
}

function toExecutionItem(wire: ExecutionAttentionItemWire): AttentionItem {
  const atMs = executionTimestampMs(wire);
  return {
    kind: 'execution',
    source: 'dsh-agent-core/execution-attention',
    attentionState: wire.executionState,
    workflowInstanceId: wire.workflowInstanceId,
    nodeVisitId: wire.nodeVisitId,
    message: wire.reason ?? '',
    attentionAt: typeof atMs === 'number' ? new Date(atMs).toISOString() : '',
    detailRef:
      'dsh-agent-core:/workflow-execution/traces'
      + '?workflowInstanceId=' + wire.workflowInstanceId
      + '&nodeVisitId=' + wire.nodeVisitId,
    executionState: wire.executionState,
    ...(wire.attemptId !== undefined ? { attemptId: wire.attemptId } : {}),
    ...(wire.generation !== undefined ? { generation: wire.generation } : {}),
    ...(wire.attemptCount !== undefined ? { attemptCount: wire.attemptCount } : {}),
    ...(wire.attemptBudgetExhausted !== undefined
      ? { attemptBudgetExhausted: wire.attemptBudgetExhausted }
      : {}),
    ...(wire.agentId !== undefined ? { agentId: wire.agentId } : {}),
    ...(wire.sessionId !== undefined ? { sessionId: wire.sessionId } : {}),
    ...(wire.updatedAtMs !== undefined ? { updatedAtMs: wire.updatedAtMs } : {}),
  };
}

/** Stable cross-source identity: exact workflowInstanceId + nodeVisitId. */
function visitIdentityKey(workflowInstanceId: string, nodeVisitId: string | null): string {
  return workflowInstanceId + '|' + (nodeVisitId ?? '');
}

function entryIdentityKey(item: AttentionItem): string {
  return item.assistanceCaseId ?? visitIdentityKey(item.workflowInstanceId, item.nodeVisitId);
}

export function buildAttentionView(raw: RawAttentionSources): AttentionView {
  const byCase = new Map<string, AttentionItem>();

  for (const item of raw.owner.items) {
    byCase.set(item.assistanceCaseId, toOwnerItem(item));
  }

  for (const item of raw.human.items) {
    const human = toHumanItem(item);
    const existing = byCase.get(item.assistanceCaseId);
    if (existing) {
      byCase.set(item.assistanceCaseId, {
        ...existing,
        attentionState: 'HUMAN_REQUIRED',
        attentionAt: human.attentionAt,
      });
    } else {
      byCase.set(item.assistanceCaseId, human);
    }
  }

  const assistanceItems = [...byCase.values()];

  // Cross-source dedup: a dsh execution item is folded into an assistance
  // entry ONLY on the exact (workflowInstanceId, nodeVisitId) identity. Every
  // execution fact without that stable identity stays its own source-backed
  // entry; no entry is ever dropped.
  const byVisit = new Map<string, AttentionItem>();
  for (const item of assistanceItems) {
    if (item.nodeVisitId) {
      byVisit.set(visitIdentityKey(item.workflowInstanceId, item.nodeVisitId), item);
    }
  }

  const items = [...assistanceItems];
  for (const wire of raw.execution.items) {
    const target = byVisit.get(visitIdentityKey(wire.workflowInstanceId, wire.nodeVisitId));
    if (target && !target.executionEvidence) {
      target.executionEvidence = toExecutionEvidence(wire);
      continue;
    }
    items.push(toExecutionItem(wire));
  }

  items.sort((a, b) => {
    const byTime = b.attentionAt.localeCompare(a.attentionAt);
    if (byTime !== 0) return byTime;
    return entryIdentityKey(b).localeCompare(entryIdentityKey(a));
  });

  return {
    items,
    sources: {
      ownerAssistance: raw.owner.availability,
      humanRequired: raw.human.availability,
      executionAttention: raw.execution.availability,
    },
    ...(raw.execution.availability.available && raw.execution.counts
      ? { executionCounts: raw.execution.counts }
      : {}),
    ...(raw.execution.availability.available && raw.execution.generatedAtMs !== undefined
      ? { executionGeneratedAtMs: raw.execution.generatedAtMs }
      : {}),
  };
}
