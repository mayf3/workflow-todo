import { parseOutputMode, type OutputMode } from './cli-args.js';

export type AttentionState = 'OWNER_PENDING' | 'HUMAN_REQUIRED';

export interface AttentionItem {
  source: 'svc-workflow/owner-inbox' | 'svc-workflow/human-required';
  attentionState: AttentionState;
  workflowInstanceId: string;
  nodeVisitId: string | null;
  assistanceCaseId: string;
  domainId: string;
  definitionKey: string;
  nodeDisplayName: string;
  message: string;
  createdAt: string;
  attentionAt: string;
  detailRef: string;
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

export interface RawAttentionSources {
  owner: {
    availability: AttentionSourceAvailability;
    items: OwnerAssistanceCaseWire[];
  };
  human: {
    availability: AttentionSourceAvailability;
    items: HumanRequiredAssistanceCaseWire[];
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

  const items = [...byCase.values()].sort((a, b) => {
    const byTime = b.attentionAt.localeCompare(a.attentionAt);
    if (byTime !== 0) return byTime;
    return b.assistanceCaseId.localeCompare(a.assistanceCaseId);
  });

  return {
    items,
    sources: {
      ownerAssistance: raw.owner.availability,
      humanRequired: raw.human.availability,
      executionAttention: {
        available: false,
        reason: 'DSH_EXECUTION_ATTENTION_NOT_WIRED',
      },
    },
  };
}
