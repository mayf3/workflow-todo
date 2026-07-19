#!/usr/bin/env node

import { env, resolveWorkflowPath, validateWorkflowPath } from './config.js';
import type { WorkflowPath } from './config.js';
import { WorkflowClient } from './client.js';
import type { CreateWorkflowInstanceInput, DomainInstanceSummary } from './contracts.js';
import { formatWorklist, formatDetail, formatAdvanceResult, formatDomainWorklist, writeJson } from './formatters.js';
import { legacyWorklistPageToView } from './legacy-adapter.js';
import { parseOutputMode } from './cli-args.js';
import type { OutputMode } from './cli-args.js';
import { createSdkAuthWorkflowClient } from './sdk-auth-client-factory.js';

// SDK Adapter imports (used only when path === sdk_auth_v1)
import {
  toWorklistPageView as sdkToWorklistPageView,
  toCreateResultView as sdkToCreateResultView,
  toTransitionResultView as sdkToTransitionResultView,
  toProductError as sdkToProductError,
} from './sdk-adapter.js';

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) { showUsage(); return; }

  const command = args[0];
  const rest = args.slice(1);

  // Resolve workflow path (default: legacy)
  const rawPath = env.WORKFLOW_TODO_WORKFLOW_PATH;
  const workflowPath: WorkflowPath = validateWorkflowPath(rawPath);

  switch (command) {
    case 'create-quick': {
      if (workflowPath === 'sdk_auth_v1') {
        await cmdCreateQuickSdk(rest);
      } else {
        const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
        await cmdCreateWithDef(client, rest, env.PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID, 'quick');
      }
      break;
    }
    case 'create-agent': {
      if (workflowPath === 'sdk_auth_v1') {
        await cmdCreateAgentSdk(rest);
      } else {
        const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
        await cmdCreateWithDef(client, rest, env.AGENT_SELF_TASK_DEFINITION_VERSION_ID, 'agent');
      }
      break;
    }
    case 'create': {
      if (workflowPath === 'sdk_auth_v1') {
        await cmdCreateSdk(rest);
      } else {
        const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
        await cmdCreate(client, rest);
      }
      break;
    }
    case 'my-worklist': {
      if (workflowPath === 'sdk_auth_v1') {
        await cmdWorklistSdk(rest);
      } else {
        const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
        await cmdWorklist(client, rest);
      }
      break;
    }
    case 'list': {
      if (workflowPath === 'sdk_auth_v1') {
        await cmdListSdk(rest);
      } else {
        const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
        await cmdList(client, rest);
      }
      break;
    }
    case 'detail': {
      if (workflowPath === 'sdk_auth_v1') {
        await cmdDetailSdk(rest);
      } else {
        const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
        await cmdDetail(client, rest);
      }
      break;
    }
    case 'advance': {
      if (workflowPath === 'sdk_auth_v1') {
        await cmdAdvanceSdk(rest);
      } else {
        const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
        await cmdAdvance(client, rest);
      }
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      showUsage();
      process.exit(1);
  }
}

