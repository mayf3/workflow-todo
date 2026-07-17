/**
 * legacy-import: canary manifest validation and import tool.
 *
 * Only accepts:
 *   schemaVersion = personal-quick-item-canary-v1
 *   max 5 items
 *   targetDefinitionKey = personal_quick_item_v1
 *   targetDefinitionVersion = 1
 *
 * Calls svc-workflow Create API for each item with the configured
 * LEGACY_IMPORT_ACCESS_TOKEN (never falls back to SVC_WORKFLOW_ACCESS_TOKEN).
 *
 * Pre-import validations:
 *   - source snapshot SHA-256 matches raw file bytes
 *   - definition version is PUBLISHED, correct key, version 1
 *   - JWT sub matches LEGACY_IMPORT_EXPECTED_PRINCIPAL_ID
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { env } from './config.js';
import { WorkflowClient, WorkflowError } from './client.js';
import { sha256FileBytes } from './digest.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanaryManifest {
  schemaVersion: string;
  recordDigestAlgorithm: string;
  sourceDigestAlgorithm: string;
  batchId: string;
  sourceSnapshotSha256: string;
  targetDefinitionKey: string;
  targetDefinitionVersion: number;
  items: CanaryManifestItem[];
}

export interface CanaryManifestItem {
  legacyTodoId: string;
  legacyRecordSha256: string;
  mappingDecision: string;
  targetCreatorPrincipalRef: string;
  idempotencyKey: string;
  context: CanaryContext;
}

export interface CanaryContext {
  title: string;
  description?: string | null;
  priority?: string | null;
  legacyProvenance: LegacyProvenance;
}

export interface LegacyProvenance {
  source: string;
  legacyTodoId: string;
  legacyRecordSha256: string;
  sourceSnapshotSha256: string;
  legacyStatus?: string | null;
  legacyCreatedAt?: string | null;
  legacyDueDate?: string | null;
  importBatchId: string;
  importedAt: string;
}

export interface ImportResult {
  legacyTodoId: string;
  status: 'succeeded' | 'error';
  workflowInstanceId?: string;
  receiptId?: string;
  sameInstanceAsPrevious?: boolean;
  workflowStateVersion?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_SCHEMA_VERSION = 'personal-quick-item-canary-v1';
const ALLOWED_DEFINITION_KEY = 'personal_quick_item_v1';
const ALLOWED_DEFINITION_VERSION = 1;
const MAX_ITEMS = 5;
const ALLOWED_SOURCES = ['llm-todo'] as const;
const ALLOWED_DECISIONS = ['REONBOARD_AS_PERSONAL_QUICK_ITEM'] as const;
const ALLOWED_PRIORITIES = ['high', 'medium', 'low', null] as const;
const ALLOWED_PRINCIPAL_REFS = ['DOGFOOD_USER'] as const;
const IDEMPOTENCY_KEY_PREFIX = 'legacy-llm-todo:';

const DIGEST_ALGORITHM_RECORD = 'sha256-rfc8785-jcs-full-record-v1';
const DIGEST_ALGORITHM_SOURCE = 'sha256-file-bytes-v1';

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

export class SourceDigestMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `SOURCE_SNAPSHOT_DIGEST_MISMATCH: expected=${expected.slice(0, 12)}… actual=${actual.slice(0, 12)}…`,
    );
    this.name = 'SourceDigestMismatchError';
  }
}

export class TokenSubjectMismatchError extends Error {
  constructor(expected: string, actual: string | undefined) {
    super(`TOKEN_SUBJECT_MISMATCH: expected=${expected} sub=${actual ?? '(missing)'}`);
    this.name = 'TokenSubjectMismatchError';
  }
}

export class DefinitionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionValidationError';
  }
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

export function validateManifest(data: unknown): CanaryManifest {
  if (typeof data !== 'object' || data === null) {
    throw new ManifestValidationError('Manifest must be a JSON object');
  }

  const manifest = data as Record<string, unknown>;

  if (manifest.schemaVersion !== ALLOWED_SCHEMA_VERSION) {
    throw new ManifestValidationError(
      `schemaVersion must be "${ALLOWED_SCHEMA_VERSION}", got "${String(manifest.schemaVersion)}"`,
    );
  }

  // Digest algorithms
  if (manifest.recordDigestAlgorithm !== DIGEST_ALGORITHM_RECORD) {
    throw new ManifestValidationError(
      `recordDigestAlgorithm must be "${DIGEST_ALGORITHM_RECORD}", got "${String(manifest.recordDigestAlgorithm)}"`,
    );
  }
  if (manifest.sourceDigestAlgorithm !== DIGEST_ALGORITHM_SOURCE) {
    throw new ManifestValidationError(
      `sourceDigestAlgorithm must be "${DIGEST_ALGORITHM_SOURCE}", got "${String(manifest.sourceDigestAlgorithm)}"`,
    );
  }

  if (typeof manifest.batchId !== 'string' || manifest.batchId.length === 0) {
    throw new ManifestValidationError('batchId must be a non-empty string');
  }

  if (typeof manifest.sourceSnapshotSha256 !== 'string' || manifest.sourceSnapshotSha256.length !== 64) {
    throw new ManifestValidationError('sourceSnapshotSha256 must be a 64-char hex string');
  }

  if (manifest.targetDefinitionKey !== ALLOWED_DEFINITION_KEY) {
    throw new ManifestValidationError(
      `targetDefinitionKey must be "${ALLOWED_DEFINITION_KEY}", got "${String(manifest.targetDefinitionKey)}"`,
    );
  }

  if (manifest.targetDefinitionVersion !== ALLOWED_DEFINITION_VERSION) {
    throw new ManifestValidationError(
      `targetDefinitionVersion must be ${ALLOWED_DEFINITION_VERSION}, got ${String(manifest.targetDefinitionVersion)}`,
    );
  }

  const items = manifest.items;
  if (!Array.isArray(items)) {
    throw new ManifestValidationError('items must be an array');
  }
  if (items.length === 0) {
    throw new ManifestValidationError('items array must not be empty');
  }
  if (items.length > MAX_ITEMS) {
    throw new ManifestValidationError(`items array must have at most ${MAX_ITEMS} items, got ${items.length}`);
  }

  for (const item of items) {
    validateItem(item);
  }

  return manifest as unknown as CanaryManifest;
}

function validateItem(item: unknown): asserts item is CanaryManifestItem {
  if (typeof item !== 'object' || item === null) {
    throw new ManifestValidationError('Each item must be an object');
  }
  const i = item as Record<string, unknown>;

  if (typeof i.legacyTodoId !== 'string' || i.legacyTodoId.length === 0) {
    throw new ManifestValidationError('legacyTodoId must be a non-empty string');
  }
  if (typeof i.legacyRecordSha256 !== 'string' || i.legacyRecordSha256.length !== 64) {
    throw new ManifestValidationError(
      `legacyRecordSha256 must be a 64-char hex string for item ${i.legacyTodoId}`,
    );
  }
  if (!ALLOWED_DECISIONS.includes(i.mappingDecision as typeof ALLOWED_DECISIONS[number])) {
    throw new ManifestValidationError(
      `mappingDecision must be one of ${ALLOWED_DECISIONS.join(', ')}, got "${String(i.mappingDecision)}" for item ${i.legacyTodoId}`,
    );
  }
  if (!ALLOWED_PRINCIPAL_REFS.includes(i.targetCreatorPrincipalRef as typeof ALLOWED_PRINCIPAL_REFS[number])) {
    throw new ManifestValidationError(
      `targetCreatorPrincipalRef must be one of ${ALLOWED_PRINCIPAL_REFS.join(', ')}, got "${String(i.targetCreatorPrincipalRef)}" for item ${i.legacyTodoId}`,
    );
  }
  if (typeof i.idempotencyKey !== 'string') {
    throw new ManifestValidationError(`idempotencyKey must be a string for item ${i.legacyTodoId}`);
  }
  const expectedKey = `${IDEMPOTENCY_KEY_PREFIX}${i.legacyTodoId}`;
  if (i.idempotencyKey !== expectedKey) {
    throw new ManifestValidationError(
      `idempotencyKey must be "${expectedKey}" for legacyTodoId ${i.legacyTodoId}, got "${i.idempotencyKey}"`,
    );
  }
  if (typeof i.context !== 'object' || i.context === null) {
    throw new ManifestValidationError(`context must be an object for item ${i.legacyTodoId}`);
  }
  validateContext(i.context as Record<string, unknown>, String(i.legacyTodoId));
}

function validateContext(ctx: Record<string, unknown>, itemId: string): void {
  if (typeof ctx.title !== 'string' || ctx.title.length === 0) {
    throw new ManifestValidationError(`context.title must be a non-empty string for item ${itemId}`);
  }
  if (ctx.title.length > 200) {
    throw new ManifestValidationError(`context.title must be at most 200 characters for item ${itemId}`);
  }
  if (ctx.description !== undefined && ctx.description !== null) {
    if (typeof ctx.description !== 'string') {
      throw new ManifestValidationError(`context.description must be a string or null for item ${itemId}`);
    }
    if (ctx.description.length > 2000) {
      throw new ManifestValidationError(`context.description must be at most 2000 characters for item ${itemId}`);
    }
  }
  if (ctx.priority !== undefined && ctx.priority !== null) {
    if (!ALLOWED_PRIORITIES.includes(ctx.priority as typeof ALLOWED_PRIORITIES[number])) {
      throw new ManifestValidationError(
        `context.priority must be one of ${ALLOWED_PRIORITIES.filter(p => p !== null).join(', ')} or null for item ${itemId}`,
      );
    }
  }
  if (typeof ctx.legacyProvenance !== 'object' || ctx.legacyProvenance === null) {
    throw new ManifestValidationError(`context.legacyProvenance must be an object for item ${itemId}`);
  }
  validateProvenance(ctx.legacyProvenance as Record<string, unknown>, itemId);
}

function validateProvenance(prov: Record<string, unknown>, itemId: string): void {
  const requiredFields = ['source', 'legacyTodoId', 'legacyRecordSha256', 'sourceSnapshotSha256', 'importBatchId', 'importedAt'];
  for (const name of requiredFields) {
    if (typeof prov[name] !== 'string') {
      throw new ManifestValidationError(`context.legacyProvenance.${name} must be a string for item ${itemId}`);
    }
  }
  if (!ALLOWED_SOURCES.includes(prov.source as typeof ALLOWED_SOURCES[number])) {
    throw new ManifestValidationError(
      `context.legacyProvenance.source must be one of ${ALLOWED_SOURCES.join(', ')} for item ${itemId}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Source snapshot validation
// ---------------------------------------------------------------------------

export function validateSourceDigest(sourcePath: string, expectedSha256: string): void {
  const content = readFileSync(sourcePath);
  const actual = sha256FileBytes(content);
  if (actual !== expectedSha256) {
    throw new SourceDigestMismatchError(expectedSha256, actual);
  }
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

export function validateTokenSubject(token: string, expectedPrincipalId: string): void {
  // Decode JWT payload without verifying signature (verification is done by svc-workflow)
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenSubjectMismatchError(expectedPrincipalId, undefined);
  }
  let payload: string;
  try {
    const b64 = parts[1];
    const normalized = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
    payload = Buffer.from(normalized, 'base64').toString('utf-8');
  } catch {
    throw new TokenSubjectMismatchError(expectedPrincipalId, undefined);
  }
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(payload);
  } catch {
    throw new TokenSubjectMismatchError(expectedPrincipalId, undefined);
  }
  const sub = claims.sub;
  if (typeof sub !== 'string' || sub !== expectedPrincipalId) {
    throw new TokenSubjectMismatchError(expectedPrincipalId, sub as string | undefined);
  }
}

// ---------------------------------------------------------------------------
// Definition version validation
// ---------------------------------------------------------------------------

export interface DefinitionVersionInfo {
  definitionKey: string;
  versionNumber: number;
  versionStatus: string;
  canCreateInstances: boolean;
}

export async function validateDefinitionVersion(
  baseUrl: string,
  accessToken: string,
  definitionVersionId: string,
): Promise<DefinitionVersionInfo> {
  const url = new URL(
    `/internal/v1/admin/definition-versions/${encodeURIComponent(definitionVersionId)}`,
    baseUrl,
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new DefinitionValidationError(
      `Definition version query failed: HTTP ${response.status}`,
    );
  }

  const info: DefinitionVersionInfo = await response.json();

  if (info.definitionKey !== ALLOWED_DEFINITION_KEY) {
    throw new DefinitionValidationError(
      `Definition key mismatch: expected="${ALLOWED_DEFINITION_KEY}" actual="${info.definitionKey}"`,
    );
  }
  if (info.versionNumber !== ALLOWED_DEFINITION_VERSION) {
    throw new DefinitionValidationError(
      `Definition version mismatch: expected=${ALLOWED_DEFINITION_VERSION} actual=${info.versionNumber}`,
    );
  }
  if (info.versionStatus !== 'PUBLISHED') {
    throw new DefinitionValidationError(
      `Definition version is not PUBLISHED: status="${info.versionStatus}"`,
    );
  }

  return info;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportOptions {
  domainId: string;
  definitionVersionId: string;
  accessToken: string;
  baseUrl: string;
}

export async function importManifest(
  manifest: CanaryManifest,
  options: ImportOptions,
): Promise<ImportResult[]> {
  const client = new WorkflowClient({
    baseUrl: options.baseUrl,
    accessTokenProvider: () => options.accessToken,
    requestTimeoutMs: parseInt(env.REQUEST_TIMEOUT_MS, 10),
    maxAttempts: parseInt(env.MAX_ATTEMPTS, 10),
  });

  const results: ImportResult[] = [];

  for (const item of manifest.items) {
    try {
      const input = {
        domainId: options.domainId,
        definitionVersionId: options.definitionVersionId,
        metadata: {
          legacyImport: true,
          importBatchId: manifest.batchId,
          legacyTodoId: item.legacyTodoId,
        },
        contextPayload: item.context as unknown as import('./contracts.js').JsonValue,
      };

      const receipt = await client.create(input, {
        idempotencyKey: item.idempotencyKey,
      });

      // svc-workflow Create API returns HTTP 201 for both first create
      // and idempotent replay of the same request. We cannot distinguish
      // from the response alone. We report "succeeded" with the instance ID.
      results.push({
        legacyTodoId: item.legacyTodoId,
        status: 'succeeded',
        workflowInstanceId: receipt.workflowInstanceId,
        receiptId: undefined, // svc-workflow doesn't expose receipt ID in response
        sameInstanceAsPrevious: undefined, // server doesn't signal this
        workflowStateVersion: receipt.workflowStateVersion,
      });
    } catch (error) {
      if (error instanceof WorkflowError) {
        results.push({
          legacyTodoId: item.legacyTodoId,
          status: 'error',
          error: `WorkflowError: [${error.code ?? 'unknown'}] ${error.message}`,
        });
      } else {
        results.push({
          legacyTodoId: item.legacyTodoId,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Secret scanning
// ---------------------------------------------------------------------------

export function scanForSecrets(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const warnings: string[] = [];

  const secretPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, label: 'JWT token' },
    { pattern: /(password|passwd|pwd|secret|token|api[-_]?key)\s*[:=]\s*['"][^'"]+/gi, label: 'credential' },
    { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, label: 'private key' },
    { pattern: /postgres:\/\/[^@]+:[^@]+@/g, label: 'database URL with password' },
    { pattern: /\bBearer\s+/g, label: 'Bearer token prefix in content' },
  ];

  for (const { pattern, label } of secretPatterns) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      warnings.push(`Potential ${label} found in manifest (${matches.length} match(es))`);
    }
  }

  return warnings;
}
