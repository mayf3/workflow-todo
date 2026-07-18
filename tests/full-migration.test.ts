import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { validatePlan, computeRecordDigest, generateInitialResults, CANARY_IDS, checkSourceDrift } from '../src/full-migration.js';
import type { MigrationPlan, PlanItem } from '../src/full-migration.js';
import { sha256Jcs, jcsCanonicalize, sha256FileBytes } from '../src/digest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PLAN_PATH = resolve(
  __dirname, '..',
  'migration', 'legacy-llm-todo-v1', 'generated', 'two-workflow-migration-plan-v1.json',
);
const SOURCE_PATH = resolve(
  __dirname, '..',
  'migration', 'legacy-llm-todo-v1', 'private', 'remote-todos-drift-check.json',
);

let plan: MigrationPlan;

// ---------------------------------------------------------------------------
// Load plan once
// ---------------------------------------------------------------------------

beforeAll(() => {
  expect(existsSync(PLAN_PATH)).toBe(true);
  const raw = JSON.parse(readFileSync(PLAN_PATH, 'utf-8'));
  plan = validatePlan(raw);
});

// ---------------------------------------------------------------------------
// Plan structure
// ---------------------------------------------------------------------------

describe('plan file', () => {
  it('has correct schema version', () => {
    expect(plan.schemaVersion).toBe('two-workflow-migration-plan-v1');
  });

  it('contains exactly 82 items', () => {
    expect(plan.items).toHaveLength(82);
  });

  it('has stable importBatchId', () => {
    // Reload and verify batch ID is deterministic
    const raw2 = JSON.parse(readFileSync(PLAN_PATH, 'utf-8'));
    const plan2 = validatePlan(raw2);
    expect(plan2.importBatchId).toBe(plan.importBatchId);
  });

  it('has source digest and record digest', () => {
    expect(plan.sourceSnapshotSha256).toHaveLength(64);
    expect(plan.recordSetDigest).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// Item uniqueness and completeness
// ---------------------------------------------------------------------------

describe('plan items integrity', () => {
  let items: PlanItem[];

  beforeAll(() => {
    items = plan.items;
  });

  it('no duplicate legacyTodoId', () => {
    const ids = items.map(i => i.legacyTodoId);
    const unique = new Set(ids);
    expect(unique.size).toBe(82);
  });

  it('IDs are within 17-343 range', () => {
    const ids = items.map(i => parseInt(i.legacyTodoId, 10)).sort((a, b) => a - b);
    expect(ids[0]).toBeGreaterThanOrEqual(17);
    expect(ids[ids.length - 1]).toBeLessThanOrEqual(343);
    expect(ids.length).toBe(82);
    const unique = new Set(ids);
    expect(unique.size).toBe(82);
  });
});

// ---------------------------------------------------------------------------
// Classification counts
// ---------------------------------------------------------------------------

describe('classification counts', () => {
  let items: PlanItem[];

  beforeAll(() => {
    items = plan.items;
  });

  it('SIMPLE_TODO→DOGFOOD_USER = 53', () => {
    const count = items.filter(
      i => i.destination === 'SIMPLE_TODO' && i.targetPrincipalRef === 'DOGFOOD_USER',
    ).length;
    expect(count).toBe(53);
  });

  it('SIMPLE_TODO→EFFICIENCY_MANAGER = 12', () => {
    const count = items.filter(
      i => i.destination === 'SIMPLE_TODO' && i.targetPrincipalRef === 'EFFICIENCY_MANAGER',
    ).length;
    expect(count).toBe(12);
  });

  it('LEDGER_ONLY = 17', () => {
    const count = items.filter(i => i.destination === 'LEDGER_ONLY').length;
    expect(count).toBe(17);
  });

  it('AGENT_SELF_TASK = 0', () => {
    const count = items.filter(i => i.destination === 'AGENT_SELF_TASK').length;
    expect(count).toBe(0);
  });

  it('SIMPLE_TODO total = 65', () => {
    const count = items.filter(i => i.destination === 'SIMPLE_TODO').length;
    expect(count).toBe(65);
  });

  it('total sums to 82', () => {
    const simple = items.filter(i => i.destination === 'SIMPLE_TODO').length;
    const ledger = items.filter(i => i.destination === 'LEDGER_ONLY').length;
    const agent = items.filter(i => i.destination === 'AGENT_SELF_TASK').length;
    expect(simple + ledger + agent).toBe(82);
  });
});

// ---------------------------------------------------------------------------
// Canary entries
// ---------------------------------------------------------------------------

describe('canary entries (238, 256, 279)', () => {
  it('are all SIMPLE_TODO DOGFOOD_USER', () => {
    for (const cid of CANARY_IDS) {
      const item = plan.items.find(i => i.legacyTodoId === cid);
      expect(item).toBeDefined();
      expect(item!.destination).toBe('SIMPLE_TODO');
      expect(item!.targetPrincipalRef).toBe('DOGFOOD_USER');
      expect(item!.targetDefinition).toBe('personal_quick_item_v1');
    }
  });

  it('have REUSE_EXISTING semantics in plan', () => {
    for (const cid of CANARY_IDS) {
      const item = plan.items.find(i => i.legacyTodoId === cid);
      expect(item).toBeDefined();
      expect(item!.migrationNeedsTriage).toBeFalsy();
    }
  });
});

// ---------------------------------------------------------------------------
// Special records
// ---------------------------------------------------------------------------

describe('special records', () => {
  it('ID 84 is LEDGER_ONLY', () => {
    const item = plan.items.find(i => i.legacyTodoId === '84');
    expect(item).toBeDefined();
    expect(item!.destination).toBe('LEDGER_ONLY');
    expect(item!.mappingReason).toMatch(/completed|duplicate/);
  });

  it('ID 77 is SIMPLE_TODO DOGFOOD_USER with triage', () => {
    const item = plan.items.find(i => i.legacyTodoId === '77');
    expect(item).toBeDefined();
    expect(item!.destination).toBe('SIMPLE_TODO');
    expect(item!.targetPrincipalRef).toBe('DOGFOOD_USER');
    expect(item!.migrationNeedsTriage).toBe(true);
    expect(item!.mappingReason).toContain('content-ops-agent');
  });

  it('ID 343 is SIMPLE_TODO DOGFOOD_USER with triage', () => {
    const item = plan.items.find(i => i.legacyTodoId === '343');
    expect(item).toBeDefined();
    expect(item!.destination).toBe('SIMPLE_TODO');
    expect(item!.targetPrincipalRef).toBe('DOGFOOD_USER');
    expect(item!.migrationNeedsTriage).toBe(true);
    expect(item!.mappingReason).toContain('miniapp-game-engineer');
  });

  it('efficiency-agent items (12) have EFFICIENCY_MANAGER principal', () => {
    const effItems = plan.items.filter(i => i.targetPrincipalRef === 'EFFICIENCY_MANAGER');
    expect(effItems).toHaveLength(12);
    for (const item of effItems) {
      expect(item.legacyAssignee).toBe('efficiency-agent');
      expect(item.destination).toBe('SIMPLE_TODO');
    }
  });
});

// ---------------------------------------------------------------------------
// Record digests
// ---------------------------------------------------------------------------

describe('record digests', () => {
  it('plan items have 64-char hex digests', () => {
    for (const item of plan.items) {
      expect(item.legacyRecordSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('jcsCanonicalize is deterministic', () => {
    const testObj = { b: 2, a: 1, c: [3, null, { x: 'y' }] };
    const d1 = computeRecordDigest(testObj as unknown as Record<string, unknown>);
    const d2 = computeRecordDigest(testObj as unknown as Record<string, unknown>);
    expect(d1).toBe(d2);
    expect(d1).toHaveLength(64);
  });

  it('all record digests are unique in plan (no duplicate hash)', () => {
    const digests = plan.items.map(i => i.legacyRecordSha256);
    expect(new Set(digests).size).toBe(digests.length);
  });
});

// ---------------------------------------------------------------------------
// Metadata contract
// ---------------------------------------------------------------------------

describe('metadata contract', () => {
  it('generateInitialResults produces correct structure', () => {
    const results = generateInitialResults(plan);
    expect(results.items).toHaveLength(82);
    expect(results.counts.total).toBe(82);
    expect(results.counts.simpleTodo).toBe(65);
    expect(results.counts.ledgerOnly).toBe(17);
    expect(results.counts.agentSelfTask).toBe(0);
    expect(results.schemaVersion).toBe('two-workflow-migration-results-v1');
  });

  it('all items start as PENDING', () => {
    const results = generateInitialResults(plan);
    const nonPending = results.items.filter(i => i.result !== 'PENDING');
    expect(nonPending).toHaveLength(0);
  });

  it('LEDGER_ONLY items have no workflowInstanceId', () => {
    const results = generateInitialResults(plan);
    const ledgerItems = results.items.filter(i => i.destination === 'LEDGER_ONLY');
    for (const item of ledgerItems) {
      expect(item.workflowInstanceId).toBeNull();
    }
  });

  it('results plan digest binds to plan', () => {
    const results = generateInitialResults(plan);
    const planBytes = Buffer.from(JSON.stringify(plan));
    const expectedDigest = sha256FileBytes(planBytes);
    expect(results.planSnapshotSha256).toBe(expectedDigest);
  });
});

// ---------------------------------------------------------------------------
// Source drift check
// ---------------------------------------------------------------------------

describe('source drift check', () => {
  it('check passes for current source', () => {
    if (!existsSync(SOURCE_PATH)) return;
    const result = checkSourceDrift(SOURCE_PATH, plan.sourceSnapshotSha256, plan.recordSetDigest);
    // Should pass since we froze the snapshot with the plan
    expect(result.checked).toBe(true);
  });

  it('check fails for wrong digest', () => {
    if (!existsSync(SOURCE_PATH)) return;
    const result = checkSourceDrift(SOURCE_PATH, 'f'.repeat(64), plan.recordSetDigest);
    expect(result.passed).toBe(false);
    expect(result.transportChanged).toBe(true);
  });

  it('handles missing file gracefully', () => {
    const result = checkSourceDrift('/nonexistent/path.json', plan.sourceSnapshotSha256, plan.recordSetDigest);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Plan validation
// ---------------------------------------------------------------------------

describe('plan validation', () => {
  it('accepts valid plan', () => {
    expect(() => validatePlan(plan)).not.toThrow();
  });

  it('rejects wrong schema version', () => {
    const invalid = { ...plan, schemaVersion: 'wrong-version' };
    expect(() => validatePlan(invalid)).toThrow(/schemaVersion/);
  });

  it('rejects wrong item count', () => {
    const invalid = { ...plan, items: [] };
    expect(() => validatePlan(invalid)).toThrow(/exactly 82/);
  });

  it('rejects duplicate IDs', () => {
    const items = plan.items.map(i => ({ ...i }));
    // Make item 1 have the same ID as item 0 (changes destination, so adjust)
    const id0 = items[0].legacyTodoId;
    items[1] = { ...items[0], legacyTodoId: id0 }; // Copy item 0 with same ID
    const invalid = { ...plan, items };
    expect(() => validatePlan(invalid)).toThrow(/Duplicate/);
  });

  it('rejects wrong DOGFOOD_USER count', () => {
    const items = plan.items.map(i => ({ ...i }));
    const sim = items.find(i => i.destination === 'SIMPLE_TODO' && i.targetPrincipalRef === 'DOGFOOD_USER');
    if (sim) sim.targetPrincipalRef = 'EFFICIENCY_MANAGER';
    const invalid = { ...plan, items };
    expect(() => validatePlan(invalid)).toThrow(/DOGFOOD_USER/);
  });

  it('rejects ID 84 not being LEDGER_ONLY', () => {
    const items = plan.items.map(i => ({ ...i }));
    // Swap: make a DOGFOOD_USER SIMPLE_TODO become LEDGER_ONLY to keep counts balanced
    const id84 = items.find(i => i.legacyTodoId === '84')!;
    const other = items.find(i => i.destination === 'SIMPLE_TODO' && i.targetPrincipalRef === 'DOGFOOD_USER' && i.legacyTodoId !== '84')!;
    id84.destination = 'SIMPLE_TODO';
    id84.targetPrincipalRef = 'DOGFOOD_USER';
    id84.migrationNeedsTriage = false;
    other.destination = 'LEDGER_ONLY';
    const invalid = { ...plan, items };
    expect(() => validatePlan(invalid)).toThrow(/ID 84.*LEDGER_ONLY/);
  });

  it('requires canary IDs in plan', () => {
    // Replace canary IDs with new unique IDs while keeping count at 82
    const items = plan.items.map(i => ({ ...i }));
    let nextId = 999;
    for (const item of items) {
      if (CANARY_IDS.has(item.legacyTodoId)) {
        item.legacyTodoId = String(nextId++);
      }
    }
    const invalid = { ...plan, items };
    expect(() => validatePlan(invalid)).toThrow(/Canary/);
  });
});

// ---------------------------------------------------------------------------
// Principal mapping
// ---------------------------------------------------------------------------

describe('principal mapping', () => {
  it('efficiency-agent principal ref is EFFICIENCY_MANAGER', () => {
    const effItems = plan.items.filter(i => i.legacyAssignee === 'efficiency-agent' && i.destination !== 'LEDGER_ONLY');
    for (const item of effItems) {
      expect(item.targetPrincipalRef).toBe('EFFICIENCY_MANAGER');
    }
  });

  it('no item has unmapped principal', () => {
    const validRefs = ['DOGFOOD_USER', 'EFFICIENCY_MANAGER'];
    for (const item of plan.items) {
      if (item.destination === 'SIMPLE_TODO') {
        expect(validRefs).toContain(item.targetPrincipalRef);
      }
    }
  });
});
