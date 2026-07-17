import { describe, expect, it, beforeAll } from 'vitest';
import {
  validateManifest,
  scanForSecrets,
  validateSourceDigest,
  validateTokenSubject,
  ManifestValidationError,
  SourceDigestMismatchError,
  TokenSubjectMismatchError,
} from '../src/legacy-import.js';
import { sha256Jcs, sha256FileBytes } from '../src/digest.js';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validManifest(): any {
  return {
    schemaVersion: 'personal-quick-item-canary-v1',
    recordDigestAlgorithm: 'sha256-rfc8785-jcs-full-record-v1',
    sourceDigestAlgorithm: 'sha256-file-bytes-v1',
    batchId: 'dcc51e54-28d8-43ad-89cd-cfa4995fe75f',
    sourceSnapshotSha256: '284fe44af048d7aa453dae4385fae6e25730f9ed97e92516d44b4bda60fbbf3f',
    targetDefinitionKey: 'personal_quick_item_v1',
    targetDefinitionVersion: 1,
    items: [
      {
        legacyTodoId: '238',
        legacyRecordSha256: '8b0aebe8ec22a5257ef16b14ed0dfd2c9767837ff2a3f5eeed2772bbabe6ef08',
        mappingDecision: 'REONBOARD_AS_PERSONAL_QUICK_ITEM',
        targetCreatorPrincipalRef: 'DOGFOOD_USER',
        idempotencyKey: 'legacy-llm-todo:238',
        context: {
          title: '把公司报销条例和平台信息发给报销专家',
          description: '#115的前置任务',
          priority: 'high',
          legacyProvenance: {
            source: 'llm-todo',
            legacyTodoId: '238',
            legacyRecordSha256: '8b0aebe8ec22a5257ef16b14ed0dfd2c9767837ff2a3f5eeed2772bbabe6ef08',
            sourceSnapshotSha256: '284fe44af048d7aa453dae4385fae6e25730f9ed97e92516d44b4bda60fbbf3f',
            legacyStatus: 'pending',
            legacyCreatedAt: '2026-05-27 11:12:28',
            legacyDueDate: null,
            importBatchId: 'dcc51e54-28d8-43ad-89cd-cfa4995fe75f',
            importedAt: '2026-07-17T14:01:41Z',
          },
        },
      },
    ],
  };
}

const SOURCE_PATH = resolve(
  __dirname, '..',
  'migration', 'legacy-llm-todo-v1', 'private', 'remote-todos-raw.json',
);

// ---------------------------------------------------------------------------
// Definition structure tests
// ---------------------------------------------------------------------------

describe('personal_quick_item_v1 Definition', () => {
  const defPath = resolve(__dirname, '..', 'definitions', 'personal-quick-item-v1.json');

  it('definition file exists', () => {
    expect(existsSync(defPath)).toBe(true);
  });

  it('has exactly 3 nodes and 2 transitions', () => {
    const content = JSON.parse(readFileSync(defPath, 'utf-8'));
    expect(content.nodes).toHaveLength(3);
    expect(content.transitions).toHaveLength(2);
  });

  it('open node uses WORKFLOW_CREATOR and DRAFT type', () => {
    const content = JSON.parse(readFileSync(defPath, 'utf-8'));
    const openNode = content.nodes.find((n: { nodeKey: string }) => n.nodeKey === 'open');
    expect(openNode.assigneeRefType).toBe('WORKFLOW_CREATOR');
    expect(openNode.nodeType).toBe('DRAFT');
  });

  it('completed and cancelled are TERMINAL', () => {
    const content = JSON.parse(readFileSync(defPath, 'utf-8'));
    const completed = content.nodes.find((n: { nodeKey: string }) => n.nodeKey === 'completed');
    const cancelled = content.nodes.find((n: { nodeKey: string }) => n.nodeKey === 'cancelled');
    expect(completed.nodeType).toBe('TERMINAL');
    expect(cancelled.nodeType).toBe('TERMINAL');
  });

  it('transitions are ADVANCE and TERMINATE', () => {
    const content = JSON.parse(readFileSync(defPath, 'utf-8'));
    const adv = content.transitions.find(
      (t: { sourceNodeKey: string; targetNodeKey: string }) =>
        t.sourceNodeKey === 'open' && t.targetNodeKey === 'completed',
    );
    const term = content.transitions.find(
      (t: { sourceNodeKey: string; targetNodeKey: string }) =>
        t.sourceNodeKey === 'open' && t.targetNodeKey === 'cancelled',
    );
    expect(adv.transitionEffect).toBe('ADVANCE');
    expect(term.transitionEffect).toBe('TERMINATE');
  });
});

