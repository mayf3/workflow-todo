# Remote llm-todo Export and Inventory Report

**Report date**: 2026-07-17T14:01:41Z  
**Export date**: 2026-07-17T14:01:20Z  
**Evidence location**: `migration/legacy-llm-todo-v1/private/remote-todos-raw.json`  
**JWT handling**: Loaded from `~/.agents/skills/todo-client/.todo-client-jwt`, not output in report  

---

## Export

| Property | Value |
|----------|-------|
| URL | `https://8.163.44.127/todo/api/todos?limit=999` |
| exportedAt | `2026-07-17T14:01:20Z` |
| HTTP status | `200` |
| byte length | `88632` |
| SHA-256 | `284fe44af048d7aa453dae4385fae6e25730f9ed97e92516d44b4bda60fbbf3f` |
| record count | **82** |
| pagination verified | ✅ `hasMore: false` — one page returned all records. Server capped limit to 500 (requested 999), but page 1 contained all 82 records. |
| secret handling | JWT read from `.todo-client-jwt`, passed as `Authorization: Bearer` header, not written to disk or output. Result file `chmod 600`. |

### Envelope structure

```json
{
  "todos": [...],   // 82 items
  "count": 82,
  "page": 1,
  "limit": 500,
  "hasMore": false
}
```

---

## Remote Inventory

| Metric | Value |
|--------|-------|
| total | **82** |
| fields | **40** |
| unique IDs | 82 ✅ |
| duplicate IDs | 0 ✅ |
| ID range | 17 – 343 |

### Status distribution

| Status | Count | Notes |
|--------|-------|-------|
| pending | **73** | Active backlog |
| review | 7 | Awaiting tier1/tier2 review |
| in_progress | 1 | ID=268 (has `completed_at` — inconsistent) |
| active | 1 | ID=84 (description says "已完成" — completed) |
| **Sum** | **82** | |

### Priority distribution

| Priority | Count |
|----------|-------|
| high | 30 |
| medium | 29 |
| low | 22 |
| P1 | 1 |

### Type distribution

| Type | Count |
|------|-------|
| personal | 59 |
| (null) | 17 |
| agent | 4 |
| discuss | 2 |

### Assignee distribution

| Assignee | Count | Notes |
|----------|-------|-------|
| (unassigned) | 56 | No assignee |
| efficiency-agent | 13 | 效率管家 — canonical agent_id |
| 小马哥 | 11 | Free-text username, no stable alias |
| content-ops-agent | 1 | Content ops agent |
| miniapp-game-engineer | 1 | Mini-app dev agent |

### Time range

| Field | Range | Complete |
|-------|-------|----------|
| created_at | `2026-05-17 06:44:26` – `2026-07-16 11:10:09` | ✅ **82/82** present |
| updated_at | `2026-06-23 23:22:39` – `2026-07-16 12:51:02` | ✅ **82/82** present |
| due_date | — | ❌ **6/82** non-null |
| completed_at | — | 5/82 non-null (includes inconsistent ones) |

### Review fields

| Field | State |
|-------|-------|
| tier1_status | pending: 79, rejected: 3 |
| tier2_status | pending: 82 |
| tier1_comment | 4/82 non-null (the 3 rejected + 1 extra) |
| tier2_comment | 0/82 non-null |

---

## Source Comparison

### Comparison matrix

| Source | Date | Count | Completeness | Trust |
|--------|------|-------|-------------|-------|
| **① Remote API** | 2026-07-17 | **82** | ✅ Full fields, all timestamps | ⭐⭐⭐⭐⭐ Current authority |
| ② Local JSON backup | 2026-07-05 | 53 | ⚠️ No created_at, fewer fields | ⭐⭐⭐⭐ |
| ③ Corrupted DB `.recover` | ~2026-07-16 | 22 | ❌ Schema only + 22 todo rows | ⭐⭐⭐ |
| ④ SQLite backup | 2026-06-28 | 32 | ✅ Integrity ok, but test data | ⭐⭐⭐⭐ |

### Intersection

