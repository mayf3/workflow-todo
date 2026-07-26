# Legacy LLM Todo Migration

This directory archives the one-time migration from the legacy LLM Todo system
to svc-workflow workflow instances.

## What happened

The original LLM Todo system was a standalone SQLite-backed todo application.
Its 82 items were migrated to svc-workflow as `personal_quick_item_v1`
instances, preserving titles, descriptions, status, and provenance metadata.

## What is kept

| Path | Purpose |
|---|---|
| `generated/two-workflow-migration-plan-v1.json` | Final migration plan manifest |
| `receipts/full-migration-preflight-receipt-v1.json` | Preflight verification receipt |
| `tools/migrate-legacy-todos-once.ts` | Reusable one-time migration script |
| `README.md` | This summary |

## What is not here

Process audit reports, canary evidence, and interim debugging files that were
part of the original migration work have been removed. They remain only in
the Git history.

The `private/` subdirectory (raw export data containing PII) and
`generated/.env.full-migration.local` (migration environment file) are listed
in `.gitignore` and are not tracked by Git.

## Caveats

- The migration script (`tools/migrate-legacy-todos-once.ts`) depends on the
  Workflow SDK and auth-service being available.
- This directory is historical evidence. It is not part of the current
  workflow-todo runtime.
