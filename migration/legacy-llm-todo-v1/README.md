# Legacy LLM Todo Migration

This directory archives the one-time migration from the legacy LLM Todo system
to svc-workflow workflow instances.

## What happened

82 legacy items were processed. 65 were successfully created as
`personal_quick_item_v1` workflow instances. 17 items were recorded as
ledger-only (skipped — already completed, test entries, or duplicates).
0 items failed. The `agent_self_task_v1` definition was not provisioned
in the cutover environment; its verification was deferred.

After cutover, the legacy llm-todo service was shut down and its write
routes were removed from the codebase.

## Evidence files

| Category | File | Purpose |
|---|---|---|
| **Plan** | `generated/two-workflow-migration-plan-v1.json` | The migration plan with all 82 items mapped to target definitions and principals |
| **Preflight** | `receipts/full-migration-preflight-receipt-v1.json` | Preflight verification: digest match, contract match, provisioning state |
| **Execution** | `final-migration-summary.json` | Compact final result summary with counts and verification status |
| **Tool** | `tools/migrate-legacy-todos-once.ts` | Reusable one-time migration script |
| **Summary** | `README.md` | This overview |

## Caveats

- The migration tool (`tools/migrate-legacy-todos-once.ts`) depends on the
  Workflow SDK and auth-service being available.
- This directory is historical evidence. It is not part of the current
  workflow-todo runtime.

## What is not here

Process audit reports, canary evidence, interim debugging files, and the
detailed final cutover report that were part of the original migration have
been removed. They remain only in the Git history.

The `private/` subdirectory (raw export data containing PII) and
`generated/.env.full-migration.local` (migration environment file) are listed
in `.gitignore` and are not tracked by Git.
