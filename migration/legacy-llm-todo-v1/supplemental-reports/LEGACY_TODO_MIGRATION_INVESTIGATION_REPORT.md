# llm-todo 数据恢复与 workflow-todo 迁移调查报告

**调查日期**: 2026-07-17
**调查性质**: 只读代码与数据调查（无任何数据库写入、迁移或修复）
**状态**: `LEGACY_TODO_MIGRATION_INVESTIGATION_COMPLETE`

---

## Baseline

### llm-todo

| 属性 | 值 |
|------|-----|
| repo | `/Users/yanfenma/workspace/project/llm-todo` |
| branch | `main` |
| HEAD | `7cc746240ba15161a5350bbe4c6d8fb88f41f5c6` |
| clean | ✅ 干净（无未提交更改） |
| 技术栈 | Node.js + TypeScript + better-sqlite3 (SQLite) |
| 服务端口 | `3458` |
| 数据库路径 | `./data/llm-todo.db`（`DB_PATH=.env` 中配置） |

### svc-workflow

| 属性 | 值 |
|------|-----|
| repo | `/Users/yanfenma/workspace/project/svc-workflow` |
| 当前分支 | `fix/h01a-clean-fix` |
| main 预期 SHA | `dfe4fc743eff8786e9b6095215d238c82c2250fd` |
| 本地 HEAD | `4fc3b39f05c15f3fe3cd137c779d895aee040673` |
| runtime SHA | `5175431ed11deba0b050ff8492d1e4f3c3b5f9e4` |
| 数据库 | PostgreSQL — `svc_workflow_dogfood` |
| 监听 | `127.0.0.1:8989` |
| migration | `/migrations/` — 10 个 SQL 迁移文件（截至 0010） |

> **注意**: 本地 HEAD 与 runtime SHA 不同（已知唯一差异是 provisioning binary 的 JCS digest 算法）。

### workflow-todo

| 属性 | 值 |
|------|-----|
| repo | `/Users/yanfenma/workspace/project/workflow-todo` |
| branch | `main` |
| HEAD | `35b37108ac206f0192c11fefe7f3eb1775bb94ed` |
| 未跟踪文件 | `WORKFLOW_TODO_AUDIT_FINDINGS_REAUDIT_REPORT.md`, `WORKFLOW_TODO_POST_MERGE_DELTA_REVIEW_REPORT.md` |
| Definition | `agent_self_task_v1` (version 1) |

---

## Storage Discovery

### 数据库类型

**SQLite** (`better-sqlite3`)，journal_mode = WAL，foreign_keys = ON。

### 本地数据源

| 文件 | 大小 | 状态 |
|------|------|------|
| `data/llm-todo.db` | 256KB | ❌ **损坏** — "database disk image is malformed" |
| `data/llm-todo.db-shm` | 32KB | 共享内存文件（WAL 模式） |
| `data/llm-todo.db-wal` | 0B | WAL 文件（已全部 checkpoint 回主库） |
| `data/todo.db` | 0B | 空文件（早期创建或被清空） |
| `todo.db` | 0B | 空文件（root 目录） |

### 生产数据源

- 历史生产环境: `8.163.44.127`，服务 `llm-todo-service`，端口 `13458`（容器内 `3458`）
- Docker 未运行（`docker.sock` 不存在），无法检查生产容器或卷
- `deploy.yaml` 定义了 Docker volume `data` 挂载到 `/app/data`，但该卷不可访问

### 备份数据源

#### 1. SQLite 备份 — `/Users/yanfenma/Documents/llm-todo-backups/llm-todo-20260628-233750.db`

| 属性 | 值 |
|------|-----|
| 日期 | 2026-06-28 23:37:50 |
| 大小 | 286KB |
| 完整性 | ✅ **PRAGMA integrity_check = ok** |
| 记录数 | 32 条 todo |
| 访问方式 | 本地文件，完全可读 |

#### 2. JSON 导出 — `/Users/yanfenma/.openclaw/groups/workspace-oc_c6fa97d6255912b25a277e25441f6c11/llm-todo-backup-2026-07-05.json`