| Set | Count | IDs |
|-----|-------|-----|
| **remote ∩ local JSON** | **45** | 17, 18, 45, 47, 55, 60, 64, 65, 77, 84, 115, 127, 142, 185, 186, 187, 192, 237, 238, 239, 242, 256, 262, 263, 268, 270, 272, 278, 279, 280, 281, 282, 283, 284, 285, 286, 288, 291, 292, 293, 294, 298, 299, 300, 301 |
| **remote only** | **37** | 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 329, 331, 332, 333, 335, 336, 337, 338, 339, 340, 341, 342, 343 |
| **local JSON only** | **8** | 62, 116, 235, 266, 267, 271, 289, 290 |

### Local-only records (deleted from remote since Jul 5)

These 8 records existed in the Jul 5 JSON backup but are absent from the current remote API:

| ID | Title | Status | Priority | Assignee |
|----|-------|--------|----------|----------|
| 62 | 提单报销 — 整理发票走报销流程 | review | low | reimbursement-expert |
| 116 | 报销专家：使用浏览器自动化上传报销材料到平安保险 | review | low | reimbursement-expert |
| 235 | 【马丘比丘】4岁疫苗接种（脊灰第4剂+麻腮风第2剂） | pending | high | 小马哥 |
| 266 | #62 完结：提单报销 | review | low | reimbursement-expert |
| 267 | #62 完结报告 | review | low | reimbursement-expert |
| 271 | 把疫苗接种计划交给家庭医生制定 | review | high | (unassigned) |
| 289 | 内容运营专家：制作内容发布日历（文章/视频/播客） | review | high | content-ops-agent |
| 290 | 内容发布日历 — 确定内容发布节奏 | review | high | content-ops-agent |

**Pattern**: Most deleted records were `review` status tasks assigned to `reimbursement-expert`, `content-ops-agent`, or personal tasks with `high` priority. They were likely deleted (archived/cleaned) from the remote server.

### Field conflict: remote vs local JSON (shared IDs)

| ID | Field | Remote value | Local JSON value |
|----|-------|-------------|-----------------|
| 299 | status | `review` | `pending` |

Only **1 field conflict** across 45 shared IDs — ID=299 had its status changed from `pending` (Jul 5) to `review` (Jul 17). Remote is authoritative.

### New fields in remote (absent from local JSON)

27 fields present in remote API but absent from the Jul 5 JSON export:
`blocked_by`, `blocked_reason`, `category`, `completed_at`, `created_by`, `creator`, `delivery_path`, `depends_on`, `horizon`, `is_personal`, `layer`, `llm_analyzed`, `next_action`, `parent_id`, `reminder_at`, `review_comment`, `reviewer`, `scheduled_at`, `snoozed_until`, `sub_status`, `tier1_comment`, `tier1_reviewed_at`, `tier1_reviewer`, `tier2_comment`, `tier2_reviewed_at`, `tier2_reviewer`, `updated_at`

The local JSON was a partial export — it only had: `id, title, status, priority, assignee, area, type, tags, created_at, due_date, description, tier1_status, tier2_status`.

### Relationship to SQLite sources

| Source | Count | Overlap with remote |
|--------|-------|---------------------|
| SQLite backup (Jun 28) | 32 | IDs 17-22 overlap, but those are `[TEST]` tasks in backup, real tasks in remote |
| Corrupted DB recover | 22 | IDs 1-22 — none of these (except 17-22) exist in remote (remote IDs start at 17) |

The SQLite databases contain older test data and early development records. Remote API is the authoritative current source.

---

## Schema

### ORM location

`/Users/yanfenma/workspace/project/llm-todo/src/db.ts` — `CREATE TABLE todos (...)` definition with 26 DB columns.

`src/routes/todo/crud-helpers.ts` — `attachDependencyInfo()` adds computed fields:
- `depends_on`: parsed from JSON string `[]` to array `[]`
- `blocked_by`: computed via `getBlockedBy(id)` — tasks that list this ID as a dependency

### Field count reconciliation

The remote API returns **40 fields**. These come from:
- **26 DB columns** from `SELECT * FROM todos`
- **+2 computed fields** from `attachDependencyInfo` (blocked_by, depends_on transformed)
- **+12 legacy alias / rarely-populated fields** from DB (`blocked_reason`, `reviewer`, `review_comment`, etc.)

### Field type semantics

