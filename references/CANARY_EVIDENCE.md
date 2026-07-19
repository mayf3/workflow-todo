# Canary Evidence — Auth V1 Read-Only Consumer

> Status: **BLOCKED_BY_SVC_WORKFLOW_AUTH_CANARY_LIVE_GATE**
>
> Code and local tests are complete. Real E2E requires upstream
> gates to pass first.

## Required Gates

```text
SVC_WORKFLOW_AUTH_ADAPTER_INDEPENDENT_AUDIT_PASS=true
READY_FOR_AUTH_E2E=true
SVC_WORKFLOW_AUTH_V1_READONLY_CANARY_LIVE_PASS
FINAL_SVC_WORKFLOW_HEAD=
FINAL_SVC_WORKFLOW_TREE=
```

## Canary Agent Identity

```text
CANARY_AGENT_NAME=
CANARY_AGENT_AUTH_SUB=
CANARY_AGENT_WORKFLOW_PRINCIPAL_ID=
CANARY_AGENT_MACHINE_CLIENT_ID=
```

**Constraint:** `CANARY_AGENT_AUTH_SUB == CANARY_AGENT_WORKFLOW_PRINCIPAL_ID`
(or documented stable mapping maintained by svc-workflow)

## Task Isolation Evidence

| Task | currentAssignee | Expected in assigned-to-me |
|------|----------------|---------------------------|
| Task A | Canary Agent Principal | ✅ Yes |
| Task B | Other Agent Principal | ❌ No |

## Proof Requirements

```text
auth-service deployed SHA =
svc-workflow deployed SHA =
workflow-todo candidate SHA =
Workflow SDK pinned version + digest =
Token claims summary (NOT full token):
Request ID (canary request):
Request ID (other agent request):
Task A visible count:
Task B visible count:
Todo cannot override principalId:
Todo cannot override assigneeId:
```

## Notes

- Returning an empty array does NOT constitute proof of identity isolation.
- `client_id`, `azp`, Agent display name, email, and product roles must NOT be used as Workflow Principal.
- Workflow SDK fixed distribution: see `references/SDK_DISTRIBUTION.md`.
