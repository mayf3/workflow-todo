#!/usr/bin/env node

/**
 * scripts/migrate-legacy-todos-once.ts
 *
 * One-time migration of 82 legacy LLM Todo items to workflow-todo.
 *
 * Usage:
 *   npx tsx scripts/migrate-legacy-todos-once.ts        # dry-run (default)
 *   npx tsx scripts/migrate-legacy-todos-once.ts --exec  # execute migration
 *
 * Environment (from .env + .env.full-migration.local):
 *   SVC_WORKFLOW_BASE_URL
 *   DOMAIN_ID
 *   PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID
 *   LEGACY_MIGRATION_DOGFOOD_USER_TOKEN
 *   LEGACY_MIGRATION_EFFICIENCY_MANAGER_TOKEN
 *
 * Input: migration/legacy-llm-todo-v1/generated/two-workflow-migration-plan-v1.json
 *
 * Idempotency key: legacy-llm-todo:<legacyTodoId>
 *   - Re-running is safe; duplicates are rejected by the API.
 *
 * No modification to src/, definitions/, or any framework file.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

// Load .env first (config.ts also loads this, but we load it here for the
// migration-specific vars that config.ts doesn't export).
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
for (const f of ['.env', '.env.full-migration.local']) {
  const p = resolve(ROOT, f);
  if (existsSync(p)) dotenvConfig({ path: p, override: false });
}

// --- Inline types (legacy WorkflowClient has been removed) ---
interface CreateInput {
  domainId: string;
  definitionVersionId: string;
  metadata: Record<string, unknown>;
  contextPayload: Record<string, unknown>;
}

// =========================================================================
// Config
// =========================================================================

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const CONFIG = {
  baseUrl: req('SVC_WORKFLOW_BASE_URL'),
  domainId: req('DOMAIN_ID'),
  defVersionId: req('PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID'),
  dogfoodToken: req('LEGACY_MIGRATION_DOGFOOD_USER_TOKEN'),
  emToken: req('LEGACY_MIGRATION_EFFICIENCY_MANAGER_TOKEN'),
  planPath: resolve(ROOT, 'migration/legacy-llm-todo-v1/generated/two-workflow-migration-plan-v1.json'),
  resultPath: resolve(ROOT, 'migration/legacy-llm-todo-v1/generated/simple-migration-results.json'),
};

// =========================================================================
// Constants
// =========================================================================

const CANARY_IDS = new Set(['238', '256', '279']);
const EM_IDS = new Set(['17', '45', '47', '55', '127', '185', '186', '187', '192', '239', '242', '263']);

// =========================================================================
// Types
// =========================================================================

interface PlanItem {
  legacyTodoId: string;
  legacyTitle: string;
  legacyStatus: string;
  legacyAssignee: string | null;
  legacyRecordSha256: string;
  destination: 'SIMPLE_TODO' | 'LEDGER_ONLY';
  targetDefinition: string | null;
  targetPrincipalRef: 'DOGFOOD_USER' | 'EFFICIENCY_MANAGER' | null;
  targetNode: string | null;
  mappingReason: string;
  migrationNeedsTriage?: boolean;
}

interface MigrationResult {
  legacyTodoId: string;
  workflowInstanceId: string | null;
  principal: string;
  action: 'created' | 'reused' | 'ledger-only' | 'failed';
  error: string | null;
  /** For ledger-only items: why it was not migrated */
  reason?: string;
  /** For ledger-only items: original status in legacy system */
  originalStatus?: string;
}

interface MigrationOutput {
  executedAt: string;
  counts: {
    total: number;
    created: number;
    reused: number;
    ledgerOnly: number;
    failed: number;
  };
  items: MigrationResult[];
}

// =========================================================================
// Helpers
// =========================================================================

function classify(plan: { items: PlanItem[] }) {
  const ledgerOnly: PlanItem[] = [];
  const dogfoodNew: PlanItem[] = [];
  const emNew: PlanItem[] = [];

  for (const item of plan.items) {
    if (item.destination === 'LEDGER_ONLY') {
      ledgerOnly.push(item);
    } else if (EM_IDS.has(item.legacyTodoId)) {
      emNew.push(item);
    } else {
      dogfoodNew.push(item);
    }
  }

  return { ledgerOnly, dogfoodNew, emNew };
}