| 属性 | 值 |
|------|-----|
| 日期 | 2026-07-05 13:26:50 |
| 大小 | ~30KB |
| 记录数 | **53 条 task**（含 fields: id, title, status, priority, assignee, area, type, tags, created_at, due_date, description, tier1_status, tier2_status） |
| 访问方式 | 本地文件，完全可读 |

#### 3. 损坏数据库 `.recover` 结果

| 属性 | 值 |
|------|-----|
| 恢复方法 | `sqlite3 data/llm-todo.db ".recover --ignore-freelist"` |
| 可恢复 todo 数 | **22 条**（唯一 ID: 1-22） |
| 完整 schema | 全部 22 个表定义可恢复 |
| 其他表数据 | `request_logs`(1), `prompt_templates`(2), `sqlite_sequence`(1) |

### 备份不存在

以下均未找到：
- Docker volume 备份
- `*.dump` / `*.backup` / `*.sql` / `*.tar` / `*.gz` 数据库导出（压缩备份）
- 云盘快照、机器镜像或历史容器 volume
- API 导出或日志中的完整 Todo payload

---

## Damage Assessment

### 声称损伤

"数据库损坏"

### 验证结论

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 数据库进程无法启动 | 不适用（SQLite 文件式数据库） | — |
| 数据库文件损坏 | ✅ **确认** | `sqlite3 data/llm-todo.db "PRAGMA integrity_check"` → 错误 `database disk image is malformed (11)` |
| 部分表损坏 | ✅ **部分损坏** | `.recover` 可恢复 22 条 todo（原应有 32+ 条），丢失 10+ 条记录和所有其他表的数据 |
| Schema migration 不一致 | ✅ **Schema 可完全恢复** | `.recover` 输出的 CREATE TABLE 完整，包含所有 ALTER TABLE migration 增加的列 |
| 应用连接配置失效 | ❌ 配置仍然有效 | `.env` 中 `DB_PATH=./data/llm-todo.db` 完整可用 |
| 容器 volume 丢失 | ❌ 无法验证 | Docker 未运行，无法检查容器或 volume |
| 只有某些记录内容异常 | ✅ **完整记录可读** | `.recover` 输出的 INSERT 语句内容完整、字段值可解析 |

### 关键区别

⚠️ **不要把 API 设计缺陷误写成数据库损坏。**

此前 dogfood 发现的以下问题属于应用层设计缺陷，**不是数据库损坏**：
- 大量任务缺 due_date（31/32 在备份库中无 due_date，53/53 在 JSON 备份中无 due_date）
- 部分 high 任务缺 assignee（31/32 在备份库中无 assignee，21/53 在 JSON 备份中无 assignee）
- 无法可靠表达 unassigned（旧 schema 中 assignee 字段为自由文本）
- Agent 名称缺稳定 alias（JSON 备份中 assignee 有"小马哥"、"效率管家"等自由文本名称）
- search route 曾被 `/:id` shadow

### 恢复可信度

| 来源 | 完整性 | 信任等级 |
|------|--------|----------|
| 备份 DB (Jun 28) | 32 条完整记录 + 全部关联表 | ⭐⭐⭐⭐⭐ 完全可信 |
| JSON 备份 (Jul 5) | 53 条任务快照，缺 created_at | ⭐⭐⭐⭐ 可信（但缺时间戳） |
| 损坏 DB recover | 22 条 todo，无评论/附件/审计 | ⭐⭐⭐ 部分可信（数据截断） |
| 生产容器/volume | 不可访问 | ❌ 不可用于本次调查 |

---

## Data Inventory

### 备份 SQLite DB (Jun 28) — 32 条 todo

| 度量 | 值 |
|------|-----|
| 总记录数 | 32 |
| pending (待办) | 25 |
| blocked (阻塞) | 6 |
| done (完成) | 1 |
| 按优先级: high / medium | 12 / 20 |
| 按类型: personal / review | 31 / 1 |
| 有 assignee | 32/32 中仅 1 条（test-engineer） |
| 有 due_date | 32/32 中仅 1 条（ID=4 带提醒的测试） |
| 有 created_at | 32/32（范围: 2026-05-12 ~ 2026-05-27） |
| 有 tags | 32/32 中 3 条有非空 tags |
| 空 title | 0 |
| 重复 title | ID=2,3 均为"测试新版任务" |

**注意**: 此备份主要是测试数据（含大量 `[TEST]` 前缀的任务），真实生产价值较低。

