/**
 * full-migration CLI command handlers.
 *
 * Subcommands:
 *   generate-plan   — generate migration plan from source + plan config (already done)
 *   run             — execute migration against svc-workflow
 *   verify          — check plan and results integrity
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { env } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { WorkflowClient } from './client.js';
import { sha256FileBytes } from './digest.js';
import {
  validatePlan,
  resolveToken,
  verifyCanary,
  importItem,
  checkSourceDrift,
  generateInitialResults,
  CANARY_IDS,
} from './full-migration.js';
import type {
  MigrationPlan,
  MigrationResults,
  PlanItem,
  DriftCheckResult,
} from './full-migration.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve(__dirname, '..');
const PLAN_PATH = resolve(
  PROJECT_ROOT,
  'migration', 'legacy-llm-todo-v1', 'generated', 'two-workflow-migration-plan-v1.json',
);
const RESULTS_PATH = resolve(
  PROJECT_ROOT,
  'migration', 'legacy-llm-todo-v1', 'generated', 'two-workflow-migration-results-v1.json',
);
const SOURCE_PATH = resolve(
  PROJECT_ROOT,
  'migration', 'legacy-llm-todo-v1', 'private', 'remote-todos-drift-check.json',
);
const DEFINITION_VERSION_ID = env.PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID || '95aacea2-5599-4e74-b576-e2eeb61e27a0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPlan(): MigrationPlan {
  if (!existsSync(PLAN_PATH)) {
    console.error('Plan file not found. Run generate-plan first.');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(PLAN_PATH, 'utf-8'));
  return validatePlan(raw);
}

function loadResults(): MigrationResults | null {
  if (!existsSync(RESULTS_PATH)) return null;
  return JSON.parse(readFileSync(RESULTS_PATH, 'utf-8')) as MigrationResults;
}

function saveResults(results: MigrationResults): void {
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n', 'utf-8');
  console.error(`Results written to ${RESULTS_PATH}`);
}

function makeClient(token: string): WorkflowClient {
  return new WorkflowClient({
    baseUrl: env.SVC_WORKFLOW_BASE_URL,
    accessTokenProvider: () => token,
    requestTimeoutMs: parseInt(env.REQUEST_TIMEOUT_MS, 10),
    maxAttempts: parseInt(env.MAX_ATTEMPTS, 10),
  });
}

function groupByPrincipal(items: PlanItem[]): Map<string, PlanItem[]> {
  const groups = new Map<string, PlanItem[]>();
  for (const item of items) {
    if (item.destination === 'LEDGER_ONLY') continue;
    const ref = item.targetPrincipalRef || 'DOGFOOD_USER';
    if (!groups.has(ref)) groups.set(ref, []);
    groups.get(ref)!.push(item);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// generate-plan (already done — just verifies existing)
// ---------------------------------------------------------------------------

export async function cmdGeneratePlan(): Promise<void> {
  if (!existsSync(PLAN_PATH)) {
    console.error('Plan file not found. Please generate it first (already committed).');
    process.exit(1);
  }
  const plan = readPlan();
  console.error(`Plan validated: ${plan.items.length} items`);
  console.error(`  SIMPLE_TODO→DOGFOOD_USER: ${plan.items.filter(i => i.destination === 'SIMPLE_TODO' && i.targetPrincipalRef === 'DOGFOOD_USER').length}`);
  console.error(`  SIMPLE_TODO→EFFICIENCY_MANAGER: ${plan.items.filter(i => i.destination === 'SIMPLE_TODO' && i.targetPrincipalRef === 'EFFICIENCY_MANAGER').length}`);
  console.error(`  LEDGER_ONLY: ${plan.items.filter(i => i.destination === 'LEDGER_ONLY').length}`);
  console.error(`  Total: ${plan.items.length}`);
  console.error('Plan validated OK');
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

export async function cmdRun(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');

  // 1. Read and validate plan
  console.error('=== Step 1: Validate plan ===');
  const plan = readPlan();
  console.error(`Plan validated: ${plan.items.length} items`);

  // 2. Source drift pre-check
  console.error('\n=== Step 2: Source drift pre-check ===');
  const preCheck = checkSourceDrift(
    SOURCE_PATH, plan.sourceSnapshotSha256, plan.recordSetDigest,
  );
  console.error(`  Passed: ${preCheck.passed}`);
  if (!preCheck.passed) {
    console.error(`  Drift detected: ${preCheck.message}`);
    const results = generateInitialResults(plan);
    results.preCheckStatus = preCheck;
    saveResults(results);
    console.error('FATAL: Source drift detected. Zero writes.');
    process.exit(1);
  }

  // 3. Resolve tokens per principal
  console.error('\n=== Step 3: Resolve tokens ===');
  const groups = groupByPrincipal(plan.items);
  const clients = new Map<string, WorkflowClient>();
  for (const [ref] of groups) {
    try {
      const { token } = resolveToken(ref);
      clients.set(ref, makeClient(token));
      console.error(`  ${ref}: token resolved ✅`);
    } catch (error) {
      console.error(`  ${ref}: token MISSING ❌ — ${error instanceof Error ? error.message : error}`);
      if (!dryRun) process.exit(1);
    }
  }

  // 4. Dry run — just report
  if (dryRun) {
    console.error('\n=== DRY RUN ===');
    for (const [ref, items] of groups) {
      console.error(`  ${ref}: ${items.length} items`);
      const canaries = items.filter(i => CANARY_IDS.has(i.legacyTodoId));
      if (canaries.length > 0) {
        console.error(`    Canary reuse: ${canaries.map(i => i.legacyTodoId).join(', ')}`);
      }
      const newItems = items.filter(i => !CANARY_IDS.has(i.legacyTodoId));
      console.error(`    New instances: ${newItems.length}`);
    }
    console.error(`  LEDGER_ONLY: ${plan.items.filter(i => i.destination === 'LEDGER_ONLY').length}`);
    console.error('Dry run complete. No instances created.');
    return;
  }

  // 5. Initialize results
  const results = generateInitialResults(plan);
  results.preCheckStatus = preCheck;

  // 6. Process each principal group
  console.error('\n=== Step 4: Execute migration ===');
  const sourceRaw = existsSync(SOURCE_PATH) ? JSON.parse(readFileSync(SOURCE_PATH, 'utf-8')) : null;
  const sourceTodos: Record<string, unknown>[] = sourceRaw?.todos || [];
  const sourceMap = new Map<string, Record<string, unknown>>();
  for (const t of sourceTodos) {
    sourceMap.set(String(t.id), t);
  }

  for (const [ref, items] of groups) {
    const client = clients.get(ref)!;
    console.error(`\n  Processing ${ref} (${items.length} items)...`);

    for (const item of items) {
      const id = item.legacyTodoId;
      const sourceRecord = sourceMap.get(id) || null;
      const resultIndex = results.items.findIndex(r => r.legacyTodoId === id);

      // Canary reuse
      if (CANARY_IDS.has(id)) {
        const canaryStatus = await verifyCanary(client, item, ref, DEFINITION_VERSION_ID);
        if (canaryStatus.canReuse) {
          console.error(`    ${id}: REUSED ✅ (instance: ${canaryStatus.workflowInstanceId})`);
          if (resultIndex >= 0) {
            results.items[resultIndex].result = 'REUSED_EXISTING';
            results.items[resultIndex].workflowInstanceId = canaryStatus.workflowInstanceId;
            results.items[resultIndex].canaryReused = true;
            results.counts.reusedExisting++;
          }
          continue;
        }
        console.error(`    ${id}: canary verification FAILED ❌ — ${canaryStatus.reason}`);
        if (resultIndex >= 0) {
          results.items[resultIndex].result = 'FAILED';
          results.items[resultIndex].error = canaryStatus.reason;
          results.counts.failed++;
        }
        continue;
      }

      // New import
      const r = await importItem(client, item, plan, sourceRecord, DEFINITION_VERSION_ID, env.DOMAIN_ID);
      if (r.result === 'IMPORTED_OPEN') {
        console.error(`    ${id}: IMPORTED ✅ (instance: ${r.workflowInstanceId})`);
        results.counts.importedOpen++;
      } else {
        console.error(`    ${id}: FAILED ❌ — ${r.error}`);
        results.counts.failed++;
      }
      if (resultIndex >= 0) {
        results.items[resultIndex] = r;
      }

      // Update results after each item
      saveResults(results);
    }
  }

  // 7. LEDGER_ONLY items
  console.error('\n=== Step 5: LEDGER_ONLY items ===');
  for (const item of plan.items) {
    if (item.destination !== 'LEDGER_ONLY') continue;
    const id = item.legacyTodoId;
    const resultIndex = results.items.findIndex(r => r.legacyTodoId === id);
    if (resultIndex >= 0) {
      results.items[resultIndex].result = 'DISCARDED';
      results.counts.discarded++;
    }
    console.error(`    ${id}: DISCARDED ✅ — ${item.mappingReason}`);
  }
  saveResults(results);

  // 8. Summary
  console.error('\n=== Migration Summary ===');
  console.error(`  Total items:     ${results.counts.total}`);
  console.error(`  Imported open:   ${results.counts.importedOpen}`);
  console.error(`  Reused canary:   ${results.counts.reusedExisting}`);
  console.error(`  Discarded:       ${results.counts.discarded}`);
  console.error(`  Failed:          ${results.counts.failed}`);
  console.error(`  Expected total:  ${results.counts.importedOpen + results.counts.reusedExisting + results.counts.discarded + results.counts.failed}`);
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

export async function cmdVerify(): Promise<void> {
  // 1. Verify plan
  console.error('=== Plan Verification ===');
  const plan = readPlan();
  console.error(`  Plan: ${PLAN_PATH}`);
  console.error(`  Items: ${plan.items.length}`);
  console.error(`  Source SHA: ${plan.sourceSnapshotSha256.slice(0, 12)}...`);

  // 2. Verify results if they exist
  const results = loadResults();
  if (!results) {
    console.error('  Results: NOT FOUND (migration not yet run)');
    return;
  }
  console.error(`\n=== Results Verification ===`);
  console.error(`  Results: ${RESULTS_PATH}`);
  console.error(`  Plan SHA: ${results.planSnapshotSha256.slice(0, 12)}...`);

  // Check counts
  const counts = results.counts;
  const totalCompleted = counts.importedOpen + counts.reusedExisting + counts.discarded + counts.failed;
  console.error(`\n  Total items:      ${counts.total}`);
  console.error(`  Imported open:    ${counts.importedOpen}`);
  console.error(`  Reused existing:  ${counts.reusedExisting}`);
  console.error(`  Discarded:        ${counts.discarded}`);
  console.error(`  Failed:           ${counts.failed}`);
  console.error(`  Completed:        ${totalCompleted}`);

  if (totalCompleted !== counts.total) {
    console.error(`  ❌ INCOMPLETE: ${counts.total - totalCompleted} items still PENDING`);
  } else if (counts.failed > 0) {
    console.error(`  ⚠️ Complete but ${counts.failed} failures`);
  } else {
    console.error(`  ✅ All ${counts.total} items complete, 0 failures`);
  }

  // Check for pending items
  const pending = results.items.filter(i => i.result === 'PENDING');
  if (pending.length > 0) {
    console.error(`\n  PENDING items (${pending.length}):`);
    for (const p of pending) {
      console.error(`    ${p.legacyTodoId}: ${p.destination}`);
    }
  }

  // Check for errors
  const errors = results.items.filter(i => i.result === 'FAILED');
  if (errors.length > 0) {
    console.error(`\n  FAILED items (${errors.length}):`);
    for (const e of errors) {
      console.error(`    ${e.legacyTodoId}: ${e.error}`);
    }
  }
}
