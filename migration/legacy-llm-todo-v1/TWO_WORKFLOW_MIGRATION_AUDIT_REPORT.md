# Two-Workflow Full Migration 独立审计报告

## Candidate

| Metric | Value |
|---|---|
| base | `e90daac84dd75da042662257d3bc5c3beef80b90` |
| candidate | `3b47df63659dc2c45347a9caf7c4c10e1a1cbde9` |
| tree | `2637a0b40697094f1fa38e0613aa94715965fc7a` |
| branch | `main` |
| clean | ✅ tracked workspace clean; untracked = audit report artifacts |

**Status**: `CANDIDATE_FROZEN`

---

## Scope

| Metric | Result |
|---|---|
| Changed files | 8 files (matches expected set exactly) |
| Unacceptable changes (backend, Definition, DB migrations, legacy-import semantics, identity model, remote data, tokens/secrets) | ❌ None |

---

## Plan

| Metric | Result |
|---|---|
| Total | 82 ✅ |
| DOGFOOD_USER | 53 ✅ |
| EFFICIENCY_MANAGER | 12 ✅ |
| LEDGER_ONLY | 17 ✅ |
| AGENT_SELF_TASK | 0 ✅ |
| REUSE_EXISTING (canaries 238, 256, 279) | 3 ✅ |
| NEW_CREATE | 62 ✅ |
| Missing/duplicate IDs | 0/0 ✅ |

Special records (77→triage, 84→LEDGER_ONLY, 343→triage) all confirmed correct. EFFICIENCY_MANAGER's 12 items verified — none is ID 84. Runtime classification protection via `validatePlan()` is comprehensive.

---

## Source

| Check | Result |
|---|---|
| Pre-check | ✅ Implemented |
| Post-check | ❌ **NOT implemented** |

### Finding F2 (HIGH): Post-check not implemented
`postCheckStatus` defined but never populated. Source changes during 62-Create migration go undetected.

---

## Metadata Pre-flight

| Check | Result |
|---|---|
| Isolated DB test | ❌ **NOT performed** |
| Detail readback | ❌ Not done |

### Finding F1 (HIGH): No isolated metadata contract preflight
All 14 metadata fields defined but never dynamically verified against a real DB. Per spec: must audit-fail without this.

---

## Identity

| Check | Finding |
|---|---|
| Token separation | ✅ |
| JWT subject validation | ❌ **F6 (MEDIUM)** — `resolveToken()` doesn't verify `sub` claim |
| Secret exposure | ✅ No tokens in plan/results |
| `.gitignore` too broad | ❌ **F5 (MEDIUM)** — `.env.*` swallows `.env.example` |

---

## Canary Reuse

| Check | Finding |
|---|---|
| Canary IDs not re-created | ✅ |
| Worklist pagination | ❌ **F7 (MEDIUM)** — no cursor pagination |
| Record digest verified | ❌ Not checked |
| Definition version verified | ✅ |

---

## LEDGER_ONLY

17 items, zero Create/Advance calls. ✅ All IDs verified.

---

## Run Safety

| Check | Finding |
|---|---|
| Dry-run safe | ✅ |
| Pre-source-check | ✅ |
| Definition PUBLISHED check | ❌ **F4 (HIGH)** |
| Post-create detail readback | ❌ **F8 (MEDIUM)** |
| scanForSecrets called | ❌ **F3 (HIGH)** — imported but never invoked |
| Post-source-check | ❌ **F2 (HIGH)** |
| READY_FOR_AUDIT output | ❌ **F11 (LOW)** |
| Results per-item persistence | ✅ |
| Stable idempotency key | ✅ |

---

## Structure

| File | Lines | Limit | Status |
|---|---|---|---|
| `cli.ts` | 404 | ≤500 | ✅ |
| `full-migration.ts` | 494 | ≤500 | ✅ (6 left) |
| `full-migration-cli.ts` | 315 | ≤500 | ✅ |
| plan JSON | 997 | — | Generated data, exempt |

---

## Tests

| Check | Result |
|---|---|
| Test count | 132/132 ✅ |
| Build | 0 TS errors ✅ |
| .skip/.only | ❌ None |
| @ts-ignore/@ts-nocheck | ❌ None |
| broad `any` (in full-migration code) | ❌ None |

**Missing coverage**: scanForSecrets, idempotency conflict, partial resume, post-check drift, dry-run zero-write, LEDGER_ONLY zero-write, two-Principal isolation.

---

## Findings

| # | Severity | Title | File | Required |
|---|---|---|---|---|
| F1 | **HIGH** | No isolated metadata preflight | `full-migration.ts:303-325` | Create test instance in temp DB, readback, compare 14 fields, cleanup |
| F2 | **HIGH** | Post-migration drift check missing | `full-migration.ts:72` | Add `checkSourceDrift` call after all items |
| F3 | **HIGH** | scanForSecrets imported but unused | `full-migration.ts:17` | Invoke on plan + results |
| F4 | **HIGH** | No Definition PUBLISHED validation | `full-migration-cli.ts:50` | Validate versionStatus before write |
| F5 | **MEDIUM** | `.env.*` gitignore too broad | `.gitignore:8` | Narrow to `.env.*.local` |
| F6 | **MEDIUM** | No JWT subject validation | `full-migration.ts:214-221` | Call `validateTokenSubject()` |
| F7 | **MEDIUM** | Canary worklist no pagination | `full-migration.ts:259` | Add cursor pagination loop |
| F8 | **MEDIUM** | No post-create detail readback | `full-migration.ts:354-364` | Add `client.detail()` call |
| F9 | **MEDIUM** | Result status: `IMPORTED_OPEN` not `CREATED`/`VERIFIED` | `full-migration.ts:26-29` | Add `VERIFIED` state after readback |
| F10 | **LOW** | full-migration.ts at 494/500 lines | `full-migration.ts:1` | Consider splitting |
| F11 | **LOW** | Missing READY_FOR_AUDIT output | `full-migration-cli.ts:246-256` | Add final status |
| F12 | **LOW** | groupByPrincipal fallback | `full-migration-cli.ts:88` | Narrow null-ref filter |

## Verdict

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| **HIGH** | **4** |
| MEDIUM | 5 |
| LOW | 3 |

### Final Status

```
TWO_WORKFLOW_FULL_MIGRATION_IMPLEMENTATION_AUDIT_FAIL
```

### REAL_DOGFOOD_MIGRATION_ALLOWED: NO

**Rationale**: 4 HIGH findings (F1–F4) block the audit per the rule "Blocker > 0 或 High > 0 → AUDIT_FAIL → 禁止长期库迁移."

Before re-audit, correct all 4 HIGH findings plus the 5 MEDIUM findings.

---

*Auditor: Independent audit agent  |  2026-07-18T09:08Z  |  Candidate: 3b47df63*
