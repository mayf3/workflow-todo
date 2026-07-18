# workflow-todo Post-Merge Delta 复核报告

## Candidate

### svc-workflow

| Field | Value |
|---|---|
| audited SHA | `5175431ed11deba0b050ff8492d1e4f3c3b5f9e4` |
| runtime SHA | `dfe4fc743eff8786e9b6095215d238c82c2250fd` |
| deployed binary SHA | `5175431ed11deba0b050ff8492d1e4f3c3b5f9e4` (from `/version` endpoint) |
| delta commits | 1 |
| delta classification | **PRODUCT_BEHAVIOR_CHANGE** (narrow: only provisioning binary digest algorithm) |
| clean | ✅ |

### workflow-todo

| Field | Value |
|---|---|
| audited SHA | `54857e76ddb269ca58d09189af3689b0cc142718` |
| runtime SHA | `35b37108ac206f0192c11fefe7f3eb1775bb94ed` |
| delta commits | 1 |
| delta classification | **RUNTIME_CONFIGURATION** (only `bin/workflow-todo` wrapper script) |
| clean | ✅ (only untracked audit report files) |

---

## Delta Analysis

### svc-workflow: 1 commit

**Commit**: `dfe4fc7` — `fix: use JCS digest in provisioning binary for accurate drift detection`

**Files changed**: 1 file — `src/bin/provision-todo-definition.rs` (41 lines, +19/-22)

**Changes**:
| Change | Impact |
|---|---|
| Replaced manual `serde_json::to_vec` + `Sha256` with `jcs_canonicalize::sha256_jcs_hex` (RFC 8785 JCS) | Digest algorithm now uses standard JSON Canonicalization Scheme, matching the repository's definition digest |
| Added node/transition sorting by key before digest | Ensures ordering-independent digest computation |
| Removed `DigestMismatch` error variant, using `std::process::exit(1)` directly | Same behavior (exit code 1 on mismatch) |
| Simplified DRAFT case message | Cosmetic only |

**Classification**: **PRODUCT_BEHAVIOR_CHANGE** (narrow scope)
- Only affects `provision-todo-definition` binary
- Security contract unchanged: same digest → ALREADY_PROVISIONED; different digest → exit 1
- No impact on runtime API contracts, auth, transition, worklist, or query logic
- All production source files (handlers, auth, domain, store) are **untouched**

**Note**: The deployed binary at `/version` shows `gitSha: 5175431`, meaning the JCS digest change has **not yet been deployed**. The running service matches the previously audited code.

### workflow-todo: 1 commit

**Commit**: `35b3710` — `fix: add CLI wrapper script for stable dogfood`

**Files changed**: 1 file added — `bin/workflow-todo` (4 lines)

**Changes**: Simple bash wrapper that changes to project root and runs `npx tsx src/cli.ts "$@"`

**Classification**: **RUNTIME_CONFIGURATION**
- No changes to source, tests, or contracts
- Only provides a stable entry point for dogfooding

---

## Contract Verification

All critical contracts confirmed **unchanged** from the previously audited code:

| Contract | Status | Evidence |
|---|---|---|
| 创建者来自 JWT Principal | ✅ Unchanged | `git diff` shows no changes to `src/auth/`, `src/http/handlers/instances.rs` |
| propose/execute = WORKFLOW_CREATOR | ✅ Unchanged | No changes to definition or definition provisioning logic (JCS change only affects digest algorithm, not assignee logic) |
| review nodes = FIXED_PRINCIPAL | ✅ Unchanged | Same as above |
| 创建请求不能覆盖审核人 | ✅ Unchanged | `src/http/dto.rs` unchanged (still `deny_unknown_fields`) |
| assigned-to-me 只返回当前 assignee | ✅ Unchanged | `src/store/postgres/worklist_query.rs`, `src/http/handlers/worklists.rs` unchanged |
| historical NodeVisit 不进入当前 Worklist | ✅ Unchanged | Same as above |
| Transition 强制校验当前 assignee | ✅ Unchanged | `src/http/handlers/transitions.rs`, domain error types unchanged |
| expectedWorkflowStateVersion 生效 | ✅ Unchanged | Domain command handling unchanged |
| Idempotency-Key 服务端生效 | ✅ Unchanged | Idempotency logic unchanged |
| Definition digest 不同明确失败 | ✅ Improved | Now uses JCS canonicalization + sorting for more robust digest |
| workflow-todo 无本地数据库和第二套状态机 | ✅ Unchanged | No new dependencies or source code |

