/**
 * Provisioning Auth — Machine Token Provider wrapper for workflow.admin scope.
 *
 * Separated from provision.ts so it can be unit-tested without depending on
 * global process.env.
 *
 * Responsibilities:
 *   - Accept explicit provisioning config (tokenEndpoint, clientId, clientSecret)
 *   - Create a MachineTokenProvider fixed to resource=svc-workflow, scope=workflow.admin
 *   - Fail closed on missing config or token failure
 *
 * Not responsible for:
 *   - Reading environment variables (caller does that)
 *   - Making HTTP calls to svc-workflow admin APIs
 *   - Implementing any OAuth or token protocol
 */

import { createMachineTokenProvider } from '@unified-auth/machine-token-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProvisioningConfig {
  /** Auth-service OAuth token endpoint (e.g. http://localhost:4001/oauth/token) */
  tokenEndpoint: string;
  /** Machine Client ID with workflow.admin scope */
  clientId: string;
  /** Machine Client Secret */
  clientSecret: string;
}

export interface ProvisioningDeps {
  /** Factory for creating the underlying TokenProvider.  Defaults to createMachineTokenProvider.
   *  Injectable so tests can verify scopes/resource without calling auth-service. */
  createProvider?: typeof createMachineTokenProvider;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TokenProvider (() => Promise<string>) for provisioning.
 *
 * The provider is configured with a fixed scope of workflow.admin and
 * resource of svc-workflow.  These are NOT configurable — the provisioning
 * client MUST be a dedicated Machine Principal that only has this scope.
 *
 * Fail-closed: any missing config, or token endpoint failure, raises an error.
 */
export function createProvisioningTokenProvider(
  config: ProvisioningConfig,
  deps?: ProvisioningDeps,
): () => Promise<string> {
  // Validate eagerly — fail on misconfiguration before any HTTP call
  if (!config.tokenEndpoint) {
    throw new Error(
      'PROVISIONING_MISSING_TOKEN_ENDPOINT: tokenEndpoint is required for provisioning auth',
    );
  }
  if (!config.clientId) {
    throw new Error(
      'PROVISIONING_MISSING_CLIENT_ID: clientId is required for provisioning auth',
    );
  }
  if (!config.clientSecret) {
    throw new Error(
      'PROVISIONING_MISSING_CLIENT_SECRET: clientSecret is required for provisioning auth',
    );
  }

  const factory = deps?.createProvider ?? createMachineTokenProvider;

  const tokenProvider = factory({
    tokenEndpoint: config.tokenEndpoint,
    clientId: config.clientId,
    credentialProvider: () => config.clientSecret,
    // Fixed resource and scope — NOT configurable.
    // The provisioning Machine Principal must be scoped only to workflow.admin.
    resource: 'svc-workflow',
    scopes: ['workflow.admin'],
    timeoutMs: 35000,
  });

  // Wrap the provider so errors from the token endpoint never leak secrets
  return async () => {
    try {
      return await tokenProvider();
    } catch (err) {
      // Re-throw with a safe message — the original error may contain
      // HTTP response bodies or transport details that should not propagate.
      throw new Error(
        'PROVISIONING_AUTH_FAILED: Failed to obtain admin token from auth-service',
      );
    }
  };
}
