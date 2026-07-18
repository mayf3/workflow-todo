/**
 * full-migration: two-workflow migration from legacy llm-todo to svc-workflow.
 *
 * Reads an immutable plan file (two-workflow-migration-plan-v1.json) and
 * executes migration for each item, writing results to a separate file.
 *
 * Three destinations:
 *   SIMPLE_TODO  → personal_quick_item_v1 / open
 *   AGENT_SELF_TASK → agent_self_task_v1 / propose
 *   LEDGER_ONLY  → no instance created
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { env } from './config.js';
import { WorkflowClient, WorkflowError } from './client.js';
import { sha256FileBytes, jcsCanonicalize } from './digest.js';
import { scanForSecrets } from './legacy-import.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Destination = 'SIMPLE_TODO' | 'AGENT_SELF_TASK' | 'LEDGER_ONLY';
export type ResultStatus =
  | 'PENDING'
  | 'IMPORTED_OPEN'
  | 'REUSED_EXISTING'
  | 'DISCARDED'
  | 'FAILED';

export interface PlanItem {
  legacyTodoId: string;
  legacyTitle: string;
  legacyStatus: string;
  legacyAssignee: string | null;
  legacyRecordSha256: string;
  destination: Destination;
  targetDefinition: string | null;
  targetPrincipalRef: string | null;
  targetNode: string | null;
  mappingReason: string;
  migrationNeedsTriage?: boolean;
}

export interface MigrationPlan {
  schemaVersion: string;
  sourceSnapshotSha256: string;
  recordSetDigest: string;
  recordDigestAlgorithm: string;
  sourceDigestAlgorithm: string;
  importBatchId: string;
  generatedAt: string;
  items: PlanItem[];
}

export interface ResultItem {
  legacyTodoId: string;
  legacyRecordSha256: string;
  destination: Destination;
  result: ResultStatus;
  workflowInstanceId: string | null;
  canaryReused: boolean;
  error: string | null;
}

export interface MigrationResults {
  schemaVersion: string;
  planSnapshotSha256: string;
  sourceSnapshotSha256: string;
  executedAt: string;
  preCheckStatus: DriftCheckResult;
  postCheckStatus: DriftCheckResult | null;
  counts: {
    total: number;
    simpleTodo: number;
    agentSelfTask: number;
    ledgerOnly: number;
    importedOpen: number;
    reusedExisting: number;
    discarded: number;
    failed: number;
  };
  items: ResultItem[];
}

export interface DriftCheckResult {
  checked: boolean;
  passed: boolean;
  recordCount: number;
  uniqueIds: number;
  idSetChanged: boolean;
  recordDigestsChanged: number;
  recordSetDigestMatch: boolean;
  transportChanged: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAN_SCHEMA_VERSION = 'two-workflow-migration-plan-v1';
const RESULTS_SCHEMA_VERSION = 'two-workflow-migration-results-v1';
const DEFINITION_KEY = 'personal_quick_item_v1';
const DEFINITION_VERSION = 1;
export const CANARY_IDS = new Set(['238', '256', '279']);

// Principal ID mapping
const PRINCIPAL_MAP: Record<string, string> = {
  DOGFOOD_USER: '10000000-0000-0000-0000-000000000101',
  EFFICIENCY_MANAGER: '10000000-0000-0000-0000-000000000020',
};

// Token env var mapping
const TOKEN_ENV_MAP: Record<string, string> = {
  DOGFOOD_USER: 'LEGACY_MIGRATION_DOGFOOD_USER_TOKEN',
  EFFICIENCY_MANAGER: 'LEGACY_MIGRATION_EFFICIENCY_MANAGER_TOKEN',
};

// ---------------------------------------------------------------------------
// Plan validation
// ---------------------------------------------------------------------------

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanValidationError';
  }
}

export function validatePlan(data: unknown): MigrationPlan {
  if (typeof data !== 'object' || data === null) {
    throw new PlanValidationError('Plan must be a JSON object');
  }
  const plan = data as Record<string, unknown>;

  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new PlanValidationError(
      `schemaVersion must be "${PLAN_SCHEMA_VERSION}", got "${String(plan.schemaVersion)}"`,
    );
  }

  const items = plan.items;
  if (!Array.isArray(items)) throw new PlanValidationError('items must be an array');
  if (items.length !== 82) {
    throw new PlanValidationError(`items must have exactly 82 entries, got ${items.length}`);
  }

  const seen = new Set<string>();
  let dogfoodUser = 0;
  let effManager = 0;
  let ledgerOnly = 0;
  let agentSelfTask = 0;

  for (const item of items) {
    const i = item as Record<string, unknown>;
    if (typeof i.legacyTodoId !== 'string' || i.legacyTodoId.length === 0) {
      throw new PlanValidationError('legacyTodoId must be a non-empty string');
    }
    if (seen.has(i.legacyTodoId)) {
      throw new PlanValidationError(`Duplicate legacyTodoId: ${i.legacyTodoId}`);
    }
    seen.add(i.legacyTodoId);
    if (typeof i.legacyRecordSha256 !== 'string' || i.legacyRecordSha256.length !== 64) {
      throw new PlanValidationError(`Invalid legacyRecordSha256 for ${i.legacyTodoId}`);
    }
    const dest = i.destination as string;
    if (!['SIMPLE_TODO', 'AGENT_SELF_TASK', 'LEDGER_ONLY'].includes(dest)) {
      throw new PlanValidationError(`Invalid destination for ${i.legacyTodoId}: ${dest}`);
    }
    if (dest === 'SIMPLE_TODO') {
      if (i.targetPrincipalRef === 'DOGFOOD_USER') dogfoodUser++;
      else if (i.targetPrincipalRef === 'EFFICIENCY_MANAGER') effManager++;
    }
    if (dest === 'AGENT_SELF_TASK') agentSelfTask++;
    if (dest === 'LEDGER_ONLY') ledgerOnly++;
  }

  // Verify key counts
  if (dogfoodUser !== 53) {
    throw new PlanValidationError(`SIMPLE_TODO→DOGFOOD_USER must be 53, got ${dogfoodUser}`);
  }
  if (effManager !== 12) {
    throw new PlanValidationError(`SIMPLE_TODO→EFFICIENCY_MANAGER must be 12, got ${effManager}`);
  }
  if (ledgerOnly !== 17) {
    throw new PlanValidationError(`LEDGER_ONLY must be 17, got ${ledgerOnly}`);
  }
  if (agentSelfTask !== 0) {
    // AGENT_SELF_TASK=0 is expected, but warn if non-zero
    console.error(`Note: AGENT_SELF_TASK = ${agentSelfTask} (expected 0)`);
  }

  // Check canary entries
  for (const cid of CANARY_IDS) {
    if (!seen.has(cid)) {
      throw new PlanValidationError(`Canary ID ${cid} missing from plan`);
    }
  }

  // Check ID 84 is LEDGER_ONLY
  const id84 = items.find((i: unknown) => (i as Record<string, unknown>).legacyTodoId === '84');
  if (!id84 || (id84 as Record<string, unknown>).destination !== 'LEDGER_ONLY') {
    throw new PlanValidationError('ID 84 must be LEDGER_ONLY');
  }

  return plan as unknown as MigrationPlan;
}

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

export function resolveToken(principalRef: string): { token: string; principalId: string } {
  const envVar = TOKEN_ENV_MAP[principalRef];
  if (!envVar) throw new Error(`Unknown principal ref: ${principalRef}`);
  const token = process.env[envVar] || '';
  if (!token) throw new Error(`Token not available for ${principalRef} (env: ${envVar})`);
  const principalId = PRINCIPAL_MAP[principalRef];
  return { token, principalId };
}

// ---------------------------------------------------------------------------
// Source drift check
// ---------------------------------------------------------------------------

export function computeRecordDigest(record: Record<string, unknown>): string {
  const hash = createHash('sha256');
  const canon = jcsCanonicalize(record);
  hash.update(canon, 'utf-8');
  return hash.digest('hex');
}

export function computeRecordSetDigest(todos: Record<string, unknown>[]): string {
  const sorted = [...todos].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const hash = createHash('sha256');
  hash.update(jcsCanonicalize(sorted), 'utf-8');
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Canary verification
// ---------------------------------------------------------------------------

export interface CanaryStatus {
  legacyTodoId: string;
  canReuse: boolean;
  workflowInstanceId: string | null;
  reason: string | null;
}

export async function verifyCanary(
  client: WorkflowClient,
  planItem: PlanItem,
  clientPrincipal: string,
  definitionVersionId: string,
): Promise<CanaryStatus> {
  try {
    const worklist = await client.worklistAssignedToMe();
    // Look through worklist for canary instances
    for (const wlItem of worklist.items) {
      const meta = wlItem.detail.instance.metadata as Record<string, unknown> | null;
      if (meta && meta.legacyTodoId === planItem.legacyTodoId) {
        // Verify provenance
        const instance = wlItem.detail.instance;
        const defVerId = instance.definitionVersionId;
        if (defVerId !== definitionVersionId) {
          return {
            legacyTodoId: planItem.legacyTodoId,
            canReuse: false,
            workflowInstanceId: instance.workflowInstanceId,
            reason: `Definition version mismatch: ${defVerId} !== ${definitionVersionId}`,
          };
        }
        return {
          legacyTodoId: planItem.legacyTodoId,
          canReuse: true,
          workflowInstanceId: instance.workflowInstanceId,
          reason: null,
        };
      }
    }
    return {
      legacyTodoId: planItem.legacyTodoId,
      canReuse: false,
      workflowInstanceId: null,
      reason: 'Instance not found in worklist',
    };
  } catch (error) {
    return {
      legacyTodoId: planItem.legacyTodoId,
      canReuse: false,
      workflowInstanceId: null,
      reason: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Batch import
// ---------------------------------------------------------------------------

export function makeMetadata(
  planItem: PlanItem,
  sourceRecord: Record<string, unknown> | null,
  plan: MigrationPlan,
): Record<string, unknown> {
  return {
    legacyImport: true,
    legacySource: 'llm-todo',
    legacyTodoId: planItem.legacyTodoId,
    legacyRecordSha256: planItem.legacyRecordSha256,
    sourceSnapshotSha256: plan.sourceSnapshotSha256,
    legacyStatus: planItem.legacyStatus,
    legacySubStatus: sourceRecord?.sub_status ?? null,
    legacyAssignee: planItem.legacyAssignee,
    legacyCreatedAt: sourceRecord?.created_at ?? null,
    legacyDueDate: sourceRecord?.due_date ?? null,
    migrationDestination: planItem.destination,
    migrationNeedsTriage: planItem.migrationNeedsTriage ?? false,
    migrationReason: planItem.mappingReason,
    importBatchId: plan.importBatchId,
    historicalImport: false,
  };
}

export async function importItem(
  client: WorkflowClient,
  planItem: PlanItem,
  plan: MigrationPlan,
  sourceRecord: Record<string, unknown> | null,
  definitionVersionId: string,
  domainId: string,
): Promise<ResultItem> {
  const metadata = makeMetadata(planItem, sourceRecord, plan);

  const contextPayload: Record<string, unknown> = {
    title: planItem.legacyTitle,
    description: sourceRecord?.description ?? null,
    priority: sourceRecord?.priority ?? null,
    legacyProvenance: {
      source: 'llm-todo',
      legacyTodoId: planItem.legacyTodoId,
      legacyRecordSha256: planItem.legacyRecordSha256,
      sourceSnapshotSha256: plan.sourceSnapshotSha256,
      legacyStatus: planItem.legacyStatus,
      legacyCreatedAt: sourceRecord?.created_at ?? null,
      legacyDueDate: sourceRecord?.due_date ?? null,
      importBatchId: plan.importBatchId,
      importedAt: new Date().toISOString(),
    },
  };

  try {
    const result = await client.create(
      {
        domainId,
        definitionVersionId,
        metadata: metadata as import('./contracts.js').JsonValue,
        contextPayload: contextPayload as import('./contracts.js').JsonValue,
      },
      { idempotencyKey: `legacy-llm-todo:${planItem.legacyTodoId}` },
    );

    return {
      legacyTodoId: planItem.legacyTodoId,
      legacyRecordSha256: planItem.legacyRecordSha256,
      destination: planItem.destination,
      result: 'IMPORTED_OPEN',
      workflowInstanceId: result.workflowInstanceId,
      canaryReused: false,
      error: null,
    };
  } catch (error) {
    if (error instanceof WorkflowError) {
      return {
        legacyTodoId: planItem.legacyTodoId,
        legacyRecordSha256: planItem.legacyRecordSha256,
        destination: planItem.destination,
        result: 'FAILED',
        workflowInstanceId: null,
        canaryReused: false,
        error: `[${error.code ?? 'unknown'}] ${error.message}`,
      };
    }
    return {
      legacyTodoId: planItem.legacyTodoId,
      legacyRecordSha256: planItem.legacyRecordSha256,
      destination: planItem.destination,
      result: 'FAILED',
      workflowInstanceId: null,
      canaryReused: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Source drift check
// ---------------------------------------------------------------------------

export function checkSourceDrift(
  sourcePath: string,
  expectedSha256: string,
  expectedRecordSetDigest: string,
): DriftCheckResult {
  const result: DriftCheckResult = {
    checked: true,
    passed: true,
    recordCount: 0,
    uniqueIds: 0,
    idSetChanged: false,
    recordDigestsChanged: 0,
    recordSetDigestMatch: true,
    transportChanged: false,
    message: '',
  };

  if (!existsSync(sourcePath)) {
    result.passed = false;
    result.message = `Source file not found: ${sourcePath}`;
    return result;
  }

  const rawBytes = readFileSync(sourcePath);
  const currentSha = sha256FileBytes(rawBytes);

  // Check transport level
  if (currentSha !== expectedSha256) {
    result.transportChanged = true;
  }

  // Check record level
  let current;

  try { current = JSON.parse(rawBytes.toString('utf-8')); }
  catch { result.passed = false; result.message = 'Invalid JSON'; return result; }

  const todos = current.todos || [];
  if (!Array.isArray(todos)) { result.passed = false; result.message = 'No todos array'; return result; }

  result.recordCount = todos.length;
  const ids = new Set(todos.map((t: Record<string, unknown>) => t.id));
  result.uniqueIds = ids.size;

  // We can't compare to expected without loading stored, but we can compute current
  const currentRecordSetDigest = computeRecordSetDigest(todos);
  result.recordSetDigestMatch = currentRecordSetDigest === expectedRecordSetDigest;

  if (!result.recordSetDigestMatch) {
    result.passed = false;
    result.message = `Record-set digest mismatch: expected=${expectedRecordSetDigest.slice(0, 12)}... current=${currentRecordSetDigest.slice(0, 12)}...`;
  } else {
    result.message = 'Source drift check passed';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function generateInitialResults(plan: MigrationPlan): MigrationResults {
  const items: ResultItem[] = plan.items.map((item) => ({
    legacyTodoId: item.legacyTodoId,
    legacyRecordSha256: item.legacyRecordSha256,
    destination: item.destination,
    result: 'PENDING',
    workflowInstanceId: null,
    canaryReused: false,
    error: null,
  }));

  return {
    schemaVersion: RESULTS_SCHEMA_VERSION,
    planSnapshotSha256: sha256FileBytes(Buffer.from(JSON.stringify(plan))),
    sourceSnapshotSha256: plan.sourceSnapshotSha256,
    executedAt: new Date().toISOString(),
    preCheckStatus: { checked: false, passed: false, recordCount: 0, uniqueIds: 0, idSetChanged: false, recordDigestsChanged: 0, recordSetDigestMatch: false, transportChanged: false, message: 'Not yet checked' },
    postCheckStatus: null,
    counts: {
      total: plan.items.length,
      simpleTodo: plan.items.filter((i) => i.destination === 'SIMPLE_TODO').length,
      agentSelfTask: plan.items.filter((i) => i.destination === 'AGENT_SELF_TASK').length,
      ledgerOnly: plan.items.filter((i) => i.destination === 'LEDGER_ONLY').length,
      importedOpen: 0,
      reusedExisting: 0,
      discarded: 0,
      failed: 0,
    },
    items,
  };
}