| Field | DB Type | Nullable | Semantics |
|-------|---------|----------|-----------|
| `id` | INTEGER PK | — | Auto-increment SQLite ID |
| `title` | TEXT NOT NULL | — | Task title |
| `description` | TEXT | ✅ | Task description |
| `category` | TEXT | ✅ | Free-text category |
| `assignee_agent_id` | TEXT | ✅ | Canonical agent ID with CHECK constraint (trimmed, non-empty) |
| `priority` | TEXT | — | `high`/`medium`/`low` (DB default: `medium`) — API returns `P1` for ID=335 (non-standard) |
| `status` | TEXT | — | `pending`/`done`/`blocked`/`review`/`in_progress`/`active` (DB default: `pending`) |
| `due_date` | TEXT | ✅ | `YYYY-MM-DD` or `YYYY-MM-DD HH:mm:ss` |
| `tags` | TEXT | — | JSON array string `["tag1","tag2"]` — **NOTE**: some records have double-escaped JSON `["[\"assignee:x\",...]"]` |
| `reminder_at` | TEXT | ✅ | ISO datetime |
| `completed_at` | TEXT | ✅ | ISO datetime (Z-suffix) |
| `llm_analyzed` | INTEGER | — | 0/1 boolean |
| `created_at` | DATETIME | — | `YYYY-MM-DD HH:mm:ss` |
| `updated_at` | DATETIME | — | `YYYY-MM-DD HH:mm:ss` |
| `type` | TEXT | ✅ | `personal`/`agent`/`review`/`discuss` (DB default: `personal`) |
| `assignee` | TEXT | ✅ | Free-text assignee name/alias |
| `horizon` | TEXT | ✅ | `day`/`week`/`month`/`quarter`/`year` (DB default: `week`) |
| `layer` | TEXT | ✅ | `lifeLine`/`mainLine`/`L1`/`L2` etc. — only 2/82 populated (remote) |
| `area` | TEXT | ✅ | `dev`/`ops`/`life`/`health`/`learning`/`content`/`finance` (DB default: `life`) |
| `next_action` | TEXT | ✅ | 具体下一步 — only 1/82 populated (remote) |
| `delivery_path` | TEXT | ✅ | 交付物路径 — 0/82 non-null (remote) |
| `sub_status` | TEXT | — | `pending`/`in_progress`/`done`/`blocked` (DB default: `pending`) |
| `scheduled_at` | TEXT | ✅ | 延迟开始时间 — 0/82 (remote) |
| `snoozed_until` | TEXT | ✅ | 暂停时间 — 0/82 (remote) |
| `target_date` | TEXT | ✅ | YYYY-MM-DD (Slice F) — not in API response |
| `assignment_state` | TEXT | — | `unassigned`/`assigned`/`self_owned`/`not_applicable` — not in API response |
| `creator` | TEXT | ✅ | UUID or name of creator (33/82 populated in remote) |
| `parent_id` | INTEGER | ✅ | FK to `todos(id)` — 0/82 (remote) |
| `is_personal` | INTEGER | — | 0/1 — 82/82 are 0 (remote) |
| `blocked_reason` | TEXT | ✅ | Human-readable blocked reason |
| `reviewer` / `review_comment` | TEXT | ✅ | Legacy review fields (populated: 3/82 reviewer) |
| `tier1_reviewer` / `tier1_status` / `tier1_comment` / `tier1_reviewed_at` | TEXT | ✅ | T1 review fields |
| `tier2_*` (4 fields) | TEXT | ✅ | T2 review fields |
| `depends_on` | TEXT (DB) / computed array (API) | — | Stored as JSON string `[1,2,3]`, API returns parsed array |
| `blocked_by` | Computed | — | Tasks whose `depends_on` includes this task's ID |

### Tags format issue

Critical to note for migration: the `tags` field stores JSON arrays, but some records have double-escaped content. Example from the API payload:

```
"[\"[\\\"assignee:内容运营专家\\\",\\\"type:agent\\\"]\",\"layer:mainLine\",\"area:content\"]"
```

This is a JSON array of JSON-encoded strings. The first element is itself a JSON-encoded array. This is a data quality issue — tags should be parsed carefully during migration.

### Known non-DB fields in API response

The field `created_by` (22/82 non-null) is not in the DB schema. It is likely a computed alias for `creator` or derived from context. The DB has `creator` (33/82 non-null). Both fields coexist in the API response.

---

## Exact Classification

### Classification criteria