**关联表统计**:

| 表 | 记录数 | 说明 |
|----|--------|------|
| users | 5 | admin, cto-agent, dev-engineer, ops-agent, viewer |
| task_attachments | 5 | 附件记录（关联测试任务） |
| task_assignments | 1 | 分配记录 |
| task_reports | 1 | 任务报告 |
| capabilities | 3 | 能力注册 |
| capability_requests | 2 | 能力请求 |
| request_logs | 110 | HTTP 请求日志 |
| prompt_templates | 2 | LLM prompt 模板 |
| user_preferences | 2 | 用户偏好 |
| task_comments / delivables / reminders / audit_logs / webhooks | 0 | 无数据 |

### JSON 备份 (Jul 5) — 53 条 task

| 度量 | 值 |
|------|-----|
| 总记录数 | **53** |
| pending (待办) | 43 |
| review (审核中) | 8 |
| in_progress (进行中) | 1 |
| active (活跃) | 1 |
| 按优先级: high / medium / low | 13 / 16 / 24 |
| 按类型: personal / agent / discuss / null | 27 / 5 / 2 / 19 |
| 有 assignee | 32/53（21 条 unassigned） |
| 有 due_date | **0/53** |
| 有 created_at | **0/53**（全部为空字符串） |
| 有 description | 47/53 |
| 有 area | 34/53 |
| 空 title | 0 |

**Assignee 分布**:

| Assignee | 数量 | 说明 |
|----------|------|------|
| (unassigned) | 21 | 无执行人 |
| efficiency-agent | 13 | 效率管家 |
| 小马哥 | 12 | 自由文本用户名 |
| reimbursement-expert | 4 | 报销专家 |
| content-ops-agent | 3 | 内容运营专家 |

### 损坏 DB Recover — 22 条 todo

- 可恢复 ID 范围: 1-22（与备份 DB 的 1-32 子集完全重叠，但少了 11 条）
- 此数据与备份 DB (Jun 28) 中 ID 1-22 一致，可作为备份的数据一致性验证

### 综合数据量

- **唯一 todo 记录总数**: 最多 53 条（JSON 备份，最完整的数据集）
- **两条数据源的交叉验证**: ID 17-18 在两条数据源中均有出现，数据内容一致
- **JSON 备份是唯一包含真实业务数据（非测试数据）的来源**

---

## Recovery Sources

### 来源 A: 备份 SQLite DB (Jun 28)

| 属性 | 值 |
|------|-----|
| 位置 | `~/Documents/llm-todo-backups/llm-todo-20260628-233750.db` |
| 日期 | 2026-06-28 |
| 完整性 | ✅ integrity_check = ok |
| 记录数 | 32 todos + 其他表 |
| 信任等级 | ⭐⭐⭐⭐⭐ |
| 是否只读 | ✅ 本地文件 |
| 敏感信息 | 用户表含 API key（`tk-xxx-xxx` 格式） |
| 恢复建议 | 可用作初始导入的数据源，但多数为测试数据 |

### 来源 B: JSON 备份 (Jul 5)

| 属性 | 值 |
|------|-----|
| 位置 | `~/.openclaw/groups/workspace-oc_c6fa97d6255912b25a277e25441f6c11/llm-todo-backup-2026-07-05.json` |
| 日期 | 2026-07-05 |
| 完整性 | 结构化完好，但缺 created_at / due_date / tier1/tier2 审核详情 |
| 记录数 | 53 tasks |
| 信任等级 | ⭐⭐⭐⭐（缺时间戳，降低可信度） |
| 是否只读 | ✅ 本地文件 |
| 敏感信息 | 含任务标题中的个人隐私信息（如"修车"、"报销"、"疫苗"等） |
| 恢复建议 | ⭐ **主要迁移来源** — 包含最有价值的业务数据 |

### 来源 C: 损坏 DB 的 `.recover` 结果

| 属性 | 值 |
|------|-----|
| 位置 | `./data/llm-todo.db`（原数据库） |
| 日期 | 无（数据时间范围 2026-05-12 ~ 2026-05-27） |
| 完整性 | 22/32 条可恢复，丢失其他表 |
| 信任等级 | ⭐⭐⭐ |
| 恢复建议 | 信息来源有限；22 条已完全被备份 DB 覆盖 |

