# workflow-todo

Personal / Agent task list built on [svc-workflow](https://github.com/your-org/svc-workflow).

## Product Positioning

- **workflow-todo** — CLI tool for Agents and users to manage their personal task list
  - View assigned work items (`my-worklist`)
  - Browse domain-level instances (`list --all`)
  - View task details (`detail`)
  - Create quick items or agent self tasks (`create-quick`, `create-agent`)
  - Advance authorized workflow nodes (`advance`)
- **svc-workflow** — The single Workflow state machine and data authority
- **auth-service** — The single identity, Client, Token and Scope authority

## Architecture

**Single runtime path** — The only active code path is:

```
@unified-auth/machine-token-provider  →  OAuth2 client_credentials → auth-service
@workflow-foundation/sdk              →  svc-workflow API
```

There is **no legacy runtime path**, no static access token, no direct database access,
and no fallback to alternative authentication.

## Prerequisites

- Node.js >= 20
- npm >= 9

## Installation

```bash
npm ci
npm run build
```

## Environment Variables

### Daily Runtime (workflow.read / workflow.execute)

| Variable | Required | Description |
|---|---|---|
| `SVC_WORKFLOW_BASE_URL` | Yes | svc-workflow base URL |
| `SVC_AUTH_TOKEN_ENDPOINT` | Yes | Auth-service OAuth token endpoint |
| `SVC_AUTH_MACHINE_CLIENT_ID` | Yes | Machine Client ID for daily operations |
| `SVC_AUTH_MACHINE_CLIENT_SECRET` | Yes | Corresponding Client Secret |
| `SVC_AUTH_MACHINE_RESOURCE` | No | Token resource (default: `svc-workflow`) |
| `SVC_AUTH_MACHINE_SCOPES` | No | Comma-separated scopes (default: `workflow.read`) |
| `DOMAIN_ID` | Yes | Target domain UUID |
| `PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID` | Yes | Definition version UUID for quick items |
| `AGENT_SELF_TASK_DEFINITION_VERSION_ID` | Yes | Definition version UUID for agent self tasks |
| `DEFINITION_VERSION_ID` | Yes | Retained for backward compatibility |
| `EFFICIENCY_MANAGER_PRINCIPAL_ID` | Yes | Efficiency Manager principal UUID |
| `LOBSTER_PARTNER_PRINCIPAL_ID` | Yes | Partner principal UUID |
| `SVC_WORKFLOW_REQUEST_TIMEOUT_MS` | No | Request timeout in ms (default: 35000) |

### Provisioning / Admin (workflow.admin)

These are used **only** by the provisioning script (`npm run provision`),
never by the daily CLI. They must use a dedicated Machine Principal scoped
to `workflow.admin`.

| Variable | Required | Description |
|---|---|---|
| `SVC_AUTH_PROVISIONING_CLIENT_ID` | Yes | Machine Client ID with workflow.admin scope |
| `SVC_AUTH_PROVISIONING_CLIENT_SECRET` | Yes | Corresponding Client Secret |
| `DATABASE_URL` | Yes | PostgreSQL URL (for the provisioning binary) |
| `PROVISIONING_PRINCIPAL_ID` | Yes | Principal allowed by svc-workflow allow-list |

## CLI Commands

```
workflow-todo create-quick --title <title> [--description <desc>] [--acceptance-criteria <criteria>] [--idempotency-key <key>]
    → Create a personal quick item (personal_quick_item_v1)

workflow-todo create-agent --title <title> [--description <desc>] [--acceptance-criteria <criteria>] [--idempotency-key <key>]
    → Create an agent self task (agent_self_task_v1)

workflow-todo my-worklist [--json]
    → List work items assigned to the current principal

workflow-todo list --all [--status active|completed|cancelled|all] [--assignee <uuid>] [--definition quick|agent] [--json]
    → List domain-level instances (requires domain-level authorization)

workflow-todo detail --instance-id <uuid> [--json]
    → Show full task detail with available transitions

workflow-todo advance --instance-id <uuid> --summary <text> [--idempotency-key <key>] [--json]
    → Advance the workflow to the next node
```

## Permission Requirements

| Scope | Operations |
|---|---|
| `workflow.read` | `my-worklist`, `detail`, `list --all` (read-only) |
| `workflow.execute` | `create-quick`, `create-agent`, `advance` |
| `workflow.admin` | `npm run provision` (definition + domain role bindings) |

`list --all` additionally requires domain-level authorization (e.g. DOMAIN_OWNER
or DOMAIN_MEMBER role) as enforced by svc-workflow.

## Idempotency

Each `create-quick`, `create-agent`, and `advance` command automatically
generates a unique idempotency key using a timestamp and random suffix.

To safely retry a command across process restarts, pass an explicit key:

```bash
workflow-todo create-quick --title "My Task" --idempotency-key my-unique-key-001
workflow-todo advance --instance-id <uuid> --summary done --idempotency-key my-retry-key
```

When provided, the key is used verbatim — the CLI does not prefix or modify it.
When the flag is absent, a new random key is generated each invocation, meaning
re-running without `--idempotency-key` creates a new intent (not a retry).

## Workflow Definitions

Definition JSON files are located in the `definitions/` directory:

- `definitions/personal-quick-item-v1.json` — Simple open → completed/cancelled workflow
- `definitions/agent-self-task-v1.json` — Multi-stage task with efficiency and partner reviews

These definitions are provisioned into svc-workflow via `npm run provision`.
Provisioning is a **management action** that requires a Machine Client with
`workflow.admin` scope — it is not part of the daily runtime path.

## Migration Archive

The `migration/legacy-llm-todo-v1/` directory contains historical audit reports
and one-time migration tooling from the legacy LLM Todo system. These files are
**historical evidence** and are not part of the current runtime documentation.