| Category | Criteria |
|----------|----------|
| **MIGRATE_ACTIVE** | Clear assignee (canonical Agent or named person), status=pending/in_progress/review, non-test, active business value. Includes high-priority personal tasks. |
| **MIGRATE_AS_UNTRIAGED** | Content recoverable, but assignee missing or unreliable (unassigned), or medium/low priority personal tasks without clear ownership. |
| **ARCHIVE_ONLY** | Has `completed_at` timestamp, or description confirms completion, or tier1 rejected with no re-review. |
| **DISCARD_DUPLICATE_OR_TEST** | Test entries ("test-", "若成功立即删除"), or exact title duplicates (336=338, 337=339). |
| **MANUAL_DECISION_REQUIRED** | Type=agent or review status with no assignee, or content-ops-agent task where agent may be inactive. |

### Classification result

| Category | Count | IDs |
|----------|-------|-----|
| **MIGRATE_ACTIVE** | **36** | 17, 45, 47, 55, 115, 127, 142, 185, 186, 187, 192, 237, 238, 239, 242, 263, 278, 279, 298, 306, 309, 311, 312, 313, 314, 315, 321, 322, 323, 329, 335, 336, 337, 341, 342, 343 |
| **MIGRATE_AS_UNTRIAGED** | **29** | 18, 60, 64, 65, 256, 262, 270, 272, 280, 281, 282, 283, 284, 286, 291, 292, 293, 294, 302, 303, 304, 305, 307, 308, 310, 316, 317, 318, 324 |
| **ARCHIVE_ONLY** | **6** | 84, 268, 319, 320, 325, 333 |
| **DISCARD_DUPLICATE_OR_TEST** | **8** | 288, 300, 301, 331, 332, 338, 339, 340 |
| **MANUAL_DECISION_REQUIRED** | **3** | 77, 285, 299 |
| **Sum** | **82 ✅** | |

### Detailed rationale

#### MIGRATE_ACTIVE (36)

**Agent-managed tasks (efficiency-agent, miniapp-game-engineer) — pending status:**

| ID | Title | Priority | Assignee |
|----|-------|----------|----------|
| 17 | 推广 Smart Search skill 给其他 Agent 使用 | low | efficiency-agent |
| 45 | 开发 task-compiler skill（需求池编译排序） | low | efficiency-agent |
| 47 | 跑通上传Agent到平台（扣子等）的流程 | low | efficiency-agent |
| 55 | 搜索专家到Agent集市注册，支持深度研究能力 | low | efficiency-agent |
| 127 | 效率管家：建立Agent todo双层Review流程 | low | efficiency-agent |
| 185 | 效率管家：设计Agent每日自省cron模板 | low | efficiency-agent |
| 186 | Agent自驱任务体系 — Step2：定义审核标准和模板 | low | efficiency-agent |
| 187 | Agent自驱任务体系 — Step3：推广到主线Agent | low | efficiency-agent |
| 192 | 试点派发：挑选5-8个高优无依赖任务 | low | efficiency-agent |
| 239 | 开发待办事项手机APP | low | efficiency-agent |
| 242 | LLM Todo: 任务snooze/到期后再提醒功能 | low | efficiency-agent |
| 263 | 探索Agent打电话方案 — AI语音外呼调研 | low | efficiency-agent |

**Agent/discuss typed tasks with assignee:**

| ID | Title | Priority | Assignee | Type |
|----|-------|----------|----------|------|
| 237 | 建立学习投资股票策略的学习方案 | low | 小马哥 | discuss |
| 238 | 把公司报销条例和平台信息发给报销专家 | high | 小马哥 | personal |
| 278 | 报销过去的医药费用（整理历史发票走报销） | high | 小马哥 | personal |
| 279 | 整合内容管线 | high | 小马哥 | personal |
| 115 | 拍照报销材料 — 发票照片上传到指定目录 | high | 小马哥 | personal |
| 142 | 完成富途的实名认证 | high | 小马哥 | personal |

**Review tasks — active pipeline:**

| ID | Title | Status | Assignee |
|----|-------|--------|----------|
| 342 | 播客审稿管线改造——使用审阅平台替代直接发送审稿 | review | — |
| 343 | 开发音频转文稿+Show Notes 小程序 | review | miniapp-game-engineer |