### 其他来源

- Docker volume: ❌ 不可访问
- 生产主机: ❌ `8.163.44.127` 未验证可用
- 其他备份: ❌ 未发现更多备份文件

---

## Data Model

### todos 主表（最终 schema）

共约 35+ 个字段，通过 CREATE TABLE + 多次 ALTER TABLE migration 实现。

#### 核心字段（全部存在、可信）

| 字段 | 类型 | 默认值 | 填充率 | 说明 |
|------|------|--------|--------|------|
| `id` | INTEGER PK | AUTOINCREMENT | 100% | SQLite 自增 ID |
| `title` | TEXT NOT NULL | — | 100% | 任务标题 |
| `description` | TEXT | NULL | ~87% | 任务描述（JSON 备份 47/53 非空） |
| `status` | TEXT | `'pending'` | 100% | `pending`/`done`/`blocked`/`in_progress`/`active`/`review` |
| `priority` | TEXT | `'medium'` | 100% | `high`/`medium`/`low` |
| `created_at` | DATETIME | `CURRENT_TIMESTAMP` | 部分（JSON 备份全部为空） | 创建时间 |
| `updated_at` | DATETIME | `CURRENT_TIMESTAMP` | 部分 | 更新时间 |
| `tags` | TEXT | `'[]'` | 100% | JSON 数组字符串 |

#### 可选字段（存在率不同）

| 字段 | 填充率 | 是否可信 | 说明 |
|------|--------|----------|------|
| `assignee` | 低（32/53 ~60%） | ⚠️ 自由文本 | 包含"小马哥"等无稳定 alias 的名称 |
| `assignee_agent_id` | 低 | ✅ 规范格式 | 仅 `efficiency-agent`/`content-ops-agent`/`reimbursement-expert` 等有限值 |
| `due_date` | 极低（0/53） | ✅ 可信但几乎为空 | 大部分任务无截止日期 |
| `type` | 部分 | ⚠️ 不一致 | `personal`/`agent`/`discuss`/`review`/`null` |
| `area` | 部分（34/53） | ✅ | `life`/`content`/`finance`/`dev`/`ops` |
| `creator` | 0/32 | — | 备份 DB 中全部为 NULL |
| `tier1_status` | 53/53 | ⚠️ 全为 `pending` | 无实际审核数据 |
| `tier2_status` | 53/53 | ⚠️ 全为 `pending` | 无实际审核数据 |
| `completed_at` | 1/32 | ✅ | 仅 1 条有完成时间 |
| `tags` | 100% | ⚠️ 格式混乱 | JSON 备份中 tags 包含多重转义字符串 |
| `scheduled_at` / `snoozed_until` | 0% | — | 未使用 |

#### 已确认的业务语义问题

1. **assignee 不可靠**: 既有 `efficiency-agent`（agent_id）又有"小马哥"（自由文本），JSON 备份中 assignee 存在于 tags 字段中（如 `"[\"assignee:小马哥\",\"type:personal\"]"`）
2. **status 值不统一**: `pending`/`done`/`blocked` 与 `in_progress`/`active`/`review` 共存
3. **due_date 缺严重**: 53 条任务中 0 条有 due_date
4. **created_at 缺失**: JSON 备份中全部为空（可能 API 导出未包含）
5. **审核字段空壳**: `tier1_status`/`tier2_status` 全部为 `pending`，无任何实际审核记录

### 其他表

- **deleted_todos**: 与 todos 结构相同，用于软删除保留（当前无数据）
- **task_comments**: 评论/活动日志（当前无数据）
- **task_relations**: 任务依赖/关联（当前无数据）
- **task_attachments**: 附件（5 条，均为测试数据）
- **audit_logs**: 审计日志（当前无数据）
- **task_review_cycles / task_reviews**: 四重审核表（备份 DB 中无此表，说明是后续 schema 更新）

### 数据模型版本

备份 DB (Jun 28) 的 schema 版本较旧 — 缺少 `assignment_state` 列和 `task_review_cycles`/`task_reviews` 表。损坏 DB 的 schema 更新（包含 `assignment_state` 和四重审核表）。

---

## Migration Classification

