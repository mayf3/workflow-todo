#!/usr/bin/env node

import { env } from './config.js';
import { WorkflowClient } from './client.js';
import {
  validateManifest,
  importManifest,
  scanForSecrets,
  validateSourceDigest,
  validateTokenSubject,
  validateDefinitionVersion,
  ManifestValidationError,
  SourceDigestMismatchError,
  TokenSubjectMismatchError,
  DefinitionValidationError,
} from './legacy-import.js';
import { sha256Jcs } from './digest.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showUsage();
    return;
  }

  const command = args[0];

  switch (command) {
    case 'create': {
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdCreate(client, args.slice(1));
      break;
    }
    case 'my-worklist': {
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdWorklist(client);
      break;
    }
    case 'detail': {
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdDetail(client, args.slice(1));
      break;
    }
    case 'advance': {
      const client = makeClient(env.SVC_WORKFLOW_ACCESS_TOKEN);
      await cmdAdvance(client, args.slice(1));
      break;
    }
    case 'legacy-import':
      await cmdLegacyImport(args.slice(1));
      break;
    case 'legacy-manifest-generate':
      await cmdLegacyManifestGenerate(args.slice(1));
      break;
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
// Existing commands (create, worklist, detail, advance)
// ---------------------------------------------------------------------------

async function cmdCreate(client: WorkflowClient, args: string[]) {
  const title = extractArg(args, '--title');
  const description = extractArg(args, '--description');
  const acceptanceCriteria = extractArg(args, '--acceptance-criteria');

  if (!title || !description || !acceptanceCriteria) {
    console.error('Usage: workflow-todo create --title <title> --description <desc> --acceptance-criteria <criteria>');
    process.exit(1);
  }

  const contextPayload = { title, description, acceptanceCriteria };
  const idempotencyKey = `create-${Date.now()}-${randomSuffix()}`;

  const result = await client.create(
    { domainId: env.DOMAIN_ID, definitionVersionId: env.DEFINITION_VERSION_ID, metadata: {}, contextPayload },
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

  const stateVersion = instance.workflow_state_version;
  const idempotencyKey = `advance-${Date.now()}-${randomSuffix()}`;

  const result = await client.transition(
    instanceId,
    {
      transitionDefinitionId: advanceTransition.transition_id,
      expectedWorkflowStateVersion: stateVersion,
      submissionPayload: { summary },
    },
    { idempotencyKey },
  );

  console.log(JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// legacy-manifest-generate command
// ---------------------------------------------------------------------------

const ALLOWED_MANIFEST_IDS = ['238', '256', '279'];

async function cmdLegacyManifestGenerate(args: string[]) {
  const sourcePath = extractArg(args, '--source');
  const idsArg = extractArg(args, '--ids');
  const outputPath = extractArg(args, '--output');

  if (!sourcePath || !idsArg || !outputPath) {
    console.error(
      'Usage: workflow-todo legacy-manifest-generate --source <remote-json-path> --ids <id1,id2,...> --output <manifest-path>',
    );
    process.exit(1);
  }

  // Parse and validate IDs
  const ids = idsArg.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    if (!ALLOWED_MANIFEST_IDS.includes(id)) {
      console.error(`ID ${id} is not in the allowed set: ${ALLOWED_MANIFEST_IDS.join(', ')}`);
      process.exit(1);
    }
  }

  // Read source file
  if (!existsSync(sourcePath)) {
    console.error(`Source file not found: ${sourcePath}`);
    process.exit(1);
  }
  const sourceBuffer = readFileSync(sourcePath);
  const sourceContent = sourceBuffer.toString('utf-8');

  let rawEnvelope: Record<string, unknown>;
  try {
    rawEnvelope = JSON.parse(sourceContent);
  } catch {
    console.error('Source file is not valid JSON');
    process.exit(1);
  }

  const todos = rawEnvelope.todos;
  if (!Array.isArray(todos)) {
    console.error('Source JSON has no "todos" array');
    process.exit(1);
  }

  // Compute source snapshot digest from raw file bytes
  const { createHash } = await import('crypto');
  const hash = createHash('sha256');
  hash.update(sourceBuffer);
  const sourceSnapshotSha256 = hash.digest('hex');

  // Build items
  const batchId = randomUUID();
  const importedAt = '2026-07-17T14:01:41Z'; // Fixed: generation time of original export

  const items: Array<Record<string, unknown>> = [];
  const seenIds = new Set<string>();

  for (const todo of todos) {
    const todoObj = todo as Record<string, unknown>;
    const id = String(todoObj.id);

    if (!ids.includes(id)) continue;

    if (seenIds.has(id)) {
      console.error(`Duplicate ID ${id} found in source data`);
      process.exit(1);
    }
    seenIds.add(id);

    // Validate criteria
    if (todoObj.status !== 'pending') {
      console.error(`ID ${id}: status must be 'pending', got '${todoObj.status}'`);
      process.exit(1);
    }
    if (todoObj.type !== 'personal') {
      console.error(`ID ${id}: type must be 'personal', got '${todoObj.type}'`);
      process.exit(1);
    }

    // Compute legacyRecordSha256 via JCS canonicalization of the full record
    const legacyRecordSha256 = sha256Jcs(todo);

    items.push({
      legacyTodoId: id,
      legacyRecordSha256,
      mappingDecision: 'REONBOARD_AS_PERSONAL_QUICK_ITEM',
      targetCreatorPrincipalRef: 'DOGFOOD_USER',
      idempotencyKey: `legacy-llm-todo:${id}`,
      context: {
        title: todoObj.title,
        description: todoObj.description ?? null,
        priority: todoObj.priority ?? null,
        legacyProvenance: {
          source: 'llm-todo',
          legacyTodoId: id,
          legacyRecordSha256,
          sourceSnapshotSha256,
          legacyStatus: todoObj.status ?? null,
          legacyCreatedAt: todoObj.created_at ?? null,
          legacyDueDate: todoObj.due_date ?? null,
          importBatchId: batchId,
          importedAt,
        },
      },
    });
  }

  // Verify all requested IDs were found
  for (const id of ids) {
    if (!seenIds.has(id)) {
      console.error(`ID ${id} not found in source data`);
      process.exit(1);
    }
  }

  const manifest = {
    schemaVersion: 'personal-quick-item-canary-v1',
    recordDigestAlgorithm: 'sha256-rfc8785-jcs-full-record-v1',
    sourceDigestAlgorithm: 'sha256-file-bytes-v1',
    batchId,
    sourceSnapshotSha256,
    targetDefinitionKey: 'personal_quick_item_v1',
    targetDefinitionVersion: 1,
    items,
  };

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(outputPath, manifestJson, 'utf-8');
  console.error(`Manifest written to ${outputPath}`);
  console.error(`  items: ${items.length}`);
  console.error(`  batch: ${batchId}`);
  console.error(`  source digest: ${sourceSnapshotSha256.slice(0, 12)}…`);

  // Output manifest to stdout as well
  process.stdout.write(manifestJson);
}

// ---------------------------------------------------------------------------
// legacy-import command
// ---------------------------------------------------------------------------

async function cmdLegacyImport(args: string[]) {
  const manifestPath = extractArg(args, '--manifest');
  const applyCanary = args.includes('--apply-canary');

  if (!manifestPath || !applyCanary) {
    console.error('Usage: workflow-todo legacy-import --manifest <path> --apply-canary');
    process.exit(1);
  }

  // ---- Validation phase ----

  // 1. Read manifest
  let manifestData: unknown;
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    manifestData = JSON.parse(content);
  } catch (error) {
    console.error(`Failed to read manifest: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // 2. Secret scan
  const secretWarnings = scanForSecrets(manifestPath);
  if (secretWarnings.length > 0) {
    for (const w of secretWarnings) {
      console.error(`SECURITY: ${w}`);
    }
    console.error('Aborting import due to potential secrets in manifest');
    process.exit(1);
  }

  // 3. Validate manifest structure
  let manifest;
  try {
    manifest = validateManifest(manifestData);
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      console.error(`Manifest validation failed: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  console.error(`Manifest validated: ${manifest.items.length} item(s)`);

  // 4. Resolve access token (must be explicit, no fallback)
  const accessToken = env.LEGACY_IMPORT_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('LEGACY_IMPORT_ACCESS_TOKEN is required (no fallback to SVC_WORKFLOW_ACCESS_TOKEN)');
    process.exit(1);
  }

  // 5. Validate JWT subject matches expected principal
  const expectedPrincipalId = env.LEGACY_IMPORT_EXPECTED_PRINCIPAL_ID;
  if (!expectedPrincipalId) {
    console.error('LEGACY_IMPORT_EXPECTED_PRINCIPAL_ID is required');
    process.exit(1);
  }
  try {
    validateTokenSubject(accessToken, expectedPrincipalId);
    console.error(`Token subject validated: ${expectedPrincipalId}`);
  } catch (error) {
    if (error instanceof TokenSubjectMismatchError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  // 6. Validate source snapshot digest from raw file bytes
  try {
    // Resolve source path relative to manifest directory
    const manifestDir = resolve(manifestPath, '..');
    const sourcePath = resolve(manifestDir, '..', 'private', 'remote-todos-raw.json');
    if (!existsSync(sourcePath)) {
      console.error(`Source file not found at ${sourcePath}`);
      process.exit(1);
    }
    validateSourceDigest(sourcePath, manifest.sourceSnapshotSha256);
    console.error('Source snapshot digest verified');
  } catch (error) {
    if (error instanceof SourceDigestMismatchError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  // 7. Validate definition version via svc-workflow read API
  const defVersionId = env.PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID;
  if (!defVersionId) {
    console.error('PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID is required');
    process.exit(1);
  }
  try {
    const defInfo = await validateDefinitionVersion(
      env.SVC_WORKFLOW_BASE_URL,
      accessToken,
      defVersionId,
    );
    console.error(
      `Definition validated: ${defInfo.definitionKey} v${defInfo.versionNumber} (${defInfo.versionStatus})`,
    );
  } catch (error) {
    if (error instanceof DefinitionValidationError) {
      console.error(`Definition validation failed: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  // ---- Import phase ----

  console.error('Starting import...');
  const results = await importManifest(manifest, {
    domainId: env.DOMAIN_ID,
    definitionVersionId: defVersionId,
    accessToken,
    baseUrl: env.SVC_WORKFLOW_BASE_URL,
  });

  // Report
  const succeeded = results.filter((r) => r.status === 'succeeded');
  const errors = results.filter((r) => r.status === 'error');

  console.error(`Import complete: ${succeeded.length} succeeded, ${errors.length} errors`);

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`  Item ${err.legacyTodoId}: ${err.error}`);
    }
  }

  process.stdout.write(JSON.stringify(results, null, 2) + '\n');

  if (errors.length > 0) {
    process.exit(1);
  }
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
  workflow-todo legacy-import --manifest <path> --apply-canary
  workflow-todo legacy-manifest-generate --source <remote-json> --ids <id1,id2,...> --output <path>
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