// ---------------------------------------------------------------------------
// Digest tests
// ---------------------------------------------------------------------------

describe('sha256Jcs (RFC 8785)', () => {
  it('computes deterministic SHA-256 from JCS canonical JSON', () => {
    const obj = { b: 2, a: 1, c: [3, 2, 1] };
    const d1 = sha256Jcs(obj);
    const d2 = sha256Jcs(obj);
    expect(d1).toBe(d2); // deterministic
    expect(d1).toHaveLength(64); // hex
  });

  it('is independent of key insertion order', () => {
    const a = { b: 2, a: 1 };
    const b = { a: 1, b: 2 };
    expect(sha256Jcs(a)).toBe(sha256Jcs(b));
  });

  it('produces the same digest for deep equal objects', () => {
    const obj1 = { items: [{ id: 1, name: 'test' }], count: 1 };
    const obj2 = { count: 1, items: [{ name: 'test', id: 1 }] };
    expect(sha256Jcs(obj1)).toBe(sha256Jcs(obj2));
  });

  it('canonicalizes null and array values correctly', () => {
    const obj = { a: null, b: [true, false, null] };
    expect(() => sha256Jcs(obj)).not.toThrow();
  });
});

describe('sha256FileBytes', () => {
  it('computes SHA-256 of raw file bytes', () => {
    const buffer = Buffer.from('hello', 'utf-8');
    const digest = sha256FileBytes(buffer);
    expect(digest).toHaveLength(64);
    expect(digest).toBe(sha256FileBytes(Buffer.from('hello', 'utf-8')));
  });

  it('changes when a single byte changes', () => {
    const d1 = sha256FileBytes(Buffer.from('hello', 'utf-8'));
    const d2 = sha256FileBytes(Buffer.from('hEllo', 'utf-8'));
    expect(d1).not.toBe(d2);
  });
});

// ---------------------------------------------------------------------------
// Record digest: independence from legacy data
// ---------------------------------------------------------------------------

