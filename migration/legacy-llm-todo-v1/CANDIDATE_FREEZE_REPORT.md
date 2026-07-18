# personal_quick_item Legacy Canary 候选冻结报告

## Git

| Field | Value |
|---|---|
| repo | `/Users/yanfenma/workspace/project/workflow-todo` |
| branch | `feat/personal-quick-item-legacy-canary-v0` |
| previous HEAD | `35b37108ac206f0192c11fefe7f3eb1775bb94ed` |
| candidate SHA | `672025c34a4865cbd2f83621dad7b829d296ae19` |
| candidate tree | `00aba5f99a9adaccbac075d4ddc779cb9bf30bbd` |
| audited tree | `58101b1280b771b76ca49342fe1ec0eadd194a4a` (base) |
| tree match | 审计 tree 为 **base** tree；commit tree 包含全部11个审计文件的增量，不一致为预期 |
| clean | ✅ 工作树 clean（仅含审计无关的预存报告文件） |
| push | 否 |
| tag | 否 |

## Sensitive Files

| Check | Result |
|---|---|
| private/ directory tracked | ❌ 未跟踪（在 `.gitignore` 中） |
| .env tracked | ❌ 未跟踪（在 `.gitignore` 中） |
| raw remote JSON tracked | ❌ 未跟踪 |
| Secret scan | ✅ 无 JWT/密码/Secret |

## Regression

| Check | Result |
|---|---|
| npm ci | ✅ |
| npm test | ✅ **55/55 pass** |
| npm run build | ✅ **TypeScript 0 errors** |

## Changes After Audit

```
NONE
```

未修改产品代码、测试、Manifest 或文档。

## BatchId Debt

审计发现 Manifest `batchId` 每次生成不同，非 byte-for-byte 确定性。已确认为 Medium 债务，本轮不修复。

## Final Status

```
PERSONAL_QUICK_ITEM_CANARY_CANDIDATE_FROZEN
```