function makeClient(accessToken: string): WorkflowClient {
  return new WorkflowClient({
    baseUrl: env.SVC_WORKFLOW_BASE_URL,
    accessTokenProvider: () => accessToken,
    requestTimeoutMs: parseInt(env.REQUEST_TIMEOUT_MS, 10),
    maxAttempts: parseInt(env.MAX_ATTEMPTS, 10),
  });
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
// Legacy command handlers (unchanged)
// ---------------------------------------------------------------------------

async function cmdCreate(client: WorkflowClient, args: string[]) {
  // Default create uses AGENT_SELF_TASK_DEFINITION_VERSION_ID for backward compatibility
  await cmdCreateWithDef(client, args, env.DEFINITION_VERSION_ID, 'default');
}

async function cmdCreateWithDef(client: WorkflowClient, args: string[], defVersionId: string, label: string) {
  const { mode, cleanArgs } = resolveMode(args);
  const title = extractArg(cleanArgs, '--title');
  const description = extractArg(cleanArgs, '--description');
  const acceptanceCriteria = extractArg(cleanArgs, '--acceptance-criteria');

  if (!title) {
    console.error(`Usage: workflow-todo ${label === 'quick' ? 'create-quick' : 'create-agent'} --title <title> [--description <desc> --acceptance-criteria <criteria>] [--json]`);
    process.exit(1);
  }

  // Build context payload matching the target definition's schema.
  // personal_quick_item_v1: accepts { title, description, priority }
  // agent_self_task_v1:     requires { title, description, acceptanceCriteria }
  const isQuick = label === 'quick';
  const payload: Record<string, string> = { title };
  if (description) payload.description = description;
  if (!isQuick && acceptanceCriteria) payload.acceptanceCriteria = acceptanceCriteria;

  const input: CreateWorkflowInstanceInput = {
    domainId: env.DOMAIN_ID,
    definitionVersionId: defVersionId,
    metadata: {},
    contextPayload: payload,
  };

  const result = await client.create(
    input,
    { idempotencyKey: `create-${label}-${Date.now()}-${randomSuffix()}` },
  );

  if (mode === 'json') { writeJson(result); return; }
  console.log(`Instance created: ${result.workflowInstanceId}`);
  console.log(`Definition: ${label}`);
  console.log(`State version: ${result.workflowStateVersion}`);
}

async function cmdWorklist(client: WorkflowClient, args: string[]) {
  const { mode, cleanArgs: _cleanArgs } = resolveMode(args);
  const page = await client.worklistAssignedToMe();

  // Convert legacy response to view model for the formatter
  const view = legacyWorklistPageToView(page);

  if (mode === 'json') { writeJson(view); return; }
  if (view.items.length === 0) {
    console.log('No work items assigned to this principal.');
    return;
  }
  console.log(formatWorklist(view));
}

/// workflow-todo list --all [--status active|completed|cancelled|all] [--assignee <uuid>] [--definition quick|agent] [--json]
async function cmdList(client: WorkflowClient, args: string[]) {
  const { mode, cleanArgs } = resolveMode(args);

  // Require --all flag
  if (!cleanArgs.includes('--all')) {
    console.error('Usage: workflow-todo list --all [--status active|completed|cancelled|all] [--assignee <uuid>] [--definition quick|agent] [--json]');
    process.exit(1);
  }

  // Parse product-level filters and map to API parameters
  const statusFlag = extractArg(cleanArgs, '--status') ?? 'active';
  const assigneeId = extractArg(cleanArgs, '--assignee');
  const defFlag = extractArg(cleanArgs, '--definition');

  // Map product terminology to API lifecycle + nodeKey
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

  // Map definition flag to definitionKey
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
  const allItems: DomainInstanceSummary[] = [];
  const seenInstanceIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: { createdAt: string; id: string } | undefined;
  let pageNum = 0;

  do {
    pageNum++;
    const page = await client.listDomainInstances({
      domainId: env.DOMAIN_ID,
      limit: 100,
      lifecycle,
      currentNodeKey,
      definitionKey,
      assigneePrincipalId: assigneeId,
      beforeCreatedAt: cursor?.createdAt,
      beforeId: cursor?.id,
    });

    // Fail on duplicate cursor (paginated API not advancing)
    if (cursor) {
      const cursorKey = `${cursor.createdAt}|${cursor.id}`;
      if (seenCursors.has(cursorKey)) {
        throw new Error(`PAGINATION_STALL: cursor ${cursorKey} was already returned`);
      }
      seenCursors.add(cursorKey);
    }

    // Fail on duplicate instance IDs across pages
    for (const item of page.items) {
      if (seenInstanceIds.has(item.workflow_instance_id)) {
        throw new Error(`PAGINATION_DUPLICATE: instance ${item.workflow_instance_id} appeared on multiple pages`);
      }
      seenInstanceIds.add(item.workflow_instance_id);
    }

    allItems.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  // Output
  if (mode === 'json') {
    writeJson({ total: allItems.length, items: allItems });
    return;
  }

  if (allItems.length === 0) {
    console.log('No instances found.');
    return;
  }

  console.log(formatDomainWorklist(allItems));
}

async function cmdDetail(client: WorkflowClient, args: string[]) {
  const { mode, cleanArgs } = resolveMode(args);
  const instanceId = extractArg(cleanArgs, '--instance-id');
  if (!instanceId) {
    console.error('Usage: workflow-todo detail --instance-id <uuid> [--json]');
    process.exit(1);
  }

  const detail = await client.detail(instanceId);
  if (mode === 'json') { writeJson(detail); return; }
  console.log(formatDetail(detail));
}

async function cmdAdvance(client: WorkflowClient, args: string[]) {
  const { mode, cleanArgs } = resolveMode(args);
  const instanceId = extractArg(cleanArgs, '--instance-id');
  const summary = extractArg(cleanArgs, '--summary');

  if (!instanceId || !summary) {
    console.error('Usage: workflow-todo advance --instance-id <uuid> --summary <text> [--json]');
    process.exit(1);
  }

  // Read-before-write
  const detail = await client.detail(instanceId);
  if (detail.visibility !== 'full') {
    console.error('Instance not visible as full detail (may be historical or not found)');
    process.exit(1);
  }

  const { outgoing_transitions, instance } = detail.detail;
  const advanceTransition = outgoing_transitions.find(
    (t: { transition_effect: string; executable_for_actor: boolean }) =>
      t.transition_effect === 'ADVANCE' && t.executable_for_actor === true,
  );
  if (!advanceTransition) {
    const blockedReason = outgoing_transitions.find(
      (t: { transition_effect: string }) => t.transition_effect === 'ADVANCE',
    )?.blocked_reason ?? 'ADVANCE not available';
    console.error(`Cannot advance: ${blockedReason}`);
    process.exit(1);
  }

  const result = await client.transition(
    instanceId,
    {
      transitionDefinitionId: advanceTransition.transition_id,
      expectedWorkflowStateVersion: instance.workflow_state_version,
      submissionPayload: { summary },
    },
    { idempotencyKey: `advance-${Date.now()}-${randomSuffix()}` },
  );

  if (mode === 'json') { writeJson(result); return; }
  console.log(formatAdvanceResult(instanceId, result, detail));
}

// ---------------------------------------------------------------------------
// SDK Auth V1 command handlers
// ---------------------------------------------------------------------------

/**
 * Create a WorkflowClient configured via the official Machine Token Provider.
 * Fail-closed: any auth or transport error propagates.
 */
function makeSdkClient() {
  return createSdkAuthWorkflowClient();
}

async function cmdCreateQuickSdk(args: string[]) {
  await cmdCreateWithDefSdk(args, env.PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID, 'quick');
}

async function cmdCreateAgentSdk(args: string[]) {
  await cmdCreateWithDefSdk(args, env.AGENT_SELF_TASK_DEFINITION_VERSION_ID, 'agent');
}

async function cmdCreateSdk(args: string[]) {
  await cmdCreateWithDefSdk(args, env.DEFINITION_VERSION_ID, 'default');
}

async function cmdCreateWithDefSdk(args: string[], defVersionId: string, label: string) {
  const { mode, cleanArgs } = resolveMode(args);
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

  const client = makeSdkClient();
  const result = await client.create(
    input,
    { idempotencyKey: `create-${label}-${Date.now()}-${randomSuffix()}` },
  );

  // Convert SDK response to view model for consistent JSON output
  const view = sdkToCreateResultView(result);

  if (mode === 'json') { writeJson(view); return; }
  console.log(`Instance created: ${view.workflowInstanceId}`);
  console.log(`Definition: ${label}`);
  console.log(`State version: ${view.workflowStateVersion}`);
}

/**
 * SDK-based my-worklist via Workflow SDK + official Machine Token Provider.
 * Fail-closed: no fallback to legacy on failure.
 */
async function cmdWorklistSdk(args: string[]) {
  const { mode } = resolveMode(args);

  const client = makeSdkClient();
  const page = await client.worklistAssignedToMe();

  // Convert SDK WorklistPage to view model
  const view = sdkToWorklistPageView(page);

  if (mode === 'json') { writeJson(view); return; }
  if (view.items.length === 0) {
    console.log('No work items assigned to this principal.');
    return;
  }
  console.log(formatWorklist(view));
}

/**
 * SDK-based list --all via Workflow SDK + official Machine Token Provider.
 */
async function cmdListSdk(args: string[]) {
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

  const client = makeSdkClient();

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

    // SDK DomainInstancePage uses snake_case cursor
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

  // formatDomainWorklist expects DomainInstanceSummary[] (legacy type),
  // but accesses fields by string key. Cast safely.
  console.log(formatDomainWorklist(allItems as unknown as DomainInstanceSummary[]));
}

/**
 * SDK-based detail view via Workflow SDK + official Machine Token Provider.
 */
async function cmdDetailSdk(args: string[]) {
  const { mode, cleanArgs } = resolveMode(args);
  const instanceId = extractArg(cleanArgs, '--instance-id');
  if (!instanceId) {
    console.error('Usage: workflow-todo detail --instance-id <uuid> [--json]');
    process.exit(1);
  }

  const client = makeSdkClient();
  const detail = await client.detail(instanceId);

  // The SDK detail response uses snake_case fields matching the legacy format.
  // formatDetail accesses fields by string key, so a cast is sufficient.
  if (mode === 'json') {
    writeJson(detail);
    return;
  }
  // Cast to any for the formatter which accesses fields by string keys
  console.log(formatDetail(detail as unknown as Parameters<typeof formatDetail>[0]));
}

/**
 * SDK-based advance/transition via Workflow SDK + official Machine Token Provider.
 * Fail-closed: no admin token fallback, no principal override.
 */
async function cmdAdvanceSdk(args: string[]) {
  const { mode, cleanArgs } = resolveMode(args);
  const instanceId = extractArg(cleanArgs, '--instance-id');
  const summary = extractArg(cleanArgs, '--summary');

  if (!instanceId || !summary) {
    console.error('Usage: workflow-todo advance --instance-id <uuid> --summary <text> [--json]');
    process.exit(1);
  }

  const client = makeSdkClient();

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
    { idempotencyKey: `advance-${Date.now()}-${randomSuffix()}` },
  );

  const view = sdkToTransitionResultView(result);

  if (mode === 'json') { writeJson(view); return; }
  // formatAdvanceResult accesses workflowStateVersion and eventSequence
  // Cast result (which has these fields) to the legacy type for the formatter.
  console.log(formatAdvanceResult(instanceId, result as unknown as Parameters<typeof formatAdvanceResult>[1]));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showUsage() {
  console.log(`
Usage:
  workflow-todo create-quick --title <title> [--description <desc> --acceptance-criteria <criteria>]
      → 普通 Todo (personal_quick_item_v1)

  workflow-todo create-agent --title <title> [--description <desc> --acceptance-criteria <criteria>]
      → 正式 Agent 工作 (agent_self_task_v1)

  workflow-todo create --title <title> [--description <desc> --acceptance-criteria <criteria>]
      → Deprecated: defaults to agent_self_task_v1 (same as create-agent)

  workflow-todo my-worklist [--json]
  workflow-todo list --all [--status active|completed|cancelled|all] [--assignee <uuid>] [--definition quick|agent] [--json]
  workflow-todo detail --instance-id <uuid> [--json]
  workflow-todo advance --instance-id <uuid> --summary <text> [--json]
`);
}

function extractArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 10);
}

main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
