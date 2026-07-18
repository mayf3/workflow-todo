# workflow-todo CLI 简洁输出 V0 实施报告

## Git

| Field | Value |
|---|---|
| base | `672025c34a4865cbd2f83621dad7b829d296ae19` (main) |
| branch | `feat/cli-readable-output-v0` |
| push | 否 |

## Output Contract

| Requirement | Result |
|---|---|
| default mode | ✅ 简洁文本 |
| `--json` mode | ✅ 完整 JSON 输出 |
| JSON stdout purity | ✅ 日志/提示写入 stderr，管道兼容 |
| missing field handling | ✅ 不打印 `undefined`/`[object Object]` |

## Commands

### my-worklist

| Feature | Status |
|---|---|
| text: 标题、Node、Instance、Created | ✅ |
| text: Priority 可选显示 | ✅ |
| text: 空列表 → `No work items...` | ✅ |
| `--json`: 完整原始 JSON | ✅ |

### detail

| Feature | Status |
|---|---|
| text: title、Instance、Definition、node、state version | ✅ |
| text: Description | ✅ |
| text: Acceptance criteria (agent_self_task_v1) | ✅ |
| text: Available transitions | ✅ |
| text: historical visibility | ✅ |
| `--json`: 完整原始 JSON | ✅ |

### advance

| Feature | Status |
|---|---|
| text: Transition succeeded + Instance + state version + event | ✅ |
| `--json`: 完整原始 JSON | ✅ |
| read-before-write preserved | ✅ |

## Regression

| Metric | Value |
|---|---|
| previous tests | 55 (client 6 + legacy-import 49) |
| new tests | 17 (formatters) |
| total | **72** |
| passed | **72** |
| build | **TypeScript 0 errors** |

## Dogfood

| Check | Result |
|---|---|
| DOGFOOD_USER: 3 personal_quick_item items | ✅ 简洁显示标题/Node/Instance/Priority |
| JSON + jq pipe | ✅ `JSON.parse()` 成功 |
| detail: provenance fields visible | ✅ |
| state mutations performed | 否（仅执行 `my-worklist` 和 `detail`） |

## Scope

| Requirement | Result |
|---|---|
| svc-workflow changes | 无 |
| DB changes | 无 |
| workflow semantic changes | 无 |
| Definition changes | 无 |
| push/tag | 无 |

## Final Status

```
WORKFLOW_TODO_CLI_READABLE_OUTPUT_READY_FOR_AUDIT
```
