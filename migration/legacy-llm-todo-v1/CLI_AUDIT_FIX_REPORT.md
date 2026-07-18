# workflow-todo CLI 简洁输出审计整改报告

## Git

| Field | Value |
|---|---|
| base | `672025c34a4865cbd2f83621dad7b829d296ae19` (main) |
| branch | `feat/cli-readable-output-v0` |
| push | 否 |

## Structure

| File | Lines | Limit | Status |
|------|-------|-------|--------|
| `src/cli.ts` | 387 | ≤ 500 | ✅ |
| `src/cli-args.ts` | 128 | ≤ 250 | ✅ (new) |
| `src/formatters.ts` | 198 | ≤ 500 | ✅ |

## Argument Contract

| Scenario | Result |
|----------|--------|
| default → text | ✅ |
| `--json` → json | ✅ |
| `--format json` → json | ✅ |
| `--format text` → text | ✅ |
| `--json --format text` → error | ✅ |
| `--format` (no value) → error | ✅ |
| duplicate `--format` → error | ✅ |
| unknown format → error | ✅ |
| remainingArgs preserves order | ✅ |

## Command Consistency

All four commands (`create`, `my-worklist`, `detail`, `advance`) use the same `resolveMode()` entry point.

## JSON Compatibility

| Check | Result |
|---|---|
| stdout purity | ✅ logs/stderr separated |
| pipe through `jq` | ✅ `JSON.parse()` success |
| raw response preserved | ✅ snake_case, no added fields |

## Tests

| Metric | Value |
|---|---|
| previous tests | 72 (client 6 + formatters 17 + legacy-import 49) |
| new tests | 23 (cli-args) |
| total | **95** |
| passed | **95** |
| build | **TypeScript 0 errors** |
| skipped tests | 0 |
| `.only` / `.skip` | 无 |
| `@ts-ignore` / `@ts-nocheck` | 无 |

## Dogfood

| Check | Result |
|---|---|
| DOGFOOD_USER text worklist | ✅ 3 items at open |
| DOGFOOD_USER json worklist | ✅ `JSON.parse` success |
| DOGFOOD_USER text detail | ✅ provenance visible |
| DOGFOOD_USER json detail | ✅ `visibility=full` |
| state mutation | 否 |

## Deferred Debt

| Item | Priority | Reason |
|------|----------|--------|
| detail timeline | LOW | need separate API call, out of scope |
| advance from→to | LOW | requires detail lookup, out of scope |

## Scope

| Check | Result |
|---|---|
| backend changes | 无 |
| workflow semantic changes | 无 |
| DB changes | 无 |
| Definition changes | 无 |
| push/tag | 无 |

## Final Status

```
WORKFLOW_TODO_CLI_READABLE_OUTPUT_FINDINGS_FIXED_READY_FOR_REAUDIT
```
