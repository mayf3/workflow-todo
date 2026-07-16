#!/usr/bin/env node

import { env } from './config.js';
import { WorkflowClient } from './client.js';
import type { WorkflowInstanceDetail } from './contracts.js';

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showUsage();
    return;
  }

  const client = new WorkflowClient({
    baseUrl: env.SVC_WORKFLOW_BASE_URL,
    accessTokenProvider: () => env.SVC_WORKFLOW_ACCESS_TOKEN,
    requestTimeoutMs: parseInt(env.REQUEST_TIMEOUT_MS, 10),
    maxAttempts: parseInt(env.MAX_ATTEMPTS, 10),
  });

  const command = args[0];

  switch (command) {
    case 'create':
      await cmdCreate(client, args.slice(1));
      break;
    case 'my-worklist':
      await cmdWorklist(client);
      break;
    case 'detail':
      await cmdDetail(client, args.slice(1));
      break;
    case 'advance':
      await cmdAdvance(client, args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showUsage();
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdCreate(client: WorkflowClient, args: string[]) {
  const title = extractArg(args, '--title');
  const description = extractArg(args, '--description');
  const acceptanceCriteria = extractArg(args, '--acceptance-criteria');

  if (!title || !description || !acceptanceCriteria) {
    console.error('Usage: workflow-todo create --title <title> --description <desc> --acceptance-criteria <criteria>');
    process.exit(1);
  }

  const contextPayload = {
    title,
    description,
    acceptanceCriteria,
  };

  const idempotencyKey = `create-${Date.now()}-${randomSuffix()}`;

  const result = await client.create(
    {
      domainId: env.DOMAIN_ID,
      definitionVersionId: env.DEFINITION_VERSION_ID,
      metadata: {},
      contextPayload,
    },
    { idempotencyKey },
  );

  console.log(JSON.stringify(result, null, 2));
}

async function cmdWorklist(client: WorkflowClient) {
  const page = await client.worklistAssignedToMe();
  if (page.items.length === 0) {
    console.log('No assigned items.');
    return;
  }
  console.log(JSON.stringify(page, null, 2));
}

async function cmdDetail(client: WorkflowClient, args: string[]) {
  const instanceId = extractArg(args, '--instance-id');
  if (!instanceId) {
    console.error('Usage: workflow-todo detail --instance-id <uuid>');
    process.exit(1);
  }

  const detail = await client.detail(instanceId);
  console.log(JSON.stringify(detail, null, 2));
}

async function cmdAdvance(client: WorkflowClient, args: string[]) {
  const instanceId = extractArg(args, '--instance-id');
  const summary = extractArg(args, '--summary');

  if (!instanceId || !summary) {
    console.error('Usage: workflow-todo advance --instance-id <uuid> --summary <text>');
    process.exit(1);
  }

  // Read-before-write: fetch detail to get current state version and verify ADVANCE availability
  const detail = await client.detail(instanceId);

  if (detail.visibility !== 'full') {
    console.error('Instance not visible as full detail (may be historical or not found)');
    process.exit(1);
  }

  const { outgoingTransitions, instance } = detail.detail;

  // Find the ADVANCE transition executable for the current actor
  const advanceTransition = outgoingTransitions.find(
    (t) => t.transitionEffect === 'ADVANCE' && t.executableForActor === true,
  );

  if (!advanceTransition) {
    const blockedReason = outgoingTransitions.find((t) => t.transitionEffect === 'ADVANCE')
      ?.blockedReason ?? 'ADVANCE not available';
    console.error(`Cannot advance: ${blockedReason}`);
    process.exit(1);
  }

  const stateVersion = instance.workflowStateVersion;
  const idempotencyKey = `advance-${Date.now()}-${randomSuffix()}`;

  const result = await client.transition(
    instanceId,
    {
      transitionDefinitionId: advanceTransition.transitionId,
      expectedWorkflowStateVersion: stateVersion,
      submissionPayload: { summary },
    },
    { idempotencyKey },
  );

  console.log(JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showUsage() {
  console.log(`
Usage:
  workflow-todo create --title <title> --description <desc> --acceptance-criteria <criteria>
  workflow-todo my-worklist
  workflow-todo detail --instance-id <uuid>
  workflow-todo advance --instance-id <uuid> --summary <text>
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
