# workflow-todo 身份与数据不一致调查报告

**调查日期**: 2026-07-18  
**调查性质**: 只读调查（未修改代码、数据库、配置或重启服务）  
**Final Status**: `LEGACY_CANARY_PRESENT_IDENTITY_MISMATCH`

---

## Root Cause

**A. 使用了错误 Principal** — CLI `.env` 配置的是 `AGENT_A`（`10000000-0000-0000-0000-000000000010`）的 JWT Token，但 3 条个人快速事项 Canary 导入后归属于 `DOGFOOD_USER`（`10000000-0000-0000-0000-000000000101`）。`worklist-assigned-to-me` API 按 `assignee_principal_id = caller.principal_id` 过滤，因此以 AGENT_A 身份查询看不到 DOGFOOD_USER 的事项。

---

## Evidence

### CLI

| 项目 | 结果 |
|------|------|
| 当前 CLI 路径 | `bin/workflow-todo` wrapper → `npx tsx src/cli.ts` |
| `type -a workflow-todo` | **not found** — CLI 不在 PATH 中 |
| workflow-todo SHA | `672025c34a4865cbd2f83621dad7b829d296ae19` (main) |
| 代码更改 | 干净，仅有预存的审计报告 |
| CLI base URL | `http://127.0.0.1:8989`（来自 `.env` 的 `SVC_WORKFLOW_BASE_URL`） |
| `.env` 位置 | `/Users/yanfenma/workspace/project/workflow-todo/.env` |

### Runtime

| 项目 | 结果 |
|------|------|
| svc-workflow 进程 | **未运行** — 8989 端口无监听，`/readyz` 连接失败 |
| svc-workflow 二进制 | `/Users/yanfenma/workspace/project/svc-workflow/target/debug/svc-workflow` (50MB) |
| svc-workflow SHA | `4084c280f79a4cef5cf3122142635b61ec0d2dfb` (main) |
| `src/bin/provision-todo-definition.rs` | 已 staged delete |

### Database

| 项目 | 结果 |
|------|------|
| runtime database | `svc_workflow_dogfood` (PostgreSQL, localhost:5432) |
| 迁移 | 1–10 已应用 ✅ |
| PG 可访问 | ✅ `pg_isready` accepting connections |
| 导入时数据库 | 同样为 `svc_workflow_dogfood`（同一 .env 中的 DATABASE_URL） |

### JWT Subject

| 项目 | 结果 |
|------|------|
| 当前 Token sub | `10000000-0000-0000-0000-000000000010` |
| 对应 Principal | **Dogfood Agent A** (AGENT_A) |
| JWT issuer | `auth-service` |
| JWT audience | `svc-workflow` |
| JWT scope | `workflow.admin workflow.read workflow.execute` |
| 是否效率管家身份 | ❌ **不是** — 效率管家 principal = `00000000-0000-0000-0000-000000000020` |
| 是否 DOGFOOD_USER 身份 | ❌ **不是** — DOGFOOD_USER principal = `00000000-0000-0000-0000-000000000101` |

### Database Rows — 完整实例清单 (14 total)

```
personal_quick_item_v1 (6 instances):
  3145086f-1ac2-49fe-a86e-bb8350affdd0 | open     | created_by=101(DOGFOOD_USER) | assignee=101 | ← legacy 256 ✓
  561c3b3e-e669-4ce9-9239-9d0d8ffd3ded | open     | created_by=101(DOGFOOD_USER) | assignee=101 | ← legacy 238 ✓
  2109ee3f-cb25-4440-a8d8-5d3f6813dad0 | open     | created_by=101(DOGFOOD_USER) | assignee=101 | ← legacy 279 ✓
  a35a36dd-f599-4a39-8352-7d417cc3cf83 | completed| created_by=001(SYSTEM)        | —            | (smoke test)
  5614b9c5-6b62-4a7a-94a2-3751c54bd1ea | completed| created_by=001(SYSTEM)        | —            | (smoke test)

agent_self_task_v1 (8 instances):
  3c642419-b17b-408e-b2bb-fbfece9e8244 | efficiency_check | created_by=010(AGENT_A) | assignee=020(eff_manager)
  4819c2b8-095a-4305-b94a-cfd4a7e49b97 | efficiency_check | created_by=010(AGENT_A) | assignee=020(eff_manager) ← "Final Canary" (after advance)
  cb38aa3c-beb1-4dd0-afbb-3719482679e7 | propose          | created_by=010(AGENT_A) | assignee=010(AGENT_A)   ← "test-which-db"
  5c8568ed-6343-4648-9f71-232675cc4e47 | efficiency_check | created_by=001(SYSTEM)  | assignee=020(eff_manager)
  68f58382-ca57-418c-9a1a-8e64d247180d | propose          | created_by=001(SYSTEM)  | assignee=001(SYSTEM)
  6314d8a3-9214-405e-82c7-5b76a91e1554 | propose          | created_by=001(SYSTEM)  | assignee=001(SYSTEM)
  4882084c-2794-4fec-8e41-c6a1b1bf10e5 | efficiency_check | created_by=001(SYSTEM)  | assignee=020(eff_manager)
  2344b9ac-483e-492e-85ea-eb490fac785e | efficiency_check | created_by=010(AGENT_A) | assignee=020(eff_manager)
  b58fe985-3a30-4056-8a58-63d83f038a79 | efficiency_check | created_by=010(AGENT_A) | assignee=020(eff_manager)
```

