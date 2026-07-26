#!/usr/bin/env node

/**
 * workflow-todo CLI — SDK Auth V1 runtime path only.
 *
 * No legacy path, no static token, no workflow path flag.
 * The Workflow SDK (@workflow-foundation/sdk) and the official
 * Machine Token Provider (@unified-auth/machine-token-provider)
 * are the only runtime dependencies.
 */

import { env } from './config.js';
import { createSdkAuthWorkflowClient } from './sdk-auth-client-factory.js';
import {
  toWorklistPageView,
  toCreateResultView,
  toTransitionResultView,
  toProductError,
} from './sdk-adapter.js';
import { formatWorklist, formatDetail, formatAdvanceResult, formatDomainWorklist, writeJson } from './formatters.js';
import { parseOutputMode, resolveIdempotencyKey } from './cli-args.js';
import type { OutputMode } from './cli-args.js';
import type { DomainInstanceSummary } from './contracts.js';

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) { showUsage(); return; }

  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case 'create-quick':  await cmdCreateQuick(rest); break;
    case 'create-agent':  await cmdCreateAgent(rest); break;
    case 'create':        await cmdCreate(rest); break;
    case 'my-worklist':   await cmdWorklist(rest); break;
    case 'list':          await cmdList(rest); break;
    case 'detail':        await cmdDetail(rest); break;
    case 'advance':       await cmdAdvance(rest); break;
    default:
      console.error(`Unknown command: ${command}`);
      showUsage();
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Client factory — uses official Machine Token Provider
// ---------------------------------------------------------------------------

function makeClient() {
  return createSdkAuthWorkflowClient();
}

// ---------------------------------------------------------------------------
// Output mode
// ---------------------------------------------------------------------------

function resolveMode(args: string[]): { mode: OutputMode; cleanArgs: string[] } {
  const parsed = parseOutputMode(args);
  if (parsed.error) {
    console.error(`ERROR: ${parsed.error}`);
    process.exit(1);
  }
  return { mode: parsed.mode, cleanArgs: parsed.remainingArgs };
}

// ---------------------------------------------------------------------------
// Command handlers — SDK Auth V1 only
// ---------------------------------------------------------------------------

async function cmdCreateQuick(args: string[]) {
  await cmdCreateWithDef(args, env.PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID, 'quick');
}

async function cmdCreateAgent(args: string[]) {
  await cmdCreateWithDef(args, env.AGENT_SELF_TASK_DEFINITION_VERSION_ID, 'agent');
}

async function cmdCreate(args: string[]) {
  await cmdCreateWithDef(args, env.DEFINITION_VERSION_ID, 'default');
}

async function cmdCreateWithDef(args: string[], defVersionId: string, label: string) {
  const { mode, cleanArgs: modeCleanArgs } = resolveMode(args);
  const ikResult = resolveIdempotencyKey(modeCleanArgs, `create-${label}`);
  if (ikResult.error) {
    console.error(`ERROR: ${ikResult.error}`);
    process.exit(1);
  }
  const cleanArgs = ikResult.cleanArgs;
  const idempotencyKey = ikResult.key!;

  const title = extractArg(cleanArgs, '--title');
  const description = extractArg(cleanArgs, '--description');
  const acceptanceCriteria = extractArg(cleanArgs, '--acceptance-criteria');

  if (!title) {
    console.error(`Usage: workflow-todo ${label === 'quick' ? 'create-quick' : 'create-agent'} --title <title> [--description <desc> --acceptance-criteria <criteria>] [--json]`);
    process.exit(1);
  }

  const isQuick = label === 'quick';
  const payload: Record<string, string> = { title };
  if (description) payload.description = description;
  if (!isQuick && acceptanceCriteria) payload.acceptanceCriteria = acceptanceCriteria;

  const input = {
    domainId: env.DOMAIN_ID,
    definitionVersionId: defVersionId,
    metadata: {},
    contextPayload: payload,
  };

  const client = makeClient();
  const result = await client.create(
    input,
    { idempotencyKey },
  );

  const view = toCreateResultView(result);

  if (mode === 'json') { writeJson(view); return; }
  console.log(`Instance created: ${view.workflowInstanceId}`);
  console.log(`Definition: ${label}`);
  console.log(`State version: ${view.workflowStateVersion}`);
}

