#!/usr/bin/env node

import { env } from './config.js';
import { WorkflowClient } from './client.js';
import type { CreateWorkflowInstanceInput } from './contracts.js';
import { formatWorklist, formatDetail, formatAdvanceResult, writeJson } from './formatters.js';
import { parseOutputMode } from './cli-args.js';
import type { OutputMode } from './cli-args.js';

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) { showUsage(); return; }

  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case 'create-quick': {
      // 普通 Todo → personal_quick_item_v1
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdCreateWithDef(client, rest, env.PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID, 'quick');
      break;
    }
    case 'create-agent': {
      // 正式 Agent 工作 → agent_self_task_v1
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdCreateWithDef(client, rest, env.AGENT_SELF_TASK_DEFINITION_VERSION_ID, 'agent');
      break;
    }
    case 'create': {
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdCreate(client, rest);
      break;
    }
    case 'my-worklist': {
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdWorklist(client, rest);
      break;
    }
    case 'detail': {
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdDetail(client, rest);
      break;
    }
    case 'advance': {
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdAdvance(client, rest);
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
// Command handlers
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

  if (mode === 'json') { writeJson(page); return; }
  if (page.items.length === 0) {
    console.log('No work items assigned to this principal.');
    return;
  }
  console.log(formatWorklist(page));
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
