import { describe, expect, it } from 'vitest';
import { validateWorkflowPath, resolveWorkflowPath } from '../src/config.js';

describe('validateWorkflowPath', () => {
  it('accepts legacy', () => {
    expect(validateWorkflowPath('legacy')).toBe('legacy');
  });

  it('accepts sdk_auth_v1', () => {
    expect(validateWorkflowPath('sdk_auth_v1')).toBe('sdk_auth_v1');
  });

  it('rejects unknown value', () => {
    expect(() => validateWorkflowPath('unknown')).toThrow(
      'WORKFLOW_TODO_WORKFLOW_PATH must be "legacy" or "sdk_auth_v1"',
    );
  });

  it('rejects empty string', () => {
    expect(() => validateWorkflowPath('')).toThrow(
      'WORKFLOW_TODO_WORKFLOW_PATH must be "legacy" or "sdk_auth_v1"',
    );
  });
});

describe('resolveWorkflowPath', () => {
  it('resolves legacy', () => {
    expect(resolveWorkflowPath('legacy')).toBe('legacy');
  });

  it('accepts sdk_auth_v1 now that the official package is available', () => {
    expect(resolveWorkflowPath('sdk_auth_v1')).toBe('sdk_auth_v1');
  });

  it('propagates validation errors', () => {
    expect(() => resolveWorkflowPath('nope')).toThrow(
      'WORKFLOW_TODO_WORKFLOW_PATH must be "legacy" or "sdk_auth_v1"',
    );
  });
});
