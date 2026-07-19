# Canary Evidence — Auth V1 Read-Only Consumer

> Status: **BLOCKED_BY_AUTH_MACHINE_TOKEN_PROVIDER_DISTRIBUTION**
>
> `src/auth-token-provider.ts` is a self-implementation of Auth Service's
> Client Credentials Token Provider, which crosses the auth-service
> authority boundary. Waiting for an official, versioned, digest-pinned
> Auth Client / Machine Token Provider package from `auth-service`.

## Blocking Gate

```text
WORKFLOW_TODO_SDK_AUTH_READONLY_CONSUMER=
BLOCKED_BY_AUTH_MACHINE_TOKEN_PROVIDER_DISTRIBUTION
```

Until `auth-service` provides an official Auth Client package with
pinned version, source SHA, tree SHA, and package digest:

- ❌ No real Auth E2E
- ❌ No independent audit
- ❌ No merge or deploy
- ❌ No `sdk_auth_v1` flag enablement
- ❌ No extension of local Token Provider
- ❌ No copy to ADC, OKR, or other consumers

## Required Upstream Deliverable

```text
Official Auth Client package (e.g. @auth-service/machine-token-provider)
with:
  - Pinned version
  - Source repo SHA
  - Source tree SHA
  - Package digest
  - Stable MachineTokenProvider interface
```

## Replacement Plan (when official package arrives)

1. Pin official Auth Client package (version, SHA, tree, digest)
2. Delete `src/auth-token-provider.ts`
3. Delete Todo-level auth protocol tests
4. Inject official MachineTokenProvider into Workflow SDK
5. Todo retains only: config wiring, read-path selection, SDK→ViewModel
   mapping, and display
6. `WORKFLOW_TODO_READ_PATH=legacy` stays default
7. `sdk_auth_v1` remains fail-closed (no static token fallback)
8. Re-run typecheck, all tests, diff --check
9. Re-pin FINAL_HEAD, FINAL_TREE, push remote

After replacement, restore:

```text
WORKFLOW_TODO_SDK_AUTH_READONLY_CONSUMER_READY_FOR_AUTH_E2E
```

## Upstream Canary Gates (for after replacement)

```text
SVC_WORKFLOW_AUTH_ADAPTER_INDEPENDENT_AUDIT_PASS=true
READY_FOR_AUTH_E2E=true
SVC_WORKFLOW_AUTH_V1_READONLY_CANARY_LIVE_PASS
FINAL_SVC_WORKFLOW_HEAD=
FINAL_SVC_WORKFLOW_TREE=
```

## Canary Agent Identity (for after replacement)

```text
CANARY_AGENT_NAME=
CANARY_AGENT_AUTH_SUB=
CANARY_AGENT_WORKFLOW_PRINCIPAL_ID=
CANARY_AGENT_MACHINE_CLIENT_ID=
```

**Constraint:** `CANARY_AGENT_AUTH_SUB == CANARY_AGENT_WORKFLOW_PRINCIPAL_ID`
(or documented stable mapping maintained by svc-workflow)

## Task Isolation Evidence (for after replacement)

| Task | currentAssignee | Expected in assigned-to-me |
|------|----------------|---------------------------|
| Task A | Canary Agent Principal | ✅ Yes |
| Task B | Other Agent Principal | ❌ No |

## Proof Requirements (for after replacement)

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
- `client_id`, `azp`, Agent display name, email, and product roles must NOT
  be used as Workflow Principal.
- Workflow SDK fixed distribution: see `references/SDK_DISTRIBUTION.md`.
- Current remote branch preserved as-is — no history rewrite.