/**
 * my-worklist via Workflow SDK + official Machine Token Provider.
 * Fail-closed: no fallback on failure.
 */
async function cmdWorklist(args: string[]) {
  const { mode } = resolveMode(args);

  const client = makeClient();
  const page = await client.worklistAssignedToMe();

  const view = toWorklistPageView(page);

  if (mode === 'json') { writeJson(view); return; }
  if (view.items.length === 0) {
    console.log('No work items assigned to this principal.');
    return;
  }
  console.log(formatWorklist(view));
}

/// workflow-todo list --all [--status active|completed|cancelled|all] [--assignee <uuid>] [--definition quick|agent] [--json]
async function cmdList(args: string[]) {
  const { mode, cleanArgs } = resolveMode(args);

  if (!cleanArgs.includes('--all')) {
    console.error('Usage: workflow-todo list --all [--status active|completed|cancelled|all] [--assignee <uuid>] [--definition quick|agent] [--json]');
    process.exit(1);
  }

  const statusFlag = extractArg(cleanArgs, '--status') ?? 'active';
  const assigneeId = extractArg(cleanArgs, '--assignee');
  const defFlag = extractArg(cleanArgs, '--definition');

  let lifecycle: 'active' | 'terminal' | 'all';
  let currentNodeKey: string | undefined;

  switch (statusFlag) {
    case 'active':
      lifecycle = 'active';
      break;
    case 'completed':
      lifecycle = 'terminal';
      currentNodeKey = 'completed';
      break;
    case 'cancelled':
      lifecycle = 'terminal';
      currentNodeKey = 'cancelled';
      break;
    case 'all':
      lifecycle = 'all';
      break;
    default:
      console.error(`ERROR: Invalid --status '${statusFlag}'. Use: active, completed, cancelled, all`);
      process.exit(1);
  }

  let definitionKey: string | undefined;
  if (defFlag === 'quick') {
    definitionKey = 'personal_quick_item_v1';
  } else if (defFlag === 'agent') {
    definitionKey = 'agent_self_task_v1';
  } else if (defFlag !== undefined) {
    console.error(`ERROR: Invalid --definition '${defFlag}'. Use: quick, agent`);
    process.exit(1);
  }

  // Auto-paginate with fail-close semantics
  const allItems: Record<string, unknown>[] = [];
  const seenInstanceIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: { beforeCreatedAt?: string; beforeId?: string } | undefined;

  const client = makeClient();

  do {
    const page = await client.listDomainInstances({
      domainId: env.DOMAIN_ID,
      limit: 100,
      lifecycle,
      currentNodeKey,
      definitionKey,
      assigneePrincipalId: assigneeId,
      beforeCreatedAt: cursor?.beforeCreatedAt,
      beforeId: cursor?.beforeId,
    });

    if (cursor) {
      const cursorKey = `${cursor.beforeCreatedAt}|${cursor.beforeId}`;
      if (seenCursors.has(cursorKey)) {
        throw new Error(`PAGINATION_STALL: cursor ${cursorKey} was already returned`);
      }
      seenCursors.add(cursorKey);
    }

    for (const item of page.items) {
      if (seenInstanceIds.has(item.workflow_instance_id)) {
        throw new Error(`PAGINATION_DUPLICATE: instance ${item.workflow_instance_id} appeared on multiple pages`);
      }
      seenInstanceIds.add(item.workflow_instance_id);
    }

    allItems.push(...(page.items as unknown as Record<string, unknown>[]));
    cursor = page.next_cursor
      ? { beforeCreatedAt: page.next_cursor.created_at, beforeId: page.next_cursor.id }
      : undefined;
  } while (cursor);

  if (mode === 'json') {
    writeJson({ total: allItems.length, items: allItems });
    return;
  }

  if (allItems.length === 0) {
    console.log('No instances found.');
    return;
  }

  console.log(formatDomainWorklist(allItems as unknown as DomainInstanceSummary[]));
}

