# workflow-todo CLI 简洁输出 V0 合并报告

## Merge

| Field | Value |
|---|---|
| previous main | `672025c34a4865cbd2f83621dad7b829d296ae19` |
| candidate | `e90daac84dd75da042662257d3bc5c3beef80b90` |
| merge method | `--ff-only` (fast-forward) |
| final main | `e90daac84dd75da042662257d3bc5c3beef80b90` |
| final tree | `a13ba8db0e1e2bc61115b461d97fa74c5f8401b1` |
| tracked clean | ✅ |
| push | 否 |
| tag | 否 |

## Regression

| Check | Result |
|---|---|
| npm ci | ✅ |
| tests | ✅ **95/95 pass** |
| build | ✅ **TypeScript 0 errors** |
| cli.ts lines | **387** |
| cli-args.ts lines | **128** |
| formatters.ts lines | **198** |

## DOGFOOD_USER

| Check | Result |
|---|---|
| text count | 3 items |
| JSON count | 3 items |
| personal items | ✅ 3× `personal_quick_item_v1` at Open |
| detail text | ✅ shows title/description/transitions |
| detail JSON | ✅ `visibility=full`, parseable |

## Efficiency Manager

| Check | Result |
|---|---|
| Principal | `10000000-0000-0000-0000-000000000020` |
| text count | 5 items |
| JSON count | 5 items |
| cross-principal isolation | ✅ efficiency sees different items than DOGFOOD_USER |

## State Mutation

```
NONE
```

## Deferred Debt

| Item | Priority |
|------|----------|
| detail timeline | LOW |
| advance from→to | LOW |

## Final Status

```
WORKFLOW_TODO_CLI_READABLE_OUTPUT_MAIN_READY
```
