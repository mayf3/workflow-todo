/**
 * Human-readable text formatters for CLI output.
 *
 * These formatters ONLY read fields already returned by the API.
 * They do NOT make additional HTTP requests, query databases,
 * interpret workflow semantics, or modify response objects.
 *
 * NOTE: The API returns snake_case JSON.  We access fields using
 * snake_case property names directly from the parsed response.
 */

import type {
  DomainInstanceSummary,
  WorkflowInstanceDetail,
  ExecuteWorkflowTransitionResult,
} from './contracts.js';
import type { TodoWorklistPageView } from './todo-view-models.js';
import type { AttentionView } from './attention.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

function trimLines(text: string, maxLines = 10): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + '\n... (truncated)';
}

// ---------------------------------------------------------------------------
// Safe field readers (handle snake_case from API)
// ---------------------------------------------------------------------------

function str(obj: unknown, key: string, fallback = ''): string {
  if (typeof obj !== 'object' || obj === null) return fallback;
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v === 'string') return v;
  return fallback;
}

function val(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null) return undefined;
  return (obj as Record<string, unknown>)[key];
}

// ---------------------------------------------------------------------------
// Worklist formatter
// ---------------------------------------------------------------------------

export function formatWorklist(page: TodoWorklistPageView): string {
  const items = page.items;

  if (items.length === 0) {
    return 'No work items assigned to this principal.';
  }

  const lines: string[] = [`${items.length} work item${items.length !== 1 ? 's' : ''}\n`];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    lines.push(`[${i + 1}] ${item.title}`);
    lines.push(`    Node: ${item.currentNodeDisplayName}`);
    lines.push(`    Instance: ${item.workflowInstanceId}`);
    if (item.priority) lines.push(`    Priority: ${item.priority}`);
    lines.push(`    Created: ${formatTimestamp(item.createdAt)}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Detail formatter
// ---------------------------------------------------------------------------

export function formatDetail(detail: WorkflowInstanceDetail): string {
  const raw = detail as unknown as Record<string, unknown>;

  if (raw.visibility !== 'full') {
    const det = raw.detail as Record<string, unknown> | undefined;
    const inst = det?.instance as Record<string, unknown> | undefined;
    const node = inst?.current_node as Record<string, unknown> | undefined;
    return (
      `Instance: ${str(inst, 'workflow_instance_id')}\n` +
      `Status: historical (no longer actionable)\n` +
      `Current node: ${str(node, 'display_name', '?')}\n`
    );
  }

  const det = raw.detail as Record<string, unknown> | undefined;
  if (!det) return 'No detail data available.';

  const inst = det.instance as Record<string, unknown> | undefined;
  const curCtx = det.current_context as Record<string, unknown> | undefined;
  const ctxPayload = curCtx?.payload as Record<string, unknown> | undefined;
  const visit = det.current_visit as Record<string, unknown> | undefined;
  const visitNode = visit?.node as Record<string, unknown> | undefined;
  const instNode = inst?.current_node as Record<string, unknown> | undefined;

  const title = str(ctxPayload, 'title', '(no title)');
  const description = str(ctxPayload, 'description');
  const priority = str(ctxPayload, 'priority');
  const defVerId = str(inst, 'definition_version_id');
  const defKey = defVerId.slice(0, 8) + '…';
  const defStatus = str(inst, 'definition_version_status', '?');

  // agent_self_task_v1 specific context field
  const acceptanceCriteria = str(ctxPayload, 'acceptance_criteria') || str(ctxPayload, 'acceptanceCriteria');

  const lines: string[] = [title, ''];
  lines.push(`Instance: ${str(inst, 'workflow_instance_id')}`);
  lines.push(`Definition: ${defKey} v${defStatus === 'PUBLISHED' ? '1' : defStatus}`);
  lines.push(`Current node: ${str(visitNode, 'display_name', '?')} (${str(instNode, 'node_key', '?')})`);
  lines.push(`State version: ${String(val(inst, 'workflow_state_version') ?? '?')}`);
  if (priority) lines.push(`Priority: ${priority}`);
  lines.push('');

  if (description) {
    lines.push('Description');
    lines.push(trimLines(description));
    lines.push('');
  }

  if (acceptanceCriteria) {
    lines.push('Acceptance criteria');
    lines.push(trimLines(acceptanceCriteria));
    lines.push('');
  }

  // Available transitions
  const transitions = det.outgoing_transitions as Array<Record<string, unknown>> | undefined;
  if (transitions && transitions.length > 0) {
    lines.push('Available transitions');
    for (const t of transitions) {
      const effect = str(t, 'transition_effect', '?').toLowerCase();
      const targetNode = t.target_node as Record<string, unknown> | undefined;
      const targetName = str(targetNode, 'display_name', '?');
      const execMarker = t.executable_for_actor ? '' : ' (blocked)';
      const blockedInfo = t.blocked_reason ? ` — ${str(t, 'blocked_reason')}` : '';
      lines.push(`  - ${effect} → ${targetName}${execMarker}${blockedInfo}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Advance result formatter
// ---------------------------------------------------------------------------

export function formatAdvanceResult(
  instanceId: string,
  result: ExecuteWorkflowTransitionResult,
  _detail?: WorkflowInstanceDetail,
): string {
  const lines: string[] = ['Transition succeeded', ''];
  lines.push(`Instance: ${instanceId}`);
  lines.push(`State version: ${result.workflowStateVersion}`);
  lines.push(`Event sequence: ${result.eventSequence}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Domain list formatter
// ---------------------------------------------------------------------------

/** Format a UUID for display, showing the last 8 chars with an ellipsis prefix.
 *  The leading segment is uniform for all principals in this domain; the
 *  suffix varies and makes identities distinguishable. */
function fmtId(uuid: string): string {
  return uuid.length >= 8 ? '…' + uuid.slice(-8) : uuid;
}

function fmtDisplayName(uuid: string | null): string {
  if (!uuid) return '-';
  return uuid.length >= 8 ? '…' + uuid.slice(-8) : uuid;
}

export function formatDomainWorklist(items: DomainInstanceSummary[]): string {
  if (items.length === 0) {
    return 'No instances found.';
  }

  const header = `${'='.repeat(60)}
  Domain Instances (${items.length} total)
${'='.repeat(60)}
`;

  const lines: string[] = [header];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const raw = item as unknown as Record<string, unknown>;

    const title = item.title ?? '(no title)';
    const defKey = item.definition_key;
    // API returns snake_case; access via raw cast
    const nodeRaw = item.current_node as unknown as Record<string, unknown>;
    const nodeKey = str(nodeRaw, 'node_key', '?');
    const nodeType = str(nodeRaw, 'node_type', '?');
    const creator = fmtId(item.created_by_principal_id);
    const assignee = item.current_assignee_principal_id
      ? fmtId(item.current_assignee_principal_id)
      : '-';
    const created = formatTimestamp(item.created_at);
    const updated = formatTimestamp(item.updated_at);
    const instanceId = fmtId(item.workflow_instance_id);

    lines.push(`[${i + 1}] ${title}`);
    lines.push(`    Instance: ${instanceId}  Definition: ${defKey}`);
    lines.push(`    Node: ${nodeKey} (${nodeType})  Creator: ${creator}`);
    lines.push(`    Assignee: ${assignee}  Created: ${created}  Updated: ${updated}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// JSON mode helper
// ---------------------------------------------------------------------------

export function writeJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}


// ---------------------------------------------------------------------------
// Attention formatter (read-only)
// ---------------------------------------------------------------------------

export function formatAttention(view: AttentionView): string {
  const lines: string[] = ['Attention items: ' + view.items.length, ''];

  if (view.items.length === 0) {
    lines.push('No authoritative attention items are currently visible.');
  } else {
    for (const item of view.items) {
      lines.push('[' + item.attentionState + '] ' + (item.message || '(no message)'));
      lines.push('  Source: ' + item.source);
      lines.push('  Workflow: ' + item.workflowInstanceId);
      if (item.assistanceCaseId) lines.push('  Assistance: ' + item.assistanceCaseId);
      if (item.nodeVisitId) lines.push('  Node visit: ' + item.nodeVisitId);
      if (item.nodeDisplayName) lines.push('  Node: ' + item.nodeDisplayName);
      if (item.kind === 'execution') {
        if (item.attemptCount !== undefined) {
          lines.push(
            '  Attempts: ' + item.attemptCount
              + (item.attemptBudgetExhausted ? ' (budget exhausted)' : ''),
          );
        }
        if (item.agentId) lines.push('  Agent: ' + item.agentId);
        if (item.sessionId) lines.push('  Session: ' + item.sessionId);
        if (item.attentionAt) lines.push('  Updated: ' + formatTimestamp(item.attentionAt));
      } else {
        lines.push('  Attention at: ' + formatTimestamp(item.attentionAt));
        const evidence = item.executionEvidence;
        if (evidence) {
          let summary =
            '  Execution evidence (' + evidence.source + '): ' + evidence.executionState;
          if (evidence.attemptCount !== undefined) {
            summary += ', attempts: ' + evidence.attemptCount
              + (evidence.attemptBudgetExhausted ? ' (budget exhausted)' : '');
          }
          lines.push(summary);
        }
      }
      lines.push('  Detail: ' + item.detailRef);
      lines.push('');
    }
  }

  lines.push('Sources');
  lines.push(
    '  Owner assistance: '
      + (view.sources.ownerAssistance.available
        ? 'available'
        : 'unavailable (' + (view.sources.ownerAssistance.reason ?? 'unknown') + ')'),
  );
  lines.push(
    '  Human required: '
      + (view.sources.humanRequired.available
        ? 'available'
        : 'unavailable (' + (view.sources.humanRequired.reason ?? 'unknown') + ')'),
  );
  lines.push(
    '  Execution attention: '
      + (view.sources.executionAttention.available
        ? 'available'
        : 'unavailable (' + (view.sources.executionAttention.reason ?? 'unknown') + ')'),
  );
  if (view.executionCounts) {
    lines.push(
      '  Execution attention counts: '
        + Object.entries(view.executionCounts).map(([k, v]) => k + '=' + v).join(', '),
    );
  }

  return lines.join('\n').trimEnd();
}