/**
 * Minimal fetch-based create for migration (WorkflowClient has been removed).
 * Kept as a historical artifact — the migration has already been executed.
 */
async function createViaFetch(
  input: CreateInput,
  idempotencyKey: string,
  token: string,
): Promise<{ workflowInstanceId: string; workflowStateVersion: number }> {
  const response = await fetch(`${CONFIG.baseUrl}/internal/v1/workflow-instances`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json() as Promise<{ workflowInstanceId: string; workflowStateVersion: number }>;
}

function makeCreateInput(item: PlanItem): CreateInput {
  return {
    domainId: CONFIG.domainId,
    definitionVersionId: CONFIG.defVersionId,
    metadata: {
      legacyImport: true,
      legacySource: 'llm-todo',
      legacyTodoId: item.legacyTodoId,
      legacyStatus: item.legacyStatus,
      legacyAssignee: item.legacyAssignee,
      migrationNeedsTriage: item.migrationNeedsTriage ?? false,
      migrationReason: item.mappingReason,
    },
    contextPayload: {
      title: item.legacyTitle,
    },
  };
}

function loadExistingResults(): Map<string, MigrationResult> {
  if (!existsSync(CONFIG.resultPath)) return new Map();
  const raw = JSON.parse(readFileSync(CONFIG.resultPath, 'utf-8')) as MigrationOutput;
  const map = new Map<string, MigrationResult>();
  for (const r of raw.items) {
    map.set(r.legacyTodoId, r);
  }
  return map;
}

function saveResult(items: MigrationResult[]): void {
  const output: MigrationOutput = {
    executedAt: new Date().toISOString(),
    counts: {
      total: items.length,
      created: items.filter((r) => r.action === 'created').length,
      reused: items.filter((r) => r.action === 'reused').length,
      ledgerOnly: items.filter((r) => r.action === 'ledger-only').length,
      failed: items.filter((r) => r.action === 'failed').length,
    },
    items,
  };
  writeFileSync(CONFIG.resultPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nResults saved to ${CONFIG.resultPath}`);
}

// =========================================================================
// Main
// =========================================================================

async function main() {
  const isExec = process.argv.includes('--exec');

  // ── 1. Load plan ──────────────────────────────────────────────────────────
  const plan: { items: PlanItem[]; importBatchId: string } = JSON.parse(
    readFileSync(CONFIG.planPath, 'utf-8'),
  );

  if (plan.items.length !== 82) {
    console.error(`FATAL: Expected 82 items in plan, got ${plan.items.length}`);
    process.exit(1);
  }

  const allIds = plan.items.map((i) => i.legacyTodoId);
  if (new Set(allIds).size !== allIds.length) {
    console.error('FATAL: Duplicate legacyTodoId in plan');
    process.exit(1);
  }

  // ── 2. Classify ───────────────────────────────────────────────────────────
  const { ledgerOnly, dogfoodNew, emNew } = classify(plan);

  console.log('=== Legacy Todo Migration =================================');
  console.log(`  Plan path: ${CONFIG.planPath}`);
  console.log(`  Mode:      ${isExec ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log('');
  console.log('--- Classification ---');
  console.log(`  DOGFOOD_USER new        = ${dogfoodNew.length}`);
  console.log(`  EFFICIENCY_MANAGER new   = ${emNew.length}`);
  console.log(`  ledger-only              = ${ledgerOnly.length}`);
  console.log(`  total                    = ${plan.items.length}`);
  console.log('');

  // ── 3. Validate EM IDs in plan ──────────────────────────────────────────
  for (const id of EM_IDS) {
    const item = plan.items.find((i) => i.legacyTodoId === id);
    if (!item) {
      console.error(`FATAL: EM ID ${id} not found in plan`);
      process.exit(1);
    }
    if (item.targetPrincipalRef !== 'EFFICIENCY_MANAGER') {
      console.error(`FATAL: Item ${id} has principal ${item.targetPrincipalRef}, expected EFFICIENCY_MANAGER`);
      process.exit(1);
    }
  }

  // ── 4. Dry-run only? ──────────────────────────────────────────────────────
  if (!isExec) {
    console.log('DRY-RUN complete. Pass --exec to execute.');
    process.exit(0);
  }

  // ── 5. Execute ────────────────────────────────────────────────────────────
  console.log('--- Execution ---\n');

  // Load previously saved results for resumability
  const existing = loadExistingResults();

  const results: MigrationResult[] = [];

  // Helper to process a batch of items
  async function processItems(
    items: PlanItem[],
    token: string,
    principal: string,
  ) {
    for (const item of items) {
      // Skip if already processed
      const prev = existing.get(item.legacyTodoId);
      if (prev) {
        results.push(prev);
        const tag = prev.action === 'created' ? 'CREATE' : prev.action.toUpperCase();
        console.log(`  [SKIP] ${tag}  ${item.legacyTodoId}  ${prev.workflowInstanceId ?? '-'}`);
        continue;
      }

      const idKey = `legacy-llm-todo:${item.legacyTodoId}`;
      try {
        const result = await createViaFetch(
          makeCreateInput(item),
          idKey,
          token,
        );

        results.push({
          legacyTodoId: item.legacyTodoId,
          workflowInstanceId: result.workflowInstanceId,
          principal,
          action: 'created',
          error: null,
        });
        console.log(`  [CREATE] ${item.legacyTodoId}  ${result.workflowInstanceId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          legacyTodoId: item.legacyTodoId,
          workflowInstanceId: null,
          principal,
          action: 'failed',
          error: msg,
        });
        console.error(`  [FAIL]  ${item.legacyTodoId}  ${msg}`);
      }

      // Save incrementally so we can resume after interruption
      saveResult(results);
    }
  }

  // Process LEDGER_ONLY items (no API calls)
  for (const item of ledgerOnly) {
    const prev = existing.get(item.legacyTodoId);
    if (prev) {
      results.push(prev);
      console.log(`  [SKIP] LEDGER  ${item.legacyTodoId}`);
      continue;
    }
    results.push({
      legacyTodoId: item.legacyTodoId,
      workflowInstanceId: null,
      principal: 'LEDGER_ONLY',
      action: 'ledger-only',
      error: null,
      reason: item.mappingReason,
      originalStatus: item.legacyStatus,
    });
    console.log(`  [LEDGER] ${item.legacyTodoId}  reason=${item.mappingReason}`);
  }
  saveResult(results);

  // Process DOGFOOD_USER items
  if (dogfoodNew.length > 0) {
    console.log('\n--- DOGFOOD_USER new ---');
    await processItems(dogfoodNew, CONFIG.dogfoodToken, 'DOGFOOD_USER');
    saveResult(results);
  }

  // Process EFFICIENCY_MANAGER items
  if (emNew.length > 0) {
    console.log('\n--- EFFICIENCY_MANAGER new ---');
    await processItems(emNew, CONFIG.emToken, 'EFFICIENCY_MANAGER');
    saveResult(results);
  }

  // ── 6. Final summary ──────────────────────────────────────────────────────
  const created = results.filter((r) => r.action === 'created').length;
  const reused = results.filter((r) => r.action === 'reused').length;
  const lc = results.filter((r) => r.action === 'ledger-only').length;
  const failed = results.filter((r) => r.action === 'failed').length;

  console.log('\n' + '='.repeat(50));
  console.log('  Final Summary');
  console.log('='.repeat(50));
  console.log(`  created       = ${created}`);
  console.log(`  reused        = ${reused}`);
  console.log(`  ledger-only   = ${lc}`);
  console.log(`  failed        = ${failed}`);
  console.log(`  total         = ${results.length}`);
  console.log('');

  if (failed > 0) {
    console.error('  FAILURES:');
    for (const r of results.filter((r) => r.action === 'failed')) {
      console.error(`    ${r.legacyTodoId}: ${r.error}`);
    }
    console.log(`\n  Final status: LEGACY_TODO_SIMPLE_MIGRATION_PARTIAL`);
    process.exit(1);
  }

  console.log(`  Final status: LEGACY_TODO_SIMPLE_MIGRATION_PASS\n`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