/**
 * detail via Workflow SDK + official Machine Token Provider.
 */
async function cmdDetail(args: string[]) {
  const { mode, cleanArgs } = resolveMode(args);
  const instanceId = extractArg(cleanArgs, '--instance-id');
  if (!instanceId) {
    console.error('Usage: workflow-todo detail --instance-id <uuid> [--json]');
    process.exit(1);
  }

  const client = makeClient();
  const detail = await client.detail(instanceId);

  if (mode === 'json') {
    writeJson(detail);
    return;
  }
  // Cast for formatter which accesses fields by string keys
  console.log(formatDetail(detail as unknown as Parameters<typeof formatDetail>[0]));
}

/**
 * advance/transition via Workflow SDK + official Machine Token Provider.
 * Fail-closed: no admin token fallback, no principal override.
 */
async function cmdAdvance(args: string[]) {
  const { mode, cleanArgs: modeCleanArgs } = resolveMode(args);
  const ikResult = resolveIdempotencyKey(modeCleanArgs, 'advance');
  if (ikResult.error) {
    console.error(`ERROR: ${ikResult.error}`);
    process.exit(1);
  }
  const cleanArgs = ikResult.cleanArgs;
  const idempotencyKey = ikResult.key!;
  const instanceId = extractArg(cleanArgs, '--instance-id');
  const summary = extractArg(cleanArgs, '--summary');

  if (!instanceId || !summary) {
    console.error('Usage: workflow-todo advance --instance-id <uuid> --summary <text> [--json]');
    process.exit(1);
  }

  const client = makeClient();

  // Read-before-write
  const detail = await client.detail(instanceId);
  const rawDetail = detail as unknown as Record<string, unknown>;
  if (rawDetail.visibility !== 'full') {
    console.error('Instance not visible as full detail (may be historical or not found)');
    process.exit(1);
  }

  const det = rawDetail.detail as Record<string, unknown>;
  const instance = det.instance as Record<string, unknown>;
  const outgoingTransitions = det.outgoing_transitions as Array<Record<string, unknown>> | undefined;

  const advanceTransition = outgoingTransitions?.find(
    (t: { transition_effect?: string; executable_for_actor?: boolean }) =>
      t.transition_effect === 'ADVANCE' && t.executable_for_actor === true,
  );
  if (!advanceTransition) {
    const blockedReason = outgoingTransitions?.find(
      (t: { transition_effect?: string }) => t.transition_effect === 'ADVANCE',
    )?.blocked_reason ?? 'ADVANCE not available';
    console.error(`Cannot advance: ${blockedReason}`);
    process.exit(1);
  }

  const result = await client.transition(
    instanceId,
    {
      transitionDefinitionId: advanceTransition.transition_id as string,
      expectedWorkflowStateVersion: instance.workflow_state_version as number,
      submissionPayload: { summary },
    },
    { idempotencyKey },
  );

  const view = toTransitionResultView(result);

  if (mode === 'json') { writeJson(view); return; }
  console.log(formatAdvanceResult(instanceId, result as unknown as Parameters<typeof formatAdvanceResult>[1]));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showUsage() {
  console.log(`
Usage:
  workflow-todo create-quick --title <title> [--description <desc> --acceptance-criteria <criteria>] [--idempotency-key <key>]
      → 普通 Todo (personal_quick_item_v1)

  workflow-todo create-agent --title <title> [--description <desc> --acceptance-criteria <criteria>] [--idempotency-key <key>]
      → 正式 Agent 工作 (agent_self_task_v1)

  workflow-todo create --title <title> [--description <desc> --acceptance-criteria <criteria>] [--idempotency-key <key>]
      → Deprecated: defaults to agent_self_task_v1 (same as create-agent)

  workflow-todo my-worklist [--json]
  workflow-todo list --all [--status active|completed|cancelled|all] [--assignee <uuid>] [--definition quick|agent] [--json]
  workflow-todo detail --instance-id <uuid> [--json]
  workflow-todo advance --instance-id <uuid> --summary <text> [--idempotency-key <key>] [--json]
`);
}

function extractArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
