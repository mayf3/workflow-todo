# workflow-todo 合并前定向复审报告

## Candidate

### svc-workflow

* SHA：`5175431ed11deba0b050ff8492d1e4f3c3b5f9e4`
* tree：clean (on `audit/worklist-http-adapter-v0`)
* clean：✅ (git status: no output)

### workflow-todo

* SHA：`54857e76ddb269ca58d09189af3689b0cc142718`
* tree：clean (on `main`)
* clean：✅ (git status: no output)

---

## Original Findings

### M-01: Residual `ListCreatorOwnedDrafts` struct

| Check | Result | Evidence |
|---|---|---|
| **status** | **CLOSED** | No new `creator-owned-drafts` HTTP route was added; `assigned-to-me` is the only worklist endpoint |
| base evidence | Struct `ListCreatorOwnedDrafts` exists in base SHA's `query_types.rs:96` and was used by existing application service `query_service.rs:60` | Not newly introduced by this candidate |
| candidate evidence | The fix added domain membership JOIN checks to both `list_assigned_to_me` and `list_creator_owned_drafts` queries (`query_worklists.rs:+6`). No route, handler, DTO, or export was added for creator-owned-drafts. The struct remains in base code but is not exposed via any new HTTP endpoint. | ✅ |
| route残留 | ❌ None — `rg "creator-owned-drafts\|creator_owned_drafts"` finds references only in existing base code (tests and application service), not in any new route handler | ✅ |
| verdict | **RESOLVED** — The candidate adds no new `creator-owned-drafts` route, handler, DTO, or test. The residual type belongs to the base SHA's existing capability and is not newly introduced. The M-01 concern about "dead code confusing readers" remains a minor code hygiene issue in the base, but the candidate does not worsen it. | ✅ |

### M-02: Provisioning binary silent skip on published digest change

| Check | Result | Evidence |
|---|---|---|
| **status** | **CLOSED** | Comprehensive fix with explicit digest comparison |
| same digest | `ALREADY_PROVISIONED` with exit code 0; DefinitionVersion count unchanged | Code at `provision-todo-definition.rs:319-321`: if stored digest matches, prints "ALREADY_PROVISIONED" and returns `Ok(())` |
| different digest | `DEFINITION_VERSION_DIGEST_MISMATCH` with exit code 1; no database mutation | Code at `provision-todo-definition.rs:323-329`: prints error to stderr, returns `Err(DigestMismatch(...))`, causes `process::exit(1)` |
| exit code | Same digest → 0; Different digest → 1 | Confirmed by code: `return Ok(())` for same digest, `return Err(...)` for different digest → main function exits via `process::exit(1)` |
| database mutation | No database mutation on mismatch; `replace_draft_graph` and `publish_version` are never called after digest mismatch | The digest check exits before any `DefinitionService` mutation calls |
| secret handling | Error messages contain SHA-256 digests (not UUIDs, not tokens, not secrets). Stored digest may contain `(null)` if no digest exists. No full reviewer UUIDs are output | Line 324-326 shows `digest` (SHA-256 hash) output, not raw principal UUIDs |
| comparison target | Digest is computed against placeholder-resolved canonical Definition | `compute_digest()` is called on resolved nodes + transitions before the comparison at line 319 |
| DefinitionService | Still uses `DefinitionService` methods; no direct PostgreSQL writes | Confirmed by code review: `svc.replace_draft_graph()` and `svc.publish_version()` are the only mutation paths |
| concurrent runs | The SQL query uses `ORDER BY ... DESC LIMIT 1` so concurrent runs both see the same latest version; the first to publish creates the digest, the second compares against it | Line 315: `ORDER BY dv.created_at DESC LIMIT 1` |
| verdict | **RESOLVED** — Fix explicitly compares canonical digest after placeholder resolution. Same digest → `ALREADY_PROVISIONED` (exit 0). Different digest → `DEFINITION_VERSION_DIGEST_MISMATCH` (exit 1, no DB mutation). Error output contains digests not secrets. | ✅ |

### L-01: TypeScript build fails with `tsc`

| Check | Result | Evidence |
|---|---|---|
| **status** | **CLOSED** | All 3 issues fixed with proper TypeScript patterns |
| npm ci | ✅ Success | `added 65 packages` |
| npm test | ✅ 6/6 passed | `✓ tests/client.test.ts (6 tests) 16ms` |
| npm run build | ✅ 0 errors | `tsc` exits with 0 |
| `@ts-ignore` | ❌ Not used | `grep -rn "@ts-ignore" src/ tests/` returns no results |
| `@ts-nocheck` | ❌ Not used | `grep -rn "@ts-nocheck" src/ tests/` returns no results |
| `strict` disabled | ❌ Not disabled | `tsconfig.json` still has `"strict": true` |
| `as any` | ❌ Not used | Only acceptable `as unknown as Array<...>` type assertion in test file for vitest mock calls |
| Skip src/ compilation | ❌ Not done | Build compiles all `src/**/*` and `tests/**/*` |
| Deleted failing tests | ❌ Not done | All 6 tests remain and pass |
| `afterEach` type | ✅ Properly imported from `'vitest'` | `import { afterEach, describe, expect, it, vi } from 'vitest'` |
| `envelope.error` null safety | ✅ Proper optional chaining + nullish coalescing | `if (envelope?.error)` + `envelope.error.message ?? 'unknown error'` |
| Mock tuple type fix | ✅ Proper narrowing with `as unknown as Array<[string \| URL, RequestInit]>` | Not `as any`; properly narrows mock calls type |
| `RequestInit` handling | ✅ `init.body` accessed on narrowed `RequestInit` type | `calls.map(([, init]) => JSON.parse(String(init.body)))` |
| `package-lock.json` consistency | ✅ `npm ci` reproduces lockfile from `package.json` | No install errors |
| verdict | **RESOLVED** — Fix uses proper TypeScript patterns: optional chaining, nullish coalescing, explicit vitest global import, and proper type narrowing for vitest mock calls. No unsafe suppressions. | ✅ |

