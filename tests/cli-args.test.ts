import { describe, expect, it } from 'vitest';
import { parseOutputMode } from '../src/cli-args.js';

/**
 * Helper: assert parseOutputMode success.
 */
function assertMode(
  args: string[],
  expectedMode: 'text' | 'json',
  expectedRemaining: string[],
): void {
  const result = parseOutputMode(args);
  expect(result.error).toBeUndefined();
  expect(result.mode).toBe(expectedMode);
  expect(result.remainingArgs).toEqual(expectedRemaining);
}

/**
 * Helper: assert parseOutputMode error.
 */
function assertError(args: string[], errorSubstring: string): void {
  const result = parseOutputMode(args);
  expect(result.error).toBeDefined();
  expect(result.error).toContain(errorSubstring);
}

// ---------------------------------------------------------------------------
// Default behaviour
// ---------------------------------------------------------------------------

describe('parseOutputMode default', () => {
  it('no flags → text', () => {
    assertMode([], 'text', []);
  });

  it('only business args → text', () => {
    assertMode(['--instance-id', 'abc'], 'text', ['--instance-id', 'abc']);
  });
});

// ---------------------------------------------------------------------------
// --json flag
// ---------------------------------------------------------------------------

describe('parseOutputMode --json', () => {
  it('--json alone → json', () => {
    assertMode(['--json'], 'json', []);
  });

  it('--json before business args → json, args preserved', () => {
    assertMode(['--json', '--instance-id', 'abc'], 'json', ['--instance-id', 'abc']);
  });

  it('--json after business args → json, args preserved', () => {
    assertMode(['--instance-id', 'abc', '--json'], 'json', ['--instance-id', 'abc']);
  });

  it('--json in middle → json, other flags preserved', () => {
    assertMode(['--instance-id', 'abc', '--json', '--summary', 'done'], 'json', ['--instance-id', 'abc', '--summary', 'done']);
  });
});

// ---------------------------------------------------------------------------
// --format flag
// ---------------------------------------------------------------------------

describe('parseOutputMode --format', () => {
  it('--format json → json', () => {
    assertMode(['--format', 'json'], 'json', []);
  });

  it('--format text → text', () => {
    assertMode(['--format', 'text'], 'text', []);
  });

  it('--format json with business args', () => {
    assertMode(['--instance-id', 'abc', '--format', 'json'], 'json', ['--instance-id', 'abc']);
  });

  it('--format text with business args', () => {
    assertMode(['--instance-id', 'abc', '--format', 'text'], 'text', ['--instance-id', 'abc']);
  });
});

// ---------------------------------------------------------------------------
// Conflict and error handling
// ---------------------------------------------------------------------------

describe('parseOutputMode conflicts', () => {
  it('--json --format text is rejected', () => {
    assertError(['--json', '--format', 'text'], 'cannot both be specified');
  });

  it('--json --format json is rejected', () => {
    assertError(['--json', '--format', 'json'], 'cannot both be specified');
  });

  it('--format without value is rejected', () => {
    assertError(['--format'], 'requires a value');
  });

  it('--format at end without value is rejected', () => {
    assertError(['--instance-id', 'abc', '--format'], 'requires a value');
  });

  it('duplicate --format is rejected', () => {
    assertError(['--format', 'json', '--format', 'text'], 'may only be specified once');
  });

  it('unknown format value is rejected', () => {
    assertError(['--format', 'yaml'], 'unknown format');
  });
});

// ---------------------------------------------------------------------------
// Remaining args preservation
// ---------------------------------------------------------------------------

describe('parseOutputMode remainingArgs', () => {
  it('business args keep order after --json stripped', () => {
    const result = parseOutputMode(['--title', 'hello', '--description', 'world', '--json']);
    expect(result.remainingArgs).toEqual(['--title', 'hello', '--description', 'world']);
  });

  it('multiple business args with values are preserved', () => {
    const result = parseOutputMode(['--instance-id', 'uuid-1', '--summary', 'done', '--format', 'json']);
    expect(result.remainingArgs).toEqual(['--instance-id', 'uuid-1', '--summary', 'done']);
  });

  it('unknown args (not output flags) are not stripped', () => {
    const result = parseOutputMode(['--unknown-flag', 'value', '--json']);
    expect(result.remainingArgs).toContain('--unknown-flag');
    expect(result.remainingArgs).toContain('value');
  });
});

// ---------------------------------------------------------------------------
// Command-specific scenarios
// ---------------------------------------------------------------------------

describe('command-specific arg scenarios', () => {
  it('create args are preserved', () => {
    const result = parseOutputMode(['--title', 'T', '--description', 'D', '--acceptance-criteria', 'C', '--json']);
    expect(result.remainingArgs).toEqual(['--title', 'T', '--description', 'D', '--acceptance-criteria', 'C']);
  });

  it('detail args are preserved', () => {
    const result = parseOutputMode(['--instance-id', 'abc-123', '--json']);
    expect(result.remainingArgs).toEqual(['--instance-id', 'abc-123']);
  });

  it('advance args are preserved', () => {
    const result = parseOutputMode(['--instance-id', 'abc', '--summary', 'done', '--format', 'text']);
    expect(result.remainingArgs).toEqual(['--instance-id', 'abc', '--summary', 'done']);
  });

  it('legacy-import unrelated flags remain', () => {
    const result = parseOutputMode(['--manifest', 'path.json', '--apply-canary']);
    // These are not mode flags, they stay
    expect(result.remainingArgs).toEqual(['--manifest', 'path.json', '--apply-canary']);
    expect(result.mode).toBe('text');
  });
});