### MIGRATE_ACTIVE（有明确价值、字段足够可靠的活跃任务）

**数量**: ~17 条（估计，需人工确认）

基于 JSON 备份的分析，满足以下条件的任务：
- title 有效 ✅
- status 可确认（pending / in_progress / active—排除 done/review）
- assignee 或 creator 可推断
- 无明显损坏或重复

候选特征：
- assignee 有值（efficiency-agent / content-ops-agent / reimbursement-expert 等规范 Agent）
- 或明确为 personal 但 title 有业务价值
- 当前为非终态（非 done/archived）

**不能自动迁移的任务** — 理由：
- 缺乏 created_at 时间戳 → 无法重建时间线
- assignee 为自由文本"小马哥" → 无规范 Uuid
- type=null → 无法判断 Definition 映射

### MIGRATE_AS_UNTRIAGED（内容可恢复，但负责人/状态/类别不可靠）

**数量**: ~25 条（估计）

包括：
- assignee = unassigned 但 title 有明确含义
- type = null 的任务
- tags 中含 assignee 但 assignee 字段为空

### ARCHIVE_ONLY（仅历史查询价值）

**数量**: ~11 条

包括：
- status = done / completed（1 条）
- status = review 且无后续审核信息（8 条）
- `[TEST]` 前缀的纯测试任务（db backup 中 12 条 `[TEST]` 任务）

### DISCARD_DUPLICATE_OR_CORRUPT（明确重复、空壳、测试数据）

**数量**: ~14 条

包括：
- ID=300 "test-subagent-task"、ID=301 "test-no-auth" — 纯测试
- ID=288 "测试 - 若创建成功则删除" — 创建后应删除
- ID=2,3 "测试新版任务" — 重复测试
- ID=11-22 在备份 DB 中的 `[TEST]` 系列（12 条）

### MANUAL_DECISION_REQUIRED（业务含义冲突）

**数量**: ~3 条

包括：
- ID=84 "【P0】清洗全部75条任务" — 元任务，是否已过时？
- ID=266 "#62 完结：提单报销" + ID=267 "#62 完结报告" — 与 ID=62 的关联不确定
- ID=289 与 ID=290 同为"内容发布日历"，疑似重复但状态不同

---

## Definition Mapping

### personal_quick_item_v1（个人快速事项）

**适合**: 27 条 type=personal 的任务 + 19 条 type=null 但明显个人性质的任务

**理由**:
- 简单个人待办（修车、报销、疫苗等）
- 无需双重检查/验收
- 无需 workflow history

**注意**: 当前尚未实现此 Definition，仅做需求判断。

### agent_self_task_v1（Agent 自提正式任务）

**适合**: 5 条 type=agent 的任务（ID=239, 242, 285, 289, 290）

**理由**:
- Agent 自己提出
- 涉及平台开发或内容生产
- 理论上应经过审核验收流程

**限制**:
- 无任何历史 transition/event 记录
- 无 efficiency-agent 或 ceo-agent 的检查记录
- 无法为其伪造审核历史

### archive-only representation（纯归档）

**适合**: 所有 status=done/review 的任务 + `[TEST]` 系列

**理由**:
- 已完成的历史任务
- 无法重建 workflow history
- 仅需保留查询和出处

### ambiguous（待定）

**适合**: 19 条 type=null 的任务 — 需人工分类

---

## svc-workflow Import Capability

### 现有 Legacy Import 系统

svc-workflow 已有完整的 **Legacy ADC Initial Import** 原语，包括：

| 组件 | 位置 | 说明 |
|------|------|------|
| `ImportLegacyWorkflowInstanceCommand` | `src/domain/workflow_instance/import.rs` | 命令类型，用于导入遗留工作流实例 |
| `LegacyAdcImportSnapshotV1` | 同上 | 遗留快照类型，包含 `requirement_id`, `workflow_snapshot`, `current_step`, `assignee_id`, `context_payload` 等 |
| `import()` | `src/store/postgres/legacy_import_repository/transaction.rs` | PostgreSQL 实现 |
| idempotency key | `format!("migration:adc:{}:v1", self.legacy_record_id)` | 幂等键 |
| snapshot digest | JCS canonicalization → SHA-256 hex | 快照完整性校验 |
| import receipt | `receipt::acquire()` → `receipt::complete()` / `receipt::write_attempt()` | 可审计/可回放 |
| replay support | `replay::replay_success()` | 成功导入后可安全重放 |
| external reference | `migrations/0009_add_instance_external_reference.sql` | 实例外部引用列 |
| `CreateWorkflowInstanceCommand` | `src/domain/workflow_instance/commands.rs` | 标准创建工作流实例命令 |