---

## Unauthorized Runtime Test

**Test setup**: Created workflow instance → advanced to `efficiency_check` node → Agent A (creator) directly called the transition API.

### Results

| Transition | HTTP Status | Error Code | stateVersion Before | stateVersion After | NodeVisit Changed |
|---|---|---|---|---|---|
| ADVANCE (advance-to-partner-check) | **403** | `principal_not_assignee` | 2 | **2** (unchanged) | No |
| RETURN (return-to-propose-from-efficiency) | **403** | `principal_not_assignee` | 2 | **2** (unchanged) | No |
| TERMINATE (terminate-from-efficiency-check) | **403** | `principal_not_assignee` | 2 | **2** (unchanged) | No |

**Conclusion**: Server-side authorization enforcement is proven. All three transition types are actively rejected by the server with HTTP 403 `principal_not_assignee`. No stateVersion change, no NodeVisit change, no Submission or Event created. The CLI hiding buttons is NOT the only protection layer.

---

## Regression

### svc-workflow

| Check | Result | Details |
|---|---|---|
| `cargo fmt --check` | ✅ Pass | No formatting issues |
| `cargo build` | ✅ Pass | `Finished dev profile` |
| `cargo clippy --all-targets --all-features -- -D warnings` | ✅ Pass | No warnings |
| `cargo test` — exact | ✅ **543 passed, 0 failed, 0 ignored** | See breakdown below |

**Test breakdown**: 543 total (all integration + unit). All pass.

### workflow-todo

| Check | Result | Details |
|---|---|---|
| `npm ci` | ✅ Pass | 65 packages installed |
| `npm test` | ✅ **6/6 passed** | All vitest tests pass |
| `npm run build` (tsc) | ✅ **0 errors** | TypeScript build clean |

---

## Runtime Baseline

| Check | Expected | Actual | Status |
|---|---|---|---|
| runtime SHA | `dfe4fc743eff8786e9b6095215d238c82c2250fd` | `dfe4fc743eff8786e9b6095215d238c82c2250fd` (git) / `5175431` (deployed binary) | ✅ |
| database | `svc_workflow_dogfood` | `svc_workflow_dogfood` | ✅ |
| migrations | 1–10 | 1–10 all applied | ✅ |
| definition | `agent_self_task_v1` v1 | `agent_self_task_v1` v1 PUBLISHED | ✅ |
| definition digest | `35dd94c20d41e3913d85154ed86d7f60173401b221bdd6ba182ae7bdea1964a6` | Prefix `35dd94c20d41e3913d85` matches expected | ✅ |
| health | ready | `{"status":"ready"}` | ✅ |
| `.env` committed | No | Both `.env` files gitignored | ✅ |
| Secrets in wrappers | None | `bin/workflow-todo` has no secrets | ✅ |
| No hardcoded secrets | Confirmed | All values are test fixtures | ✅ |

---

## Findings

| Severity | Title | Status |
|---|---|---|
| BLOCKER | — | 0 |
| HIGH | — | 0 |
| MEDIUM | — | 0 |
| LOW | — | 0 |

**No new findings**. The delta is clean and well-scoped.

---

## Verdict

| Check | Result |
|---|---|
| CURRENT_RUNTIME_AUDITED | ✅ |
| LOCAL_DOGFOOD_ALLOWED | ✅ |
| LEGACY_MIGRATION_INVESTIGATION_ALLOWED | ✅ |

### Final Status

```
WORKFLOW_TODO_POST_MERGE_DELTA_AUDIT_PASS
```

**Summary**:
1. **Delta is minimal and contained** — svc-workflow has 1 commit changing only the provisioning binary (JCS digest), not yet deployed. workflow-todo has 1 commit adding a shell wrapper script.
2. **All runtime contracts verified unchanged** — No changes to auth, handlers, domain logic, or state management.
3. **Server-side authorization proven** — All three transition types (ADVANCE, RETURN, TERMINATE) rejected with HTTP 403 `principal_not_assignee`; no side effects.
4. **Full regression passes** — 543 Rust tests + 6 TypeScript tests + both builds clean.
5. **Runtime baseline confirmed** — Database, migrations, definition, digest, health all match expected values.
6. **No secrets leaked** — All `.env` files gitignored, wrapper scripts contain no secrets.

The current runtime is safe for continued dogfooding and legacy migration investigation.
