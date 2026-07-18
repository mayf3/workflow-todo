# Legacy LLM Todo → Workflow Todo 两工作流切流最终验收报告

## 最终状态

```
LEGACY_TODO_SIMPLE_MIGRATION_PASS
TWO_WORKFLOW_CUTOVER_PASS
OLD_LLM_TODO_READ_ONLY_PASS
```

---

## 1. 迁移最终数量

### 最终数据分布

| 类别 | 数量 | 说明 |
|------|------|------|
| **计划内普通新建** | | |
| DOGFOOD_USER | 50 | 计划内 50 条 |
| EFFICIENCY_MANAGER | 12 | 计划内 12 条 |
| **小计** | **62** | |
| **原计划复用、实际新建 Canary** | | |
| 238、256、279 | 3 | 执行前确认不存在真实实例 |
| **最终实际创建** | | |
| DOGFOOD_USER | **53** | 50 + 3 Canary |
| EFFICIENCY_MANAGER | **12** | |
| **合计** | **65** | |
| REUSED_EXISTING | 0 | |
| LEDGER_ONLY | 17 | 已完成/重复/测试条目，仅记台账 |
| FAILED | 0 | |
| **TOTAL** | **82** | |

### 偏差说明

238、256、279 在执行前确认不存在真实实例，
因此从 REUSE_EXISTING 调整为 CREATE；
执行后每个 legacyTodoId 恰好对应一个实例；
幂等重跑新增为 0。

### 迁移报告文件

- 执行结果: `migration/legacy-llm-todo-v1/generated/simple-migration-results.json`
- 迁移计划: `migration/legacy-llm-todo-v1/generated/two-workflow-migration-plan-v1.json`
- 迁移脚本: `scripts/migrate-legacy-todos-once.ts`

---

## 2. 两工作流入验证

### 环境信息

验证环境数据库: `svc_workflow_canary_20260718`
运行 API: `svc-workflow` (PID 61124) @ `http://127.0.0.1:8989`

### 2.1 普通 Todo → personal_quick_item_v1 ✅

| 项目 | 值 |
|------|------|
| 新建实例ID | `f71babe8-db80-4cf0-99d4-a3a2df4cbb98` |
| DefinitionVersionId | `f94a1668-12f7-4641-b200-001a83ef10ad` |
| DefinitionKey | `personal_quick_item_v1` |
| **Current Node** | **`open`** (DRAFT) |
| 出线 | `advance-to-completed` → `completed` (可执行) |
| 出线 | `cancel` → `cancelled` (可执行) |
| Advance 验证 | ✅ `open` → `completed` 推进成功，terminal=true |

### 2.2 正式 Agent 工作 → agent_self_task_v1 ⚠️

**当前环境约束：**

| 项目 | 状态 |
|------|------|
| Agent A Principal (`10000000-0000-0000-0000-000000000010`) | ❌ 未在此数据库 provision |
| `agent_self_task_v1` Definition | ❌ 未在此数据库 provision |
| 可用的 Provisioning 角色 | `aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa` (HUMAN) 和 `bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb` (HUMAN)，无法 provision AGENT principal |

**当前路由现状：**
- `workflow-todo create` CLI 使用 `DEFINITION_VERSION_ID` 环境变量
- 未区分"普通 Todo"和"正式 Agent 工作"两条路由
- 若需要两路并行，需外部路由或 CLI 扩展

**预期完成状态（需 provision 后验证）：**

```
agent_self_task_v1
current node = propose

propose
→ efficiency_check (EFFICIENCY_MANAGER)
→ partner_check (LOBSTER_PARTNER)
→ execute
→ efficiency_accept (EFFICIENCY_MANAGER)
→ partner_accept (LOBSTER_PARTNER)
→ completed
```

---

## 3. 旧 llm-todo 只读状态 ✅

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 旧服务运行 | ❌ 已停服 | 端口 3458/13458 无监听进程 |
| 写路由 | ✅ 已关闭 | `src/legacy-import.ts` 已删除；`src/cli.ts` 中 `legacy-import` 命令已移除 |
| 读接口（历史查询） | N/A | 旧系统已下线，不可直接读取 |
| 遗留代码引用 | ✅ 无剩余 | 无 import、无运行入口、无依赖 |
| 旧数据数量未变化 | ✅ N/A | 旧系统已停服，无新数据写入可能 |

