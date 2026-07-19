# Workflow SDK Distribution Reference

## Pinned Source

Reference: `WORKFLOW_MAIN_HEAD` from task specification.

| Field | Value |
|-------|-------|
| Repository | `svc-workflow` |
| Source HEAD | `9f3b4396b8f10444ca6894bae9856e1e2c4e2cae` |
| Source TREE | `2ec471d07a4dbd0a406214dac893ff2fe1272a79` |
| SDK Source TREE | `12d4a6d8d3a9e3134978dc44812dc3c1fefa412e` |

## Build Process

```bash
cd svc-workflow
git checkout 9f3b4396b8f10444ca6894bae9856e1e2c4e2cae
npm ci
npm run build:sdk              # tsc -p tsconfig.sdk.json
npm pack --pack-destination /tmp/
```

## Package

| Field | Value |
|-------|-------|
| Package name | `@workflow-foundation/sdk` |
| Version | `1.0.0` |
| Tarball | `workflow-foundation-sdk-1.0.0.tgz` |
| SHA-256 | `4e3c6d7a8f1399847c95a9dc72599df864804a3e78530a828e7b6c6677c189d5` |
| File count | 31 |
| Unpacked size | 246.4 kB |

## Contract Lock

| Field | Value |
|-------|-------|
| Contract Version | `1.0.0` |
| Bundle Digest | `aff4f35b09b887eb8e83ffcd44eb4d487099d5f8911027cda172fce317dc9715` |
| Owner HEAD SHA | `2dff1320d1488ff4d2137795df1622d61d01c00c` |
| Contract Mainline HEAD | `ae81f1e04d41abba3e2cb957da30fbad4607b43d` |

## Verification

To reproduce this distribution:

```bash
git checkout 9f3b4396b8f10444ca6894bae9856e1e2c4e2cae
npm ci
npm run build:sdk
npm pack --pack-destination /tmp/
shasum -a 256 /tmp/workflow-foundation-sdk-1.0.0.tgz
# Expected: 4e3c6d7a8f1399847c95a9dc72599df864804a3e78530a828e7b6c6677c189d5
```

## Installed Location

In `workflow-todo`, the tarball is committed at `sdk-packages/workflow-foundation-sdk-1.0.0.tgz` and referenced as:

```json
"@workflow-foundation/sdk": "file:./sdk-packages/workflow-foundation-sdk-1.0.0.tgz"
```