describe('source file digest verification', () => {
  it('source file exists', () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it('source file has the expected SHA-256 prefix (284fe4...)', () => {
    const sourceBuffer = readFileSync(SOURCE_PATH);
    const digest = sha256FileBytes(sourceBuffer);
    expect(digest.startsWith('284fe4')).toBe(true);
  });

  it('modifying source file byte changes digest', () => {
    const sourceBuffer = readFileSync(SOURCE_PATH);
    const original = sha256FileBytes(sourceBuffer);

    // Modify last byte
    const modified = Buffer.from(sourceBuffer);
    modified[modified.length - 1] = modified[modified.length - 1] ^ 0x01;
    const modifiedDigest = sha256FileBytes(modified);
    expect(original).not.toBe(modifiedDigest);
  });

  it('validateSourceDigest passes for correct file', () => {
    const sourceBuffer = readFileSync(SOURCE_PATH);
    const digest = sha256FileBytes(sourceBuffer);
    expect(() => validateSourceDigest(SOURCE_PATH, digest)).not.toThrow();
  });

  it('validateSourceDigest fails for wrong digest', () => {
    const fake = 'f'.repeat(64);
    expect(() => validateSourceDigest(SOURCE_PATH, fake)).toThrow(SourceDigestMismatchError);
  });
});

describe('record digest matches full raw record (JCS canonicalization)', () => {
  it('can reproduce record digests from the generated manifest', () => {
    const manifestPath = resolve(
      __dirname, '..',
      'migration', 'legacy-llm-todo-v1', 'generated', 'personal-quick-item-canary-v1.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const sourceData = JSON.parse(readFileSync(SOURCE_PATH, 'utf-8'));
    const todos = sourceData.todos as Array<Record<string, unknown>>;

    for (const item of manifest.items) {
      const id = parseInt(item.legacyTodoId, 10);
      const record = todos.find((t: Record<string, unknown>) => t.id === id);
      expect(record).toBeDefined();
      const computedDigest = sha256Jcs(record);
      expect(computedDigest).toBe(item.legacyRecordSha256);
    }
  });

  it('modifying a record field produces a different digest', () => {
    const sourceData = JSON.parse(readFileSync(SOURCE_PATH, 'utf-8'));
    const todos = sourceData.todos as Array<Record<string, unknown>>;
    const record256 = todos.find((t: Record<string, unknown>) => t.id === 256)!;
    const originalDigest = sha256Jcs(record256);

    const modified = { ...record256, title: record256.title + ' (modified)' };
    const modifiedDigest = sha256Jcs(modified);
    expect(modifiedDigest).not.toBe(originalDigest);
  });
});

// ---------------------------------------------------------------------------
// Manifest validation tests
// ---------------------------------------------------------------------------

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest(validManifest());
    expect(result.items).toHaveLength(1);
  });

  it('rejects wrong schemaVersion', () => {
    const m = validManifest();
    m.schemaVersion = 'some-other-version';
    expect(() => validateManifest(m)).toThrow(/schemaVersion/);
  });

  it('rejects wrong recordDigestAlgorithm', () => {
    const m = validManifest();
    m.recordDigestAlgorithm = 'sha256-plain-json-v1';
    expect(() => validateManifest(m)).toThrow(/recordDigestAlgorithm/);
  });

  it('rejects wrong sourceDigestAlgorithm', () => {
    const m = validManifest();
    m.sourceDigestAlgorithm = 'sha256-envelope-v1';
    expect(() => validateManifest(m)).toThrow(/sourceDigestAlgorithm/);
  });

  it('rejects wrong targetDefinitionKey (not personal_quick_item_v1)', () => {
    const m = validManifest();
    m.targetDefinitionKey = 'agent_self_task_v1';
    expect(() => validateManifest(m)).toThrow(/targetDefinitionKey/);
  });

  it('rejects wrong targetDefinitionVersion (not v1)', () => {
    const m = validManifest();
    m.targetDefinitionVersion = 2;
    expect(() => validateManifest(m)).toThrow(/targetDefinitionVersion/);
  });

  it('rejects more than 5 items', () => {
    const m = validManifest();
    m.items = Array.from({ length: 6 }, (_, i) => ({
      ...m.items[0],
      legacyTodoId: String(100 + i),
      idempotencyKey: `legacy-llm-todo:${100 + i}`,
    }));
    expect(() => validateManifest(m)).toThrow(/at most 5/);
  });

  it('accepts exactly 5 items', () => {
    const m = validManifest();
    m.items = Array.from({ length: 5 }, (_, i) => ({
      ...m.items[0],
      legacyTodoId: String(100 + i),
      idempotencyKey: `legacy-llm-todo:${100 + i}`,
    }));
    expect(() => validateManifest(m)).not.toThrow();
  });

  it('rejects empty items array', () => {
    const m = validManifest();
    m.items = [];
    expect(() => validateManifest(m)).toThrow(/not be empty/);
  });

  it('rejects wrong mappingDecision', () => {
    const m = validManifest();
    m.items[0].mappingDecision = 'IMPORT_AS_SOMETHING_ELSE';
    expect(() => validateManifest(m)).toThrow(/mappingDecision/);
  });

  it('rejects wrong targetCreatorPrincipalRef', () => {
    const m = validManifest();
    m.items[0].targetCreatorPrincipalRef = 'UNKNOWN_USER';
    expect(() => validateManifest(m)).toThrow(/targetCreatorPrincipalRef/);
  });

  it('rejects wrong idempotency key format', () => {
    const m = validManifest();
    m.items[0].idempotencyKey = 'custom-key-123';
    expect(() => validateManifest(m)).toThrow(/idempotencyKey/);
  });

  it('accepts null priority', () => {
    const m = validManifest();
    m.items[0].context.priority = null;
    expect(() => validateManifest(m)).not.toThrow();
  });

  it('accepts null legacyCreatedAt and legacyDueDate', () => {
    const m = validManifest();
    m.items[0].context.legacyProvenance.legacyCreatedAt = null;
    m.items[0].context.legacyProvenance.legacyDueDate = null;
    expect(() => validateManifest(m)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Token validation tests
// ---------------------------------------------------------------------------

describe('validateTokenSubject', () => {
  function makeJwt(sub: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub, iss: 'auth-service' })).toString('base64url');
    const sig = Buffer.from('fakesig').toString('base64url');
    return `${header}.${payload}.${sig}`;
  }

  it('accepts matching subject', () => {
    const jwt = makeJwt('00000000-0000-0000-0000-000000000101');
    expect(() => validateTokenSubject(jwt, '00000000-0000-0000-0000-000000000101')).not.toThrow();
  });

  it('rejects non-matching subject', () => {
    const jwt = makeJwt('00000000-0000-0000-0000-000000000010');
    expect(() => validateTokenSubject(jwt, '00000000-0000-0000-0000-000000000101')).toThrow(TokenSubjectMismatchError);
    expect(() => validateTokenSubject(jwt, '00000000-0000-0000-0000-000000000101')).toThrow(/TOKEN_SUBJECT_MISMATCH/);
  });

  it('rejects malformed JWT (no dots)', () => {
    expect(() => validateTokenSubject('not-a-jwt', 'principal-id')).toThrow(TokenSubjectMismatchError);
  });

  it('rejects JWT with missing sub claim', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'auth-service' })).toString('base64url');
    const sig = Buffer.from('fakesig').toString('base64url');
    const jwt = `${header}.${payload}.${sig}`;
    expect(() => validateTokenSubject(jwt, 'principal-id')).toThrow(TokenSubjectMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Secret scanning tests
// ---------------------------------------------------------------------------

describe('scanForSecrets', () => {
  it('does not detect secrets in the clean canary manifest', () => {
    const manifestPath = resolve(
      __dirname, '..',
      'migration', 'legacy-llm-todo-v1', 'generated', 'personal-quick-item-canary-v1.json',
    );
    const warnings = scanForSecrets(manifestPath);
    expect(warnings).toHaveLength(0);
  });

  it('detects JWT tokens', () => {
    const tmpFile = resolve(__dirname, '..', 'migration', 'legacy-llm-todo-v1', 'generated', '__test_jwt.json');
    writeFileSync(tmpFile, JSON.stringify({ jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.test' }), 'utf-8');
    const warnings = scanForSecrets(tmpFile);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/JWT/i);
    try { unlinkSync(tmpFile); } catch { /* ok */ }
  });

  it('detects Bearer token prefix in content', () => {
    const tmpFile = resolve(__dirname, '..', 'migration', 'legacy-llm-todo-v1', 'generated', '__test_bearer.json');
    writeFileSync(tmpFile, JSON.stringify({ auth: 'Bearer some-token' }), 'utf-8');
    const warnings = scanForSecrets(tmpFile);
    expect(warnings.length).toBeGreaterThan(0);
    try { unlinkSync(tmpFile); } catch { /* ok */ }
  });

  it('detects database URLs with passwords', () => {
    const tmpFile = resolve(__dirname, '..', 'migration', 'legacy-llm-todo-v1', 'generated', '__test_db.json');
    writeFileSync(tmpFile, JSON.stringify({ url: 'postgres://user:password@localhost:5432/db' }), 'utf-8');
    const warnings = scanForSecrets(tmpFile);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/database/i);
    try { unlinkSync(tmpFile); } catch { /* ok */ }
  });
});

// ---------------------------------------------------------------------------
// Git tracking tests
// ---------------------------------------------------------------------------

describe('Git tracking', () => {
  it('remote-todos-raw.json is not tracked by Git', () => {
    const gitignorePath = resolve(__dirname, '..', '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    expect(gitignore).toContain('migration/legacy-llm-todo-v1/private/');
  });
});

// ---------------------------------------------------------------------------
// Generated manifest integrity
// ---------------------------------------------------------------------------

describe('generated manifest file', () => {
  const manifestPath = resolve(
    __dirname, '..',
    'migration', 'legacy-llm-todo-v1', 'generated', 'personal-quick-item-canary-v1.json',
  );

  it('exists and parses as valid JSON', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const content = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(content.schemaVersion).toBe('personal-quick-item-canary-v1');
  });

  it('contains exactly 3 canary items', () => {
    const content = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(content.items).toHaveLength(3);
  });

  it('has correct digest algorithms declared', () => {
    const content = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(content.recordDigestAlgorithm).toBe('sha256-rfc8785-jcs-full-record-v1');
    expect(content.sourceDigestAlgorithm).toBe('sha256-file-bytes-v1');
  });

  it('source digest matches expected export report', () => {
    const content = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(content.sourceSnapshotSha256).toBe('284fe44af048d7aa453dae4385fae6e25730f9ed97e92516d44b4bda60fbbf3f');
  });

  it('all items are DOGFOOD_USER with REONBOARD_AS_PERSONAL_QUICK_ITEM', () => {
    const content = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    for (const item of content.items) {
      expect(item.targetCreatorPrincipalRef).toBe('DOGFOOD_USER');
      expect(item.mappingDecision).toBe('REONBOARD_AS_PERSONAL_QUICK_ITEM');
    }
  });

  it('all items have stable idempotency keys', () => {
    const content = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    for (const item of content.items) {
      expect(item.idempotencyKey).toBe(`legacy-llm-todo:${item.legacyTodoId}`);
    }
  });

  it('items are 238, 256, 279', () => {
    const content = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const ids = content.items.map((i: { legacyTodoId: string }) => i.legacyTodoId).sort();
    expect(ids).toEqual(['238', '256', '279']);
  });

  it('importedAt is fixed (not auto-generated)', () => {
    const content = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    for (const item of content.items) {
      expect(item.context.legacyProvenance.importedAt).toBe('2026-07-17T14:01:41Z');
    }
  });
});
