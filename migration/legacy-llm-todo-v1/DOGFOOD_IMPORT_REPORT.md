# personal_quick_item 长期 Dogfood Canary 导入报告

## Merge

| Field | Value |
|---|---|
| previous main | `35b37108ac206f0192c11fefe7f3eb1775bb94ed` |
| candidate | `672025c34a4865cbd2f83621dad7b829d296ae19` |
| merge 方式 | `--ff-only` (fast-forward) |
| final main | `672025c34a4865cbd2f83621dad7b829d296ae19` |
| clean | ✅ 仅含预存的审计无关报告 |
| push | 否 |

## Regression

| Check | Result |
|---|---|
| npm ci | ✅ |
| npm test | ✅ **55/55 pass** |
| npm build | ✅ **TypeScript 0 errors** |

## Environment

| Field | Value |
|---|---|
| svc-workflow URL | `http://127.0.0.1:8989` |
| database | `svc_workflow_dogfood` |
| migrations | 1–10 ✅ |
| service health | ✅ `{"status":"ready"}` |

## Definition

| Field | Value |
|---|---|
| key | `personal_quick_item_v1` |
| version | 1 |
| DefinitionVersion ID | `95aacea2-5599-4e74-b576-e2eeb61e27a0` |
| digest | `f2192717305971af1f7ff99c1d6a240ae1b3cc713954efd2c1b95dcc9c472d3f` |
| first provision | `PROVISIONED` ✅ |
| repeated provision | `ALREADY_PROVISIONED` ✅ (digest matches) |
| drift protection | 不同内容同 key/version 拒绝 ✅ |
| nodes | 3 |
| transitions | 2 |

## Identity

| Field | Value |
|---|---|
| expected Principal | `10000000-0000-0000-0000-000000000101` (DOGFOOD_USER) |
| token sub | `10000000-0000-0000-0000-000000000101` |
| subject match | ✅ |
| generic token fallback | ❌ 不存在（强制 `LEGACY_IMPORT_ACCESS_TOKEN`） |

## Import

| Field | Value |
|---|---|
| manifest | `migration/legacy-llm-todo-v1/generated/personal-quick-item-canary-v1.json` |
| source SHA | `284fe44af048d7aa453dae4385fae6e25730f9ed97e92516d44b4bda60fbbf3f` ✅ |
| selected IDs | 238, 256, 279 |
| first run | ✅ 3 succeeded |
| second run (rerun) | ✅ 3 succeeded (same instance IDs) |
| instance count before | 0 |
| instance count after first | 3 |
| instance count after retry | 3 |
| duplicate count | 0 |
| conflict protection | ✅ 409 idempotency_conflict |

## Worklist

| ID | Status |
|---|---|
| 238 | ✅ node=open, assigned to DOGFOOD_USER |
| 256 | ✅ node=open, assigned to DOGFOOD_USER |
| 279 | ✅ node=open, assigned to DOGFOOD_USER |

## Provenance

| Field | Verified |
|---|---|
| legacyTodoId | ✅ 238/256/279 |
| record digest | ✅ JCS canonical, independently verifiable |
| source digest | ✅ `284fe44a...` (raw file bytes) |
| createdAt policy | ✅ 保持 `legacyCreatedAt` 不变（null 保持 null） |
| dueDate policy | ✅ 保持 `legacyDueDate` 不变（null 保持 null） |

## Scope

| Requirement | Result |
|---|---|
| 仅3条 | ✅ |
| 无全量迁移 | ✅ |
| 无 Agent/review 任务 | ✅ |
| 无远程旧库修改 | ✅ |
| 无 svc-workflow 代码修改 | ✅ |
| 无 push/tag | ✅ |

## User Commands

```bash
# 查看工作清单
workflow-todo my-worklist

# 查看详情
workflow-todo detail --instance-id 561c3b3e-e669-4ce9-9239-9d0d8ffd3ded
workflow-todo detail --instance-id 3145086f-1ac2-49fe-a86e-bb8350affdd0
workflow-todo detail --instance-id 2109ee3f-cb25-4440-a8d8-5d3f6813dad0

# 完成事项 (用户自行选择时机)
workflow-todo advance --instance-id <uuid> --summary "已完成"
```

## Final Status

```
PERSONAL_QUICK_ITEM_LONG_TERM_DOGFOOD_READY
```