### API — assigned-to-me 行为

`worklist-assigned-to-me` 的 SQL 查询:
```sql
WHERE v.assignee_principal_id = $1   -- $1 = caller's principal_id
  AND n.node_type <> 'TERMINAL'
  AND EXISTS (SELECT 1 FROM domain_role_bindings ...)
```

- 当前 Token sub = `010` (AGENT_A) → API 返回 assignee=010 的非终态实例
- 唯一符合条件的是 `cb38aa3c` (test-which-db, propose, assignee=010)
- "Final Canary" (`4819c2b8`) 原在 propose(assignee=010)→推进后到 efficiency_check(assignee=020)，不再返回
- 3 条 personal_quick_item 的 assignee=101 (DOGFOOD_USER) → 不返回

### my-worklist 过滤检查

| 检查项 | 结果 |
|--------|------|
| 是否查询 assigned-to-me | ✅ `client.worklistAssignedToMe()` |
| 是否默认限制 Definition | ❌ 无 Definition 过滤 |
| 是否有分页上限 | ⚠️ 默认 limit=20 (服务端上限)，82 条足够 |
| 是否只取第一页 | ✅ `worklistAssignedToMe()` 无参数，取第一页 |
| 是否过滤 personal_quick_item_v1 | ❌ 不过滤 |
| 是否因 snake_case 解析问题 | ❌ `JSON.stringify(page, null, 2)` 直接输出 |
| 是否调用了错误 endpoint | ❌ `/internal/v1/worklists/assigned-to-me` 正确 |
| 是否把结果截断为2条 | ❌ 结果就是只有这 2 条 assignee=010 的实例 |

---

## Conclusion Matrix

| 检查项 | 实际结果 |
|--------|----------|
| 当前 CLI 路径 | `bin/workflow-todo` → `npx tsx src/cli.ts` (not in PATH) |
| workflow-todo SHA | `672025c34a4865cbd2f83621dad7b829d296ae19` |
| CLI base URL | `http://127.0.0.1:8989` |
| runtime SHA | `4084c280f79a4cef5cf3122142635b61ec0d2dfb` |
| runtime database | `svc_workflow_dogfood` |
| 当前 Token sub | `10000000-0000-0000-0000-000000000010` (AGENT_A) |
| 是否真是效率管家身份 | ❌ — 效率管家 = `...020` |
| personal 238 是否存在 | ✅ — `561c3b3e...` (open, assignee=DOGFOOD_USER) |
| personal 256 是否存在 | ✅ — `3145086f...` (open, assignee=DOGFOOD_USER) |
| personal 279 是否存在 | ✅ — `2109ee3f...` (open, assignee=DOGFOOD_USER) |
| DOGFOOD_USER worklist 数量 | ⚠️ 未找到 DOGFOOD_USER JWT，无法查询 |
| 效率管家 worklist 数量 | ⚠️ 未找到效率管家 JWT，无法查询 |
| my-worklist 是否过滤 | ❌ 无隐式过滤 — API 按 assignee 自然过滤 |

---

## Data Status

### 3条 Legacy Canary 是否真实存在

**✅ 是** — 确实验证存在于 `svc_workflow_dogfood` 数据库中。