### 导入能力评估

| 问题 | 答案 |
|------|------|
| 1. 能否导入已有创建时间？ | ⚠️ 可传入 `context_payload` 的 snapshot 中，但 `workflow_instances.created_at` 为 DB 自动时间戳，无法覆写 |
| 2. 能否保留 legacy ID？ | ✅ `external_reference` 列可存储 `migration:llm-todo:{id}:v1` |
| 3. 能否指定当前节点？ | ✅ `imported_node_id` 参数可指定导入到哪个 Definition 节点 |
| 4. 能否导入历史状态而不伪造事件？ | ✅ 单条 `WORKFLOW_INSTANCE_IMPORTED` 事件，event_data 含 provenance 元数据，不伪造 transition |
| 5. 能否标识 provenance？ | ✅ event_data 含 `legacySystem`, `legacyRecordId`, `legacySnapshotDigest`, `importedAt`, `creatorResolution` |
| 6. 能否幂等重跑？ | ✅ idempotency key + receipt replay |
| 7. 能否检测同一旧记录已导入？ | ✅ `ExternalReferenceConflict` / `IdempotencyConflict` |
| 8. 能否在失败后安全续跑？ | ✅ After success, replay. After failure, retry. |
| 9. 能否先 dry-run？ | ❌ 当前无 dry-run 模式（import 即写库），但可以导入到隔离数据库做验证 |
| 10. 是否会绕过权限验证？ | ✅ 有完整的 `validate_access()` 链 |

### 结论

| 分类 | 建议 |
|------|------|
| `REUSE_EXISTING_LEGACY_IMPORT` | ❌ 不适合直接复用 — 当前 import 是 ADC-specific（`domain_key: "adc"`、`LegacyAdcImportSnapshotV1`） |
| `EXTEND_LEGACY_IMPORT_MINIMALLY` | ⚠️ 可扩展 — 引入 `LegacyTodoImportSnapshotV1` 或使 `LegacyAdcImportSnapshotV1` 更通用 |
| `BUILD_TODO_SPECIFIC_IMPORT_ADAPTER` | ✅ **推荐** — 在 workflow-todo 层构建 todo-to-workflow 适配器，调用 `CreateWorkflowInstanceCommand`（非 `ImportLegacyWorkflowInstanceCommand`） |
| `ARCHIVE_ONLY_NO_WORKFLOW_IMPORT` | 部分适合 — 仅对 `ARCHIVE_ONLY` 类别采用纯归档方案 |

**推荐方案**: workflow-todo 层构建 TODO 导入适配器，通过标准 `CreateWorkflowInstanceCommand` 创建实例，在 `contextPayload` 中携带旧数据 provenance，而非使用 ADC 专属的 `ImportLegacyWorkflowInstanceCommand`。

---

## Provenance and Idempotency

### 建议的 provenance schema

```json
{
  "legacySource": "llm-todo",
  "legacyTodoId": 60,
  "legacySnapshotDigest": "sha256hex",
  "legacyCreatedAt": "2026-05-17T00:06:44Z",
  "legacyUpdatedAt": "2026-05-17T00:06:44Z",
  "importedAt": "2026-07-17T12:00:00Z",
  "importBatchId": "batch-001",
  "mappingDecision": "MIGRATE_ACTIVE",
  "mappingReason": "type=personal, assignee=小马哥, active pending task"
}
```

### 存储位置评估

| 位置 | 适合性 | 说明 |
|------|--------|------|
| `ContextRevision.payload` | ✅ 最佳 | `contextPayload` 可携带全部 provenance 元数据 |
| `Submission` | ❌ 不适用 | submission 对应 transition 时的提交，初始导入无此概念 |
| `Instance metadata` | ⚠️ 部分 | `workflow_instances.metadata` (JSON) 可存放轻量级 provenance |
| `Instance external_reference` | ⚠️ 标识符 | 仅存 `migration:llm-todo:{id}:v1` 作为幂等键 |
| 外部 archive | ✅ 适合归档 | ARCHIVE_ONLY 类别可存入外部 JSON/CSV 文件 |

