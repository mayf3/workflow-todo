# Auth Package Distribution Evidence

## Package Identity

| Field | Value |
|---|---|
| **AUTH_CLIENT_PACKAGE** | `@unified-auth/machine-token-provider` |
| **AUTH_CLIENT_VERSION** | `1.0.0` |
| **AUTH_CLIENT_SOURCE_HEAD** | `aee5250578640b73bc3b938655a7937b23b7d3cc` |
| **AUTH_CLIENT_SOURCE_TREE** | `2b0f04a5347cd9f9e657b7c0280abf642a67e8bd` |
| **AUTH_CLIENT_PACKAGE_DIGEST** | `79bc3a22a94da484b63580b07b2eb4328a8da76a7a581e44320b1eab9462fae3` |
| **AUTH_CONTRACT_VERSION** | `1.0.0` |
| **AUTH_CONTRACT_DIGEST** | `aff4f35b09b887eb8e83ffcd44eb4d487099d5f8911027cda172fce317dc9715` (aligns with workflow contract digest) |

## Build Environment

| Field | Value |
|---|---|
| **BUILD_COMMAND** | `npm run build` (which runs `tsc` per package.json) |
| **NODE_VERSION** | `v25.6.1` |
| **NPM_VERSION** | `11.9.0` |
| **OS** | darwin arm64 |

## Tarball

| Field | Value |
|---|---|
| **Filename** | `unified-auth-machine-token-provider-1.0.0.tgz` |
| **SHA-256** | `79bc3a22a94da484b63580b07b2eb4328a8da76a7a581e44320b1eab9462fae3` |
| **Size** | 14.0 kB (packed), 56.4 kB (unpacked) |

## Source Verification

The package was built from the auth-service repository at pinned commit:

```
AUTH_SERVICE_MAINLINE_HEAD=aee5250578640b73bc3b938655a7937b23b7d3cc
AUTH_SERVICE_MAINLINE_TREE=2b0f04a5347cd9f9e657b7c0280abf642a67e8bd
```

Build steps:
1. `git checkout aee5250578640b73bc3b938655a7937b23b7d3cc`
2. `cd packages/machine-token-provider`
3. `npm install` (dependencies already installed)
4. `npm run build` → TypeScript compilation via `tsc`
5. `npm pack` → produces `unified-auth-machine-token-provider-1.0.0.tgz`
6. `shasum -a 256 unified-auth-machine-token-provider-1.0.0.tgz` → `79bc3a22a94da484b63580b07b2eb4328a8da76a7a581e44320b1eab9462fae3`

## Digest Verification

```console
$ shasum -a 256 unified-auth-machine-token-provider-1.0.0.tgz
79bc3a22a94da484b63580b07b2eb4328a8da76a7a581e44320b1eab9462fae3  unified-auth-machine-token-provider-1.0.0.tgz
```

Expected digest: `79bc3a22a94da484b63580b07b2eb4328a8da76a7a581e44320b1eab9462fae3`

**Result: MATCH** — digest matches the upstream declaration.

## Installation

The tarball is installed as a `file:` dependency in `package.json`:

```json
"@unified-auth/machine-token-provider": "file:sdk-packages/unified-auth-machine-token-provider-1.0.0.tgz"
```