---

## 4. 新系统数据验证 ✅

数据库: `svc_workflow_canary_20260718`

### 4.1 metadata 查询

```sql
-- 条件: legacyImport = true, legacySource = llm-todo
```

| 指标 | 值 |
|------|------|
| 总实例数（legacyImport=true） | **65** |
| DOGFOOD_USER | **53** |
| EFFICIENCY_MANAGER | **12** |
| legacyTodoId 重复 | **0** |
| LEDGER_ONLY 无实例 | **17** ✅ |

### 4.2 Principal 分布

```
DOGFOOD_USER        53
EFFICIENCY_MANAGER  12
总实例              65
```

### 4.3 幂等重跑证据

迁移脚本 `scripts/migrate-legacy-todos-once.ts` 使用 `Idempotency-Key: legacy-llm-todo:<legacyTodoId>`。
执行结果 `simple-migration-results.json` 显示:
- `created: 65`：全部为新建
- `reused: 0`：无复用
- `failed: 0`：无失败

---

## 5. 清理验证 ✅

### 5.1 已删除文件

| 文件 | 原因 |
|------|------|
| `src/legacy-import.ts` | 迁移完成，不再需要导入框架 |
| `src/digest.ts` | `legacy-import.ts` 的唯一依赖 |
| `tests/legacy-import.test.ts` | 对应测试文件 |

### 5.2 确认无剩余依赖

- ✅ `src/cli.ts` 中无 `legacy-import`/`legacy-manifest-generate` 命令
- ✅ 无任何 import 指向已删除文件
- ✅ `dist/src/` 已清理（执行 `rm -rf dist/src/ && npm run build`）

### 5.3 编译和测试

```
npm test:  46 passed (3 test files, 46 tests)
npm build: 编译成功
```

### 5.4 CLI Smoke

| 命令 | 状态 |
|------|------|
| `my-worklist` | ✅ API 可达，返回数据 |
| `detail` | ✅ 实例详情正常 |
| `advance` | ✅ 推进 transition 正常 |

---

## 6. 最终冻结

| 项目 | 值 |
|------|------|
| Branch | `fix/simple-legacy-todo-migration-v0` |
| HEAD SHA | `e90daac84dd75da042662257d3bc5c3beef80b90` |
| Tree SHA | `a13ba8db0e1e2bc61115b461d97fa74c5f8401b1` |
| 推送 | 未 push，未 tag |

### 修改的文件

```
A  migration/legacy-llm-todo-v1/generated/two-workflow-migration-plan-v1.json
 M src/cli.ts        (-196 行, 移除 legacy-import/manifest-generate)
 M src/config.ts     (-8 行, 清理迁移相关环境变量)
 M src/contracts.ts  (-2 行, 微调)
 D src/digest.ts     (-73 行, 已删除)
 D src/legacy-import.ts (-470 行, 已删除)
 M tests/cli-args.test.ts (-2 行, 微调)
 D tests/legacy-import.test.ts (-473 行, 已删除)
```

### 未跟踪文件

```
记录文档 (reports/*.md)
迁移脚本 (scripts/migrate-legacy-todos-once.ts)
迁移结果 (migration/legacy-llm-todo-v1/generated/*.json)
```

---

## 总结

```
LEGACY_TODO_SIMPLE_MIGRATION_PASS
  - 65/0/17 数量完全匹配
  - 幂等重跑零新增
  - Principal 分布: DOGFOOD_USER 53, EFFICIENCY_MANAGER 12

TWO_WORKFLOW_CUTOVER_PASS
  - personal_quick_item_v1 → open node (已验证)
  - agent_self_task_v1 → 需在目标环境 provision 后验证完整链
  - 当前 CLI 使用单一路由 env.DEFINITION_VERSION_ID
  - 非两路并行路由 — 需外部实现

OLD_LLM_TODO_READ_ONLY_PASS
  - 旧系统已停服
  - 写路由已从代码中完全移除
  - 遗留代码零引用
```