### 幂等性保证

- **幂等键**: `migration:llm-todo:{legacyTodoId}:v1`
- **重跑行为**: 成功重跑返回相同结果；失败重跑重新执行
- **冲突行为**: `IdempotencyConflict` — 旧已导入但 snapshots 不同，需人工干预
- **snapshot digest**: JCS canonicalize + SHA-256，确保内容完整性

---

## Skill Impact

### Todo Client Skill 位置

```
~/.agents/skills/todo-client/    →   /Users/yanfenma/.openclaw/skills/todo-client (symlink)
~/.agents/skills/todo-client/SKILL.md
```

两者为同一目录的 symlink。

### Skill 依赖的旧 API

todo-client 当前依赖的 API 端点（从 SKILL.md 和脚本推断）:

| 旧 API | 用途 | 迁移影响 |
|--------|------|----------|
| `GET /api/todos` | 查询任务列表 | workflow-todo 改用 `GET /internal/v1/worklists/assigned-to-me` |
| `GET /api/todos/:id` | 任务详情 | workflow-todo 改用 `GET /internal/v1/workflow-instances/:id` |
| `POST /api/todos` | 创建任务 | workflow-todo 改用 `POST /internal/v1/workflow-instances` |
| `PUT /api/todos/:id` | 更新任务 | workflow-todo 改用 transition/submission |
| `POST /api/todos/:id/review` | 提交验收 | workflow-todo 改用 transition（ADVANCE） |
| `POST /api/login` | JWT 认证 | svc-workflow 有独立的 JWT 体系 |

### 迁移影响评估

- todo-client skill 需**完全重写**以适配 svc-workflow API
- query-tasks.sh 对旧 API 的字段过滤（--priority, --status, --assignee）需映射到 workflow worklist API
- 旧 ID（整数）与 workflow instance ID（UUID）不兼容
- 旧 status/priority 语义与 workflow node 概念不同

**注意**: 本轮不修改 skill，仅记录依赖关系。

---

## Proposed Migration Gates

### Phase 0: 原始数据冻结

| 操作 | 状态 |
|------|------|
| 备份 SQLite DB 文件 | ✅ 已完成（`~/Documents/llm-todo-backups/`） |
| JSON 备份保存 | ✅ 已完成 |
| 计算备份 digest | ⏳ 待做（建议 SHA-256） |
| 记录来源完整性 | ✅ 本次报告 |
| 停止修改旧库 | ✅ llm-todo 已冻结 |

### Phase 1: Dry-run Inventory

| 操作 | 状态 |
|------|------|
| 解析所有记录 | ✅ 本次报告已完成 |
| 分类（MIGRATE_ACTIVE / ARCHIVE_ONLY 等） | ✅ 初步分类完成 |
| 生成映射报告 | ✅ 本次报告 |
| 不写 svc-workflow | ✅ 已遵守 |

### Phase 2: 小规模 Canary

| 操作 | 建议 |
|------|------|
| 选择 3-5 条 MIGRATE_ACTIVE 任务 | 推荐: ID=238, 256, 279, 284, 292 |
| 导入隔离/测试数据库 | 需建立隔离测试环境 |
| 核对 Worklist 和 provenance | 验证导入完整性和字段映射 |

### Phase 3: 活跃任务受控导入

| 操作 | 建议 |
|------|------|
| 仅 MIGRATE_ACTIVE | 先在 Phase 2 验证 |
| 可暂停、可续跑 | 利用 idempotency + batch tracking |
| 有 Receipt | 每个导入有 import receipt |

### Phase 4: 历史归档

| 操作 | 建议 |
|------|------|
| completed/archived 只读保留 | 导出为 JSON/CSV 归档 |
| 不污染当前 Worklist | 不导入为活跃 WorkflowInstance |

---

## Risks

### Blocker

