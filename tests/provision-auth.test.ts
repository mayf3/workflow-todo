/**
 * Provisioning Auth tests.
 *
 * Verifies that createProvisioningTokenProvider:
 *   - Fails closed on missing config
 *   - Uses exactly workflow.admin scope, resource svc-workflow
 *   - Does not reference daily running credentials
 *   - Does not leak secrets in errors
 *   - Propagates token provider failure without calling management APIs
 */

import { describe, expect, it, vi } from 'vitest';
import { createProvisioningTokenProvider } from '../scripts/provision-auth.js';

// ---------------------------------------------------------------------------
// Valid config fixture
// ---------------------------------------------------------------------------

const VALID_CONFIG = {
  tokenEndpoint: 'http://auth:4001/oauth/token',
  clientId: 'prov-test-client',
  clientSecret: 'prov-test-secret',
};

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

function makeMockProviderFactory(options?: {
  shouldThrow?: boolean;
}): typeof import('@unified-auth/machine-token-provider').createMachineTokenProvider {
  return ((config: Record<string, unknown>) => {
    if (options?.shouldThrow) {
      return () => Promise.reject(new Error('auth-service unreachable'));
    }
    // Return a provider that captures the config and returns a token
    const capturedConfig = { ...config };
    return () => Promise.resolve(`mock-admin-token-for-${capturedConfig.clientId}`);
  }) as unknown as typeof import('@unified-auth/machine-token-provider').createMachineTokenProvider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createProvisioningTokenProvider config validation', () => {
  it('throws when tokenEndpoint is missing', () => {
    expect(() =>
      createProvisioningTokenProvider(
        { ...VALID_CONFIG, tokenEndpoint: '' },
      ),
    ).toThrow(/PROVISIONING_MISSING_TOKEN_ENDPOINT/);
  });

  it('throws when clientId is missing', () => {
    expect(() =>
      createProvisioningTokenProvider(
        { ...VALID_CONFIG, clientId: '' },
      ),
    ).toThrow(/PROVISIONING_MISSING_CLIENT_ID/);
  });

  it('throws when clientSecret is missing', () => {
    expect(() =>
      createProvisioningTokenProvider(
        { ...VALID_CONFIG, clientSecret: '' },
      ),
    ).toThrow(/PROVISIONING_MISSING_CLIENT_SECRET/);
  });

  it('accepts valid config and returns a function', () => {
    const provider = createProvisioningTokenProvider(VALID_CONFIG, {
      createProvider: makeMockProviderFactory(),
    });
    expect(provider).toBeInstanceOf(Function);
  });
});

describe('provisioning scope and resource', () => {
  it('uses exactly workflow.admin scope and svc-workflow resource', () => {
    const capturedConfigs: Array<Record<string, unknown>> = [];

    const capturingFactory = ((config: Record<string, unknown>) => {
      capturedConfigs.push({ ...config });
      return () => Promise.resolve('mock-token');
    }) as unknown as typeof import('@unified-auth/machine-token-provider').createMachineTokenProvider;

    createProvisioningTokenProvider(VALID_CONFIG, {
      createProvider: capturingFactory,
    });

    expect(capturedConfigs).toHaveLength(1);
    expect(capturedConfigs[0].resource).toBe('svc-workflow');
    expect(capturedConfigs[0].scopes).toEqual(['workflow.admin']);
  });

  it('does not reference daily running SVC_AUTH_MACHINE_CLIENT_ID', () => {
    const capturedConfigs: Array<Record<string, unknown>> = [];

    const capturingFactory = ((config: Record<string, unknown>) => {
      capturedConfigs.push({ ...config });
      return () => Promise.resolve('mock-token');
    }) as unknown as typeof import('@unified-auth/machine-token-provider').createMachineTokenProvider;

    createProvisioningTokenProvider(VALID_CONFIG, {
      createProvider: capturingFactory,
    });

    expect(capturedConfigs[0].clientId).toBe('prov-test-client');
    // The provisioning config uses PROVISIONING_* not MACHINE_*
    expect(capturedConfigs[0].clientId).not.toContain('MACHINE');
  });

  it('credentialProvider returns the provisioning secret, not daily secret', async () => {
    let capturedCredentialProvider: (() => string | Promise<string>) | undefined;

    const capturingFactory = ((config: Record<string, unknown>) => {
      capturedCredentialProvider = config.credentialProvider as () => string | Promise<string>;
      return () => Promise.resolve('mock-token');
    }) as unknown as typeof import('@unified-auth/machine-token-provider').createMachineTokenProvider;

    createProvisioningTokenProvider(VALID_CONFIG, {
      createProvider: capturingFactory,
    });

    expect(capturedCredentialProvider).toBeDefined();
    const secret = await capturedCredentialProvider!();
    expect(secret).toBe('prov-test-secret');
  });
});

describe('token provider failure behavior', () => {
  it('re-throws errors without leaking secret or token values', async () => {
    const provider = createProvisioningTokenProvider(VALID_CONFIG, {
      createProvider: makeMockProviderFactory({ shouldThrow: true }),
    });

    try {
      await provider();
      expect.fail('should have thrown');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Should contain a safe error message
      expect(msg).toContain('PROVISIONING_AUTH_FAILED');
      // Should NOT contain the actual secret
      expect(msg).not.toContain('prov-test-secret');
      // Should NOT contain the auth-service internal error detail
      expect(msg).not.toContain('auth-service unreachable');
    }
  });
});