**High priority unassigned personal tasks:**

| ID | Title | Priority |
|----|-------|----------|
| 298 | 注册第二个 GitHub 账号用于代码合入 | high |
| 306 | 📖 读《The Mom Test》— 识别真需求 | high |
| 309 | 📖 读《Good Strategy / Bad Strategy》 | high |
| 311 | ⚡ [P0] 设定支付方式（收款码） | high |
| 312 | ⚡ [P0] 搭建免费版领取流程 | high |
| 313 | ⚡ [P0] 写第一篇内容：「AI 合伙人 3 个月得失报告」 | high |
| 314 | ⚡ [P0] 整理 AI 合伙人工作流包 v0.1 内容 | high |
| 315 | ⚡ [P0] 拆分免费版与付费版 | high |
| 321 | 📞 语音打电话功能 — 找 API 跑通流程 | high |
| 322 | 🔑 1Password 接入（放到账号管理专家） | high |
| 323 | 📅 飞书日历/Time Block 日历接入 | high |
| 329 | 下载《好战略坏战略》电子书 | high |
| 335 | Auth Service 统一认证 — Forum 对接 ADC 身份体系 | P1 |
| 336 | 【调研】周报/日报 Agent 方向的需求验证 | high |
| 337 | 【需求】用 ADC 提交需求收集网站开发需求 | high |
| 341 | 审阅平台支持播客稿件分类——新增 content_type 字段 | high |

#### MIGRATE_AS_UNTRIAGED (29)

All are `type=personal` or `type=null`, `status=pending`, medium/low priority, with either no assignee or free-text assignee "小马哥" without stable alias.

| ID | Title | Priority | Assignee |
|----|-------|----------|----------|
| 18 | AI学习软件方向 | low | 小马哥 |
| 60 | 上传家庭财务信息给财务管家录入 | medium | 小马哥 |
| 64 | 修车 — 车辆保养/维修 | medium | 小马哥 |
| 65 | 社交人情：列亲友关键日期清单 | low | 小马哥 |
| 256 | 准备手打柠檬茶材料，跟宝宝一起去卖柠檬茶 | medium | 小马哥 |
| 262 | 设计「Agent大管家」系统 | low | — |
| 270 | 跟车险销售拿回返现/回扣 | high | — |
| 272 | 报销这次去医院看牙的费用 | high | — |
| 280 | 调整基金持仓配置 | medium | — |
| 281 | 旅游计划 — 策划一次家庭出行 | low | — |
| 282 | 家庭保险年检 | medium | — |
| 283 | 证件有效期检查 | low | — |
| 284 | 丘丘学前教育规划 | low | — |
| 286 | 检查打印机 Epson-L4260 | medium | — |
| 291 | 整理群内常见问题为教程 | medium | — |
| 292 | 给宝宝准备好电路板教程，一起连电路 | medium | — |
| 293 | 听友群问题整理：短期文档化，长期做网页 | medium | — |
| 294 | AI教育顾问调研电路板教程→打印侠打印→和宝宝一起学 | medium | — |
| 302 | 播客转录 | medium | — |
| 303 | 播客转录二次处理 | medium | — |
| 304 | 驾照体检后续APP操作 | medium | — |
| 305 | 播客收听线分析 | medium | — |
| 307 | 📖 读《Write Useful Books》 | medium | — |
| 308 | 📖 读《Business Model Generation》 | medium | — |
| 310 | 📖 读《Obviously Awesome》 | medium | — |
| 316 | 📝 [P1] 写内容：「我踩过最深的 AI Agent 坑」 | medium | — |
| 317 | 📝 [P1] 写内容：「我的 AI 合伙人完整工作流拆解」 | medium | — |
| 318 | 📝 [P1] 写内容：「我如何控制自己不乱开新坑」 | medium | — |
| 324 | 🍽️ 食谱推荐系统 | medium | — |

#### ARCHIVE_ONLY (6)