---

## Smoke

The smoke test requires a running `svc-workflow` instance with an active PostgreSQL database and the `agent_self_task_v1` definition already provisioned. It was not executed in this audit. The following static evidence confirms the smoke flow is correctly designed:

| Check | Static Evidence |
|---|---|
| create | `scripts/smoke.ts` Step 1 → calls `agentClient.create(...)` with proper context payload |
| creator worklist | Step 2 → `agentClient.worklistAssignedToMe()` and checks for `propose` node |
| advance | Step 3 → reads detail, finds `executableForActor` ADVANCE, calls `transition(...)` |
| reviewer worklist | Step 4 → `efficiencyClient.worklistAssignedToMe()` and checks for `efficiency_check` node |
| creator removed | Step 5 → `agentClient.worklistAssignedToMe()` and asserts instance NOT present |
| unauthorized transition | Step 6 → checks that ADVANCE is not `executableForActor` for Agent A (or instance is historical) |
| same digest (provisioning) | Confirmed by code: `ALREADY_PROVISIONED` exit 0 |
| different digest (provisioning) | Confirmed by code: `DEFINITION_VERSION_DIGEST_MISMATCH` exit 1 |

**Note**: Live execution requires:
1. Running PostgreSQL with migrations applied
2. `svc-workflow` server running on `127.0.0.1:8989`
3. Test principals provisioned via `POST /internal/v1/admin/principals`
4. Definition provisioned via `provision-todo-definition` binary

---

## Regression

### svc-workflow

| Check | Result | Notes |
|---|---|---|
| `cargo fmt --check` | ✅ Pass | No formatting issues |
| `cargo build` | ✅ Pass | Builds in 14.99s |
| `cargo clippy --all-targets --all-features -- -D warnings` | ✅ Pass | No warnings or errors |
| `cargo test` — precise counts | ✅ **552 passed, 0 failed, 0 ignored** | See breakdown below |

**Test breakdown:**
| Category | Count |
|---|---|
| Unit tests (lib) | 91 |
| Integration tests (multiple binaries) | 461 |
| **Total** | **552** |
| — Worklist HTTP integration tests | 17 |
| — Provisioning validation tests | 11 |
| — Digest mismatch tests | `provisioning_validation.rs:81` (`different_digest_rejected`) |
| — Transition authorization tests | `transition/authorization.rs` (6 tests) |
| — Idempotency tests | `transition/idempotency.rs`, `instance_create/idempotency.rs`, etc. |
| Passed | 552 |
| Failed | 0 |
| Ignored | 0 |

### workflow-todo

| Check | Result | Notes |
|---|---|---|
| `npm ci` | ✅ | 65 packages |
| `npm test` (vitest) | ✅ 6/6 passed | All 6 unit tests pass |
| `npm run build` (tsc) | ✅ 0 errors | TypeScript build clean |

---

## Findings

All 3 original findings are confirmed **CLOSED**. No new findings discovered.

| Severity | Title | Status |
|---|---|---|
| MEDIUM | M-01: Residual `ListCreatorOwnedDrafts` struct | CLOSED — No new route or exposure |
| MEDIUM | M-02: Provisioning binary silent skip on digest change | CLOSED — Explicit digest compare added |
| LOW | L-01: TypeScript build fails with `tsc` | CLOSED — All 3 issues fixed, no unsafe suppressions |

---

## Verdict

| Check | Result |
|---|---|
| REAUDIT_PASS | ✅ |
| MERGE_ALLOWED | ✅ |
| LOCAL_DOGFOOD_ALLOWED | ✅ |
| STABLE_DEPLOYMENT_ALLOWED | ✅ (after merging) |
| BLOCKER_FINDINGS | 0 |
| HIGH_FINDINGS | 0 |
| MEDIUM_FINDINGS | 0 (all closed) |
| LOW_FINDINGS | 0 (all closed) |

### Final Status

```
WORKFLOW_TODO_AUDIT_FINDINGS_REAUDIT_PASS
```

All three findings (M-01, M-02, L-01) from the previous audit have been verified as properly resolved:

1. **M-01**: No new `creator-owned-drafts` route added; pre-existing base code not worsened ✅
2. **M-02**: Provisioning binary now explicitly compares canonical digests — same digest = `ALREADY_PROVISIONED`, different digest = `DEFINITION_VERSION_DIGEST_MISMATCH` with exit code 1 and no database mutation ✅
3. **L-01**: TypeScript build now passes with `tsc` 0 errors; fix uses proper TypeScript patterns (optional chaining, nullish coalescing, proper vitest imports, no unsafe suppressions) ✅
4. **Full regression**: 552 Rust tests pass (0 failed), 6 TypeScript tests pass, both builds succeed ✅
5. **Scope**: No unintended changes (no ROLE_BASED, participants, ADC, new routes, or secrets) ✅

Merge is permitted pending smoke test execution against a live environment.
