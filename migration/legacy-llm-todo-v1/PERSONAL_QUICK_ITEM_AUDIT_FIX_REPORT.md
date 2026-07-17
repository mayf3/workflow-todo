# personal_quick_item Legacy Canary 审计发现修复报告

## Git

| Field | Value |
|---|---|
| base | `35b37108ac206f0192c11fefe7f3eb1775bb94ed` |
| branch | `feat/personal-quick-item-legacy-canary-v0` |
| push | 未推送 |
| tag | 未tag |

## Digests

| Field | Value |
|---|---|
| source algorithm | `sha256-file-bytes-v1` (原始文件字节) |
| source expected (前缀) | `284fe4...` |
| source actual | `284fe44af048d7aa453dae4385fae6e25730f9ed97e92516d44b4bda60fbbf3f` |
| record algorithm | `sha256-rfc8785-jcs-full-record-v1` (JCS canonicalization) |
| ID 238 | `8b0aebe8ec22a5257ef16b14ed0dfd2c9767837ff2a3f5eeed2772bbabe6ef08` |
| ID 256 | `53a5e36280dfdcbc395171ef0f9872f8d560f42cb7687286594f0bfb268956c2` |
| ID 279 | `ec1a807c76d7bce62a3cdd95cac801b206bec1cb74676920a50f63118d32f056` |
| deterministic regeneration | ✅ 工具 `legacy-manifest-generate` 生成，byte-for-byte 可复现 |

## Definition Validation

| Field | Value |
|---|---|
| read API | `GET /internal/v1/admin/definition-versions/{id}` (provisioning endpoint) |
| key | `personal_quick_item_v1` ✅ |
| version | 1 ✅ |
| published | `PUBLISHED` ✅ |
| wrong Definition test | ✅ manifest validation rejects `agent_self_task_v1` |

## Identity

| Field | Value |
|---|---|
| legacy token required | ✅ `LEGACY_IMPORT_ACCESS_TOKEN` 强制 |
| generic token fallback | ❌ 已删除回退逻辑 |
| expected Principal | `00000000-0000-0000-0000-000000000101` (DOGFOOD_USER) |
| token sub | 导入前核对 `LEGACY_IMPORT_EXPECTED_PRINCIPAL_ID` |
| wrong token test | ✅ `TOKEN_SUBJECT_MISMATCH` |0 HTTP 写入 |

## Import Reporting

| Field | Value |
|---|---|
| first import status | `succeeded` |
| replay status | `succeeded` (中性，服务器不区分) |
| misleading counters removed | ✅ `replayed` 统计已删除，统一用 `succeeded` |
| sameInstanceAsPrevious | 服务器不提供此信号，返回 undefined |

## Dynamic Canary (svc_workflow_legacy_todo_canary_v2)

| Step | 操作 | 结果 |
|------|------|------|
| 1 | migrations 1‑10 | ✅ |
| 2 | provision `personal_quick_item_v1 v1` | ✅ PUBLISHED |
| 3 | 运行 Manifest 生成命令 | ✅ |
| 4 | source digest 验证 | ✅ `284fe44a...` |
| 5 | 导入3条 | ✅ 3 succeeded |
| 6 | assigned-to-me 有3条 open | ✅ |
| 7 | 重跑相同 Manifest | ✅ 同一 instance ID 返回 |
| 8 | WorkflowInstance 数量不增加 | ✅ 仍为3 |
| 9 | 修改同一 legacy ID 的 payload | ✅ 409 idempotency_conflict |
| 10 | 明确冲突且数量不增加 | ✅ 仍为3 |
| 11 | 使用错误 token (sub 不匹配) | ✅ TOKEN_SUBJECT_MISMATCH |
| 12 | 导入前失败且数量不增加 | ✅ 仍为3 |
| 13 | 完成其中1条 (256) | ✅ stateVersion=2 |
| 14 | 剩余2条 open (238, 279) | ✅ |

Instance IDs (脱敏): `f77890e5...` (256), `1649e3f7...` (238), `37ec2076...` (279)

## Tests

| Metric | Value |
|---|---|
| total | **55** |
| passed | **55** |
| failed | **0** |
| build | **TypeScript 0 errors** |
| `.skip` / `.only` | 无 |
| `@ts-ignore` / `@ts-nocheck` | 无 |
| 新增宽泛 `any` | 无（仅测试文件 `validManifest()` helper 用 `any`） |

### 负向测试覆盖矩阵

| # | 场景 | 覆盖 |
|---|------|------|
| 1 | 原始文件摘要可独立重算 | ✅ `sha256FileBytes` 测试 |
| 2 | 修改原始文件一个字节后失败 | ✅ |
| 3 | 三条记录摘要与完整原始记录匹配 (JCS) | ✅ |
| 4 | 修改记录字段后 digest mismatch | ✅ |
| 5 | Manifest 6条时拒绝 | ✅ |
| 6 | 非 `personal_quick_item_v1` 拒绝 | ✅ |
| 7 | DefinitionVersion 指向其他 Definition | ✅ manifest 层面 |
| 8 | DefinitionVersion 非 v1 | ✅ manifest 层面 |
| 9 | DefinitionVersion 未发布 | ✅ runtime 验证 |
| 10 | 缺 `LEGACY_IMPORT_ACCESS_TOKEN` | ✅ CLI 检查 |
| 11 | 不得回退 `SVC_WORKFLOW_ACCESS_TOKEN` | ✅ 代码无 fallback |
| 12 | token sub 不匹配 | ✅ `TOKEN_SUBJECT_MISMATCH` |
| 13 | Manifest 含 Secret 被拒绝 | ✅ JWT/Bearer/DB URL 扫描 |
| 14 | 同 ID 同 payload 重跑不重复创建 | ✅ idempotency |
| 15 | 同 ID 不同 payload 明确冲突 | ✅ 409 |
| 16 | replay/succeeded 报告语义真实 | ✅ 中性 `succeeded` |
| 17 | 原始 private 数据不被 Git 跟踪 | ✅ `.gitignore` |
| 18 | `agent_self_task_v1` 回归通过 | ✅ 6 client tests pass |

## Scope

| 要求 | 状态 |
|------|------|
| 无 svc-workflow 修改 | ✅ |
| 无新 Todo 后端 | ✅ |
| 无 dogfood 主库写入 | ✅ 隔离数据库 `svc_workflow_legacy_todo_canary_v2` |
| 无全量迁移 | ✅ 仅3条 Canary |
| 无 Secret | ✅ Manifest 无 JWT/密码 |
| 无 push | ✅ |

## Final Status

```
PERSONAL_QUICK_ITEM_CANARY_FINDINGS_FIXED_READY_FOR_REAUDIT
```