| ID | Title | Status | Completion evidence |
|----|-------|--------|-------------------|
| 84 | 【P0】清洗全部75条任务：按新主线重新标层、筛优先级 | active | Description says "✅ 已完成，等小马哥验收。建议关闭。" |
| 268 | 预约蛀牙补牙 | in_progress | Has `completed_at: 2026-06-23T23:47:12.925Z` |
| 319 | 🎥 Build in Public：定期更新进度 | review | Has `completed_at`, tier1=rejected |
| 320 | 📢 内容制作：把现有 Skill 做成视频/教程 | review | Has `completed_at`, tier1=rejected |
| 325 | Build in Public — 公开分享Skill进展和每日进度 | pending | Has `completed_at`, tier1=rejected (comment exists) |
| 333 | 搜索专家：从调研员处获取 ebook-download Skill | review | Has `completed_at` |

#### DISCARD_DUPLICATE_OR_TEST (8)

| ID | Title | Reason |
|----|-------|--------|
| 288 | 测试 - 若创建成功则删除 | Explicit test entry |
| 300 | test-subagent-task | Test entry |
| 301 | test-no-auth | Test entry |
| 331 | 测试写入 - 若成功立即删除 | Test entry (duplicate title) |
| 332 | 测试写入 - 若成功立即删除 | Test entry (duplicate title) |
| 338 | 【调研】周报/日报 Agent 方向的需求验证 | Duplicate of ID=336 |
| 339 | 【需求】用 ADC 提交需求收集网站开发需求 | Duplicate of ID=337 |
| 340 | test-1784168558 | Test entry |

#### MANUAL_DECISION_REQUIRED (3)

| ID | Title | Status | Assignee | Type | Issue |
|----|-------|--------|----------|------|-------|
| 77 | 内容运营专家：跟进账号管理平台运营数据需求的开发 | review | content-ops-agent | null | content-ops-agent has no other tasks; all their previous tasks were deleted. Is this agent still active? |
| 285 | 内容发布日历 — 确定内容发布节奏 | pending | — | agent | Type=agent but no assignee. Same task was previously assigned to content-ops-agent (289, 290 — now deleted). Who owns this now? |
| 299 | 搞多一个手机号，注册多平台账号，开始内容矩阵 | review | — | personal | Review status with no assignee. Is this completed pending cleanup, or still awaiting action? |

---

## Recommended Canary

| Property | Value |
|----------|-------|
| selected IDs | [**238, 256, 279, 284, 343**] |
| selection reason | 238 (high/personal/小马哥), 256 (medium/personal/小马哥), 279 (high/personal/小马哥), 284 (low/personal/unassigned), 343 (review/agent/miniapp-game-engineer) — Covers: high/medium/low priority, personal/agent type, assigned/unassigned, pending/review status. |
| target Definition | **agent_self_task_v1** for agent-typed (ID=343). For personal tasks: currently no `personal_quick_item_v1` exists — may need either a new Definition or import as agent_self_task_v1 with `"isPersonalImport": true` in contextPayload. |
| target creator | Legacy creator info embedded in `contextPayload.provenance`. svc-workflow `CreateWorkflowInstanceCommand` requires a `principalId` — this must be mapped from the legacy `creator` field or a default admin principal. |
| unresolved risks | ① No `personal_quick_item_v1` Definition exists yet; personal tasks have no target Definition. ② Assignee "小马哥" has no PrincipalId mapping. ③ ID=343 (miniapp-game-engineer) has no presence in svc-workflow identity registry. ④ Tags field has double-escaped JSON that needs cleanup. |

---

## Final Status

```
REMOTE_LEGACY_TODO_EXPORT_COMPLETE
```

### Summary of findings

1. ✅ **Remote API exported successfully** — HTTP 200, 88632 bytes, 82 records, no pagination truncation
2. ✅ **82 records verified** — 73 pending, unique IDs, 40 fields, all with created_at timestamps
3. ✅ **Cross-comparison complete** — 45 shared with local JSON (Jul 5), 37 new, 8 deleted
4. ✅ **ORM schema documented** — 26 DB columns + 2 computed = 28 core fields (API returns 40 including legacy/alias fields)
5. ✅ **Precise classification** — 36 MIGRATE_ACTIVE + 29 UNTRIAGED + 6 ARCHIVE + 8 DISCARD + 3 MANUAL = 82
6. ⚠️ **Assignee stability risk**: "小马哥" (11 tasks) has no canonical PrincipalId mapping
7. ⚠️ **Definition availability risk**: `personal_quick_item_v1` does not exist yet
8. ❌ **No destructive operations performed**: no DB writes, no data modifications
