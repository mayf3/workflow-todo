/**
 * Deterministic digest utilities for legacy todo data.
 *
 * - `sha256Jcs(obj)`: RFC 8785 JCS canonicalization → SHA-256 hex
 * - `sha256FileBytes(buffer)`: raw file byte SHA-256 hex
 *
 * Both are designed so auditors can independently recompute from the
 * original remote export and fully match.
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// RFC 8785 JCS canonicalization helpers
// ---------------------------------------------------------------------------

/**
 * Canonicalize a JSON value per RFC 8785 (JSON Canonicalization Scheme).
 *
 * Rules:
 * - Object keys sorted lexicographically
 * - No whitespace anywhere
 * - Strings use JSON escaping (handled by JSON.stringify)
 * - Numbers: no leading zeros, no trailing dot, no exponent padding
 * - null, true, false as their JSON literals
 */
function jcsCanonicalize(obj: unknown): string {
  if (obj === null) return 'null';
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) {
      throw new RangeError('Non-finite number cannot be canonicalized');
    }
    // JSON.stringify on a number already produces RFC 8785-compliant output
    // (no leading zeros, no trailing dot, -0 → "0", NaN/Infinity rejected above)
    return JSON.stringify(obj);
  }
  if (typeof obj === 'string') {
    // JSON.stringify handles proper string escaping per RFC 8785
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    const items = obj.map(jcsCanonicalize);
    return '[' + items.join(',') + ']';
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) => JSON.stringify(k) + ':' + jcsCanonicalize((obj as Record<string, unknown>)[k]),
    );
    return '{' + pairs.join(',') + '}';
  }
  throw new TypeError(`Cannot canonicalize value of type ${typeof obj}`);
}

/**
 * Compute SHA-256 hex digest of the RFC 8785 JCS canonical form of `obj`.
 */
export function sha256Jcs(obj: unknown): string {
  const canonical = jcsCanonicalize(obj);
  const hash = createHash('sha256');
  hash.update(canonical, 'utf-8');
  return hash.digest('hex');
}

/**
 * Compute SHA-256 hex digest of raw file bytes.
 */
export function sha256FileBytes(buffer: Buffer): string {
  const hash = createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
}
