# personal_quick_item_v1 Legacy Canary 实施报告

## Git

| Field | Value |
|---|---|
| repo | `/Users/yanfenma/workspace/project/workflow-todo` |
| base | `35b37108ac206f0192c11fefe7f3eb1775bb94ed` (main) |
| branch | `feat/personal-quick-item-legacy-canary-v0` |
| push | 未推送 |

## Definition

| Field | Value |
|---|---|
| key | `personal_quick_item_v1` |
| version | 1 |
| nodes | 3 (`open` DRAFT, `completed` TERMINAL, `cancelled` TERMINAL) |
| transitions | 2 (`open→completed` ADVANCE, `open→cancelled` TERMINATE) |
| creator assignment | `open` node uses `WORKFLOW_CREATOR` |
| context schema | `title` (required), `description`, `priority`, `legacyProvenance` |

## Selected Records

| # | legacy ID | 标题（脱敏） | remote status | type | priority | assignee | 选择理由 |
|---|-----------|-------------|--------------|------|----------|----------|---------|
| 1 | 256 | 准备手打柠檬茶材料… | pending | personal | medium | 小马哥 | 明确个人轻量事项，pending，无依赖 |
| 2 | 238 | 把公司报销条例和平台信息发给报销专家 | pending | personal | high | 小马哥 | 明确个人轻量事项，pending，无依赖 |
| 3 | 279 | 整合内容管线… | pending | personal | high | 小马哥 | 明确个人轻量事项，pending，无依赖 |

三条均归属于同一目标用户 Principal (`00000000-0000-0000-0000-000000000101`，DOGFOOD_USER)，
通过 `creator` 字段 uuid `cd921d57-3bc0-4450-a1f4-4044d5c0b894` 追溯确认。

## Manifest

| Field | Value |
|---|---|
| path | `migration/legacy-llm-todo-v1/generated/personal-quick-item-canary-v1.json` |
| item count | 3 |
| source snapshot SHA | `55e6fb60...` |
| contains secrets | 否（已通过 secret scanner 验证） |
| idempotency keys | `legacy-llm-todo:256`, `legacy-llm-todo:238`, `legacy-llm-todo:279` |

## Environment (Canary)

| Field | Value |
|---|---|
| database | `svc_workflow_legacy_todo_canary` |
| migrations | 1–10（全部通过） |
| svc-workflow SHA | `dfe4fc74` (baseline) |
| workflow-todo SHA | `35b3710` (baseline) |
| definition version ID | `158dc08a-0b5a-4706-b750-c09c45440156` |
| svc-workflow endpoint | `http://127.0.0.1:8990` |
| DOGFOOD_USER principal | `00000000-0000-0000-0000-000000000101` |

## Canary Dynamic Test Results

| Step | 操作 | 结果 |
|------|------|------|
| 1 | 创建数据库 `svc_workflow_legacy_todo_canary` | ✅ |
| 2 | 运行 svc-workflow migrations 1–10 | ✅ |
| 3 | 注册 `personal_quick_item_v1` Definition | ✅ `PUBLISHED` |
| 4 | 导入第1条 (ID=256) | ✅ `3edf946b-...` |
| 5 | 导入第2条 (ID=238) | ✅ `51d0152c-...` |
| 6 | 导入第3条 (ID=279) | ✅ `757c2f33-...` |
| 7 | 查询目标用户 assigned-to-me | ✅ 3条全部在 open 节点 |
| 8 | 重跑同一 Manifest | ✅ 实例数量不增加（idempotency 生效） |
| 9 | 将 ID=256 ADVANCE 到 completed | ✅ stateVersion=2 |
| 10 | 检查 completed 项从 assigned-to-me 消失 | ✅ 256 不在列表中 |
| 11 | 其余两条 (238, 279) 仍保留在 open | ✅ |

## Tests

| Metric | Value |
|---|---|
| total | 41 |
| passed | 41 |
| failed | 0 |
| TypeScript build | ✅ clean |

## Scope Compliance

| Requirement | Status |
|---|---|
| 无全量迁移 | ✅ 只导入了3条 Canary |
| 无 dogfood 主库写入 | ✅ 隔离数据库 `svc_workflow_legacy_todo_canary` |
| 无旧库修改 | ✅ 未修改 llm-todo |
| 无 Agent 任务迁移 | ✅ 选的都是 personal 类型 |
| 无 review 任务迁移 | ✅ 全是 pending 状态 |
| 无 Secret | ✅ manifest 无 JWT/密码 |
| 无 push | ✅ 未推送 |

## Final Status

```
PERSONAL_QUICK_ITEM_LEGACY_CANARY_READY_FOR_AUDIT
```
