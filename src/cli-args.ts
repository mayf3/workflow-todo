/**
 * Pure CLI argument and output mode parsing.
 *
 * Responsibilities:
 * - Parse `--json` / `--format` flags
 * - Validate mode conflicts
 * - Strip mode flags returning clean business-arg list
 *
 * This module MUST NOT:
 *   call HTTP, read tokens, read databases, format workflow data,
 *   execute commands, or call process.exit.
 *
 * Errors are reported as ParseResult with a structured error message.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputMode = 'text' | 'json';

export interface ParseResult {
  /** Resolved output mode */
  mode: OutputMode;
  /** Args with all mode-related flags removed */
  remainingArgs: string[];
  /** Parsing error, if any */
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lastIndexOfFlag(args: string[], flag: string): number {
  // Find the LAST occurrence so we don't break on repeated flags
  let idx = -1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) idx = i;
  }
  return idx;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse output mode from CLI arguments.
 *
 * Rules:
 *   no flags          → text
 *   --json            → json
 *   --format json     → json
 *   --format text     → text
 *
 * Conflicts (all rejected):
 *   --json --format text
 *   --json --format json
 *   --format (no value)
 *   --format <unknown>
 *   multiple --format flags
 */
export function parseOutputMode(args: string[]): ParseResult {
  const hasJson = args.includes('--json');

  // Find ALL --format positions
  const formatPositions: number[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format') {
      formatPositions.push(i);
    }
  }

  // --format without value
  if (formatPositions.length > 0) {
    for (const pos of formatPositions) {
      if (pos + 1 >= args.length) {
        return { mode: 'text', remainingArgs: args, error: '--format requires a value (text or json)' };
      }
    }
  }

  // Multiple --format flags
  if (formatPositions.length > 1) {
    return { mode: 'text', remainingArgs: args, error: '--format may only be specified once' };
  }

  const hasFormat = formatPositions.length === 1;
  let formatValue: string | undefined;
  if (hasFormat) {
    formatValue = args[formatPositions[0] + 1];
  }

  // --json + --format = conflict
  if (hasJson && hasFormat) {
    return { mode: 'text', remainingArgs: args, error: '--json and --format cannot both be specified' };
  }

  // Validate format value
  if (hasFormat) {
    if (formatValue !== 'text' && formatValue !== 'json') {
      return { mode: 'text', remainingArgs: args, error: `unknown format "${formatValue}" (use "text" or "json")` };
    }
  }

  // Resolve mode
  let mode: OutputMode;
  if (hasJson) {
    mode = 'json';
  } else if (formatValue === 'json') {
    mode = 'json';
  } else {
    mode = 'text';
  }

  // Strip mode flags from args
  const remainingArgs: string[] = [];
  let skipNext = false;
  for (let i = 0; i < args.length; i++) {
    if (skipNext) { skipNext = false; continue; }
    if (args[i] === '--json') continue;
    if (args[i] === '--format') { skipNext = true; continue; }
    remainingArgs.push(args[i]);
  }

  return { mode, remainingArgs };
}