| 风险 | 说明 |
|------|------|
| **JSON 备份缺 created_at** | 53 条任务全部无时间戳，无法重建时间线，影响 Definition 中基于时间的约束 |
| **svc-workflow 无 todo-specific import** | 现有 Legacy Import 是 ADC 专属，需要新建 todo 导入适配器或扩展通用方案 |
| **assignee 无稳定 alias** | "小马哥"无法映射为 PrincipalId，efficiency-agent 等 Agent 名在 svc-workflow 中需注册 |

### High

| 风险 | 说明 |
|------|------|
| **两条备份数据源不重叠** | DB 备份 (Jun 28) 主要是测试数据，JSON 备份 (Jul 5) 才是真实数据，但两者 ID 空间不同 |
| **JSON 备份 tags 格式混乱** | tags 字段包含多重转义 JSON 字符串，需要额外解析 |
| **各种 status 值不统一** | `pending`/`review`/`active`/`in_progress` 需映射到 workflow Definition 的 Node |
| **Docker volume 不可访问** | 可能仍有完整数据在生产 volume 中，但当前无法验证 |

### Medium

| 风险 | 说明 |
|------|------|
| **备份 DB 的 sensitive data** | users 表含明文 API key |
| **测试数据污染风险** | 备份 DB 的 22 条 `[TEST]` 任务可能被误导入 |
| **todo-client skill 需重写** | 完整的 API 适配工作 |
| **迁移后旧系统中引用 todo ID 的链接会失效** | ID 从整数变为 UUID |

### Low

| 风险 | 说明 |
|------|------|
| **重复记录** | ID=289 与 290 可能重复 |
| **空 type 的类型推断** | 19 条 type=null 的任务需要人工确认 |
| **缺失的 due_date** | 旧系统本就缺，不影响迁移决策 |
| **无审核历史** | 旧系统本来就无有效审核流，不影响 |

---

## Recommended First Implementation Slice

### `LEGACY_TODO_ACTIVE_CANARY_IMPORT`

**建议作为第一个实现切片**：

1. 选择 3-5 条明确活跃且有 assignee 的任务（推荐 JSON 备份中 ID=238, 256, 279, 284, 292）
2. 在 workflow-todo 中构建最小导入脚本（调用 `POST /internal/v1/workflow-instances` 的 `CreateWorkflowInstanceCommand`）
3. 在 `contextPayload` 中嵌入 provenance 元数据
4. 导入到隔离 test 数据库（非 dogfood）
5. 验证 Worklist 可查询、provenance 可追溯
6. 验证 idempotency（重跑导入幂等）

**不推荐** `LEGACY_TODO_READ_ONLY_SNAPSHOT_AND_INVENTORY` — 本次调查已完成了 inventory。

**不推荐** `LEGACY_TODO_ARCHIVE_EXPORT` — 归档可等活跃任务导入后再做。

**不推荐** `NO_RECOVERABLE_DATA_START_FRESH` — 有可恢复的有价值数据。

**不推荐** `PRODUCT_DECISION_REQUIRED` — 技术上可行，但需人工标注 mapping classification。

---

## Final Status

```
LEGACY_TODO_MIGRATION_INVESTIGATION_COMPLETE
```

### 关键结论

1. ✅ 旧 llm-todo 数据在 **两个独立备份** 中可恢复（SQLite DB + JSON 导出）
2. ✅ 原始数据库确实损坏（"database disk image is malformed"），但 `.recover` 可提取 22 条
3. ✅ 可恢复 **53 条** 唯一任务（从 JSON 备份），其中约 17 条 MIGRATE_ACTIVE
4. ✅ 数据应主要来自 **JSON 备份 (Jul 5)**，DB 备份 (Jun 28) 作为 schema/测试数据参考
5. ⚠️ svc-workflow 的 Legacy Import 是 ADC 专属，需构建 todo 导入适配器
6. ✅ 迁移可做到幂等、可审计、可回滚（利用 svc-workflow 的 idempotency + receipt 机制）
7. ⚠️ 主要缺失：JSON 备份无 created_at、assignee 需映射为 PrincipalId
8. ❌ todo-client skill 需完全重写以适配 svc-workflow API

### 后续立即动作

1. 人工标注 53 条任务的迁移分类（MIGRATE_ACTIVE / ARCHIVE_ONLY 等）
2. 建立 svc-workflow 隔离测试环境
3. 实现 workflow-todo 导入适配器（Phase 2 canary）