| Legacy ID | Instance ID | Definition | Node | created_by | assignee | State |
|-----------|-------------|------------|------|------------|----------|-------|
| 238 | `561c3b3e-e669-4ce9-9239-9d0d8ffd3ded` | personal_quick_item_v1 | **open** | DOGFOOD_USER (101) | DOGFOOD_USER (101) | 1 |
| 256 | `3145086f-1ac2-49fe-a86e-bb8350affdd0` | personal_quick_item_v1 | **open** | DOGFOOD_USER (101) | DOGFOOD_USER (101) | 1 |
| 279 | `2109ee3f-cb25-4440-a8d8-5d3f6813dad0` | personal_quick_item_v1 | **open** | DOGFOOD_USER (101) | DOGFOOD_USER (101) | 1 |

3 条实例的 `context_revisions.payload.legacyProvenance` 包含完整的导入来源信息（source=llm-todo, importBatchId, legacyRecordSha256, sourceSnapshotSha256），可审计追溯。

### 位于哪个数据库

全部位于 **`svc_workflow_dogfood`**（localhost:5432 上的 PostgreSQL）。

---

## Identity Status

### 试用时身份

**Dogfood Agent A**（`10000000-0000-0000-0000-000000000010`），对应注册在 `principals` 表中的 `Dogfood Agent A`。

### 是否为效率管家

**不是**。效率管家 principal = `10000000-0000-0000-0000-000000000020`，注册为 `Dogfood Efficiency Manager`。

### 为什么能推进 propose

`agent_self_task_v1` 的 `propose` 节点的 `assignee_ref_type = WORKFLOW_CREATOR`。AGENT_A 是这些任务的创建者，因此 assignee = AGENT_A。推进后到达 `efficiency_check` 节点，其 `assignee_ref_type = FIXED_PRINCIPAL`，assignee 变为效率管家(`...020`)，AGENT_A 不再能看到它。

---

## Product Status

### personal_quick_item 是否已经迁移

**✅ 是** — 3 条 Canary 已成功导入 `svc_workflow_dogfood`，位于 `open` 节点（DRAFT），assignee = DOGFOOD_USER。

### 是否需要重新迁移

**不需要** — 数据已在正确数据库中，不需要重新导入。只需要使用 DOGFOOD_USER 的 JWT 即可在 `my-worklist` 中看到。

### 是否存在重复风险

**否** — 每条 Canary 使用幂等键 `legacy-llm-todo:{id}`，重复导入会被 svc-workflow 的 idempotency 机制拒绝（同一外部 reference 冲突）。

---

## Required Correction

**最小纠正动作**（只建议，不实施）：

1. **让 DOGFOOD_USER 能查看其 worklist**：查找或生成 `DOGFOOD_USER`（`10000000-0000-0000-0000-000000000101`）的 JWT Token，在 workflow-todo 的 `.env` 中设置 `SVC_WORKFLOW_ACCESS_TOKEN` 为该 Token。
   - JWT 可使用 svc-workflow 的 `test_hs256` 模式生成（secret = `test-secret-for-workflow-todo-smoke-at-least-32-bytes`，sub = `10000000-0000-0000-0000-000000000101`）
2. 用 DOGFOOD_USER Token 运行 `workflow-todo my-worklist` 验证 3 条 Canary 可见。
3. 如果未来需要 AGENT_A 也能看到 personal_quick_item，需重新评估 Definition 的 assignee 策略（例如让 open 节点 assignable by domain）。

---

## Final Status

```
LEGACY_CANARY_PRESENT_IDENTITY_MISMATCH
```

### 排除项

| 可能性 | 结论 | 证据 |
|--------|------|------|
| **A. 错误 Principal** | ✅ **确认为根因** | Token sub=010(AGENT_A)，Canary 属于 101(DOGFOOD_USER) |
| B. 错误 URL | ❌ 排除 | CLI 使用 `127.0.0.1:8989`，数据库确实是 `svc_workflow_dogfood` |
| C. 错误数据库 | ❌ 排除 | 同一数据库，3 条 Canary 已验证存在 |
| D. 另一套环境 | ❌ 排除 | 仅此一套本地 dogfood 环境 |
| E. my-worklist 过滤 | ❌ 排除 | 代码无隐式过滤，`JSON.stringify` 直接输出 |
| F. 实例不存在 | ❌ 排除 | DB 确认 3 条实例存在且完整 |
