# Legacy Source Drift Detection Report

**Detection time**: 2026-07-18T08:14:00Z  
**Status**: `LEGACY_SOURCE_DRIFT_DETECTED`

---

## Pre-Checks Completed Before Drift Detection

| Check | Result |
|---|---|
| svc-workflow running | ✅ `readyz=200` |
| personal_quick_item_v1 definition | ✅ Version 1, PUBLISHED, ID=`95aacea2-5599-4e74-b576-e2eeb61e27a0` |
| DOGFOOD_USER JWT | ✅ Generated with sub=`10000000-0000-0000-0000-000000000101` |
| EFFICIENCY_MANAGER JWT | ✅ Generated with sub=`10000000-0000-0000-0000-000000000020` |
| Local env config | ✅ `.env.full-migration.local` created (gitignored) |
| Existing canary instances | ✅ 3 confirmed in `svc_workflow_dogfood` |

All pre-conditions met except Source Drift.

---

## Drift Analysis

### Source Comparison

| Metric | Stored (Jul 17 14:01) | Current (Jul 18 08:14) | Status |
|---|---|---|---|
| Record count | 82 | 82 | ✅ |
| Unique IDs | 82 | 82 | ✅ |
| ID range | 17–343 | 17–343 | ✅ |
| hasMore | false | false | ✅ |
| Raw file SHA-256 | `284fe44a...` | `1000e99e...` | ❌ Changed |
| Record-set digest (JCS sorted) | `b4e0b3a4...` | `03f0e2ef...` | ❌ Changed |

### Drifted Records

| ID | Classification | Field Changes | Nature |
|---|---|---|---|
| 336 | MIGRATE_ACTIVE | `status: pending→review`, `sub_status: pending→blocked`, description updated with completion evidence | Task marked complete, awaiting review |
| 337 | MIGRATE_ACTIVE | `status: pending→review`, `sub_status: pending→in_progress`, description updated with completion evidence | Task marked complete, awaiting review |
| 338 | DISCARD_DUPLICATE_OR_TEST | `sub_status: pending→cancelled`, description updated (duplicate note) | Duplicate explicitly cancelled |
| 339 | DISCARD_DUPLICATE_OR_TEST | `sub_status: pending→cancelled`, description updated (duplicate note) | Duplicate explicitly cancelled |
| 340 | DISCARD_DUPLICATE_OR_TEST | `sub_status: pending→cancelled`, description updated (test noted) | Test task cancelled |
| 341 | MIGRATE_ACTIVE | `status: pending→review`, `sub_status: pending→in_progress`, description updated with completion evidence | Task marked complete, awaiting review |

### Classification Impact

The drifted records may change their classification:

| ID | Old Classification | Potential New Classification | Reason |
|---|---|---|---|
| 336 | MIGRATE_ACTIVE | ARCHIVE_ONLY or MIGRATE_ACTIVE | Has completion evidence but review pending |
| 337 | MIGRATE_ACTIVE | ARCHIVE_ONLY or MIGRATE_ACTIVE | Has completion evidence but review pending |
| 338 | DISCARD_DUPLICATE_OR_TEST | DISCARD_DUPLICATE_OR_TEST (unchanged) | Now explicitly cancelled |
| 339 | DISCARD_DUPLICATE_OR_TEST | DISCARD_DUPLICATE_OR_TEST (unchanged) | Now explicitly cancelled |
| 340 | DISCARD_DUPLICATE_OR_TEST | DISCARD_DUPLICATE_OR_TEST (unchanged) | Now explicitly cancelled |
| 341 | MIGRATE_ACTIVE | ARCHIVE_ONLY or MIGRATE_ACTIVE | Has completion evidence but review pending |

### Drift Snapshots Saved

- Current remote state: `migration/legacy-llm-todo-v1/private/remote-todos-drift-check.json`
- Stored baseline: `migration/legacy-llm-todo-v1/private/remote-todos-raw.json`

Both are in the gitignored `private/` directory.

---

## Blocked Actions

Per migration protocol:
- ✅ **Zero svc-workflow writes executed** — no instances created
- ✅ **No old data modified**
- ✅ **Drift evidence preserved**
- ❌ **Full migration paused** — blocked by `LEGACY_SOURCE_DRIFT_DETECTED`

---

## Decision Required

Three options to proceed:

### Option A: Re-classify with current data
Re-export from remote, re-classify all 82 records based on current state (acknowledging 6 records have changed). Re-generate migration plan with updated classification.

### Option B: Accept partial drift as non-impacting
Evaluate whether the 6 drifted records' classification actually changes. IDs 338-340 remain DISCARD (just now explicitly cancelled). IDs 336/337/341 could remain MIGRATE_ACTIVE (they were in-progress tasks that completed — still valid to migrate as completed/archived). If classification stays same, re-freeze snapshot and proceed.

### Option C: Wait for source stability
Do not migrate until the source stops changing. Re-check periodically.
