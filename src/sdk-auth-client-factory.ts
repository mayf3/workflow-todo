/**
 * SDK Auth Client Factory
 *
 * Assembles the official Machine Token Provider (@unified-auth/machine-token-provider)
 * and injects it into the Workflow SDK (@workflow-foundation/sdk).
 *
 * Responsibilities:
 *   - Read auth config from environment
 *   - Create MachineTokenProvider via official factory
 *   - Create WorkflowClient via createTodoWorkflowClient (sdk-adapter.ts)
 *   - Fail closed on any misconfiguration
 *
 * Not responsible for:
 *   - Implementing OAuth / Token protocol
 *   - Caching or refreshing tokens (handled by the official provider)
 *   - Falling back to any other auth method on failure
 *   - Logging secrets or tokens
 */

import { createMachineTokenProvider } from '@unified-auth/machine-token-provider';
import { WorkflowClient } from '@workflow-foundation/sdk';
import { env } from './config.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SdkAuthClientDependencies {
  baseUrl: string;
  tokenEndpoint: string;
  clientId: string;
  credentialProvider: () => string | Promise<string>;
  resource: string;
  scopes: readonly string[];
  requestTimeoutMs: number;
  fetch?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a WorkflowClient configured with the official Machine Token Provider.
 *
 * The provider is created and injected as a TokenProvider (() => Promise<string>)
 * which is structurally compatible with the Workflow SDK's accessTokenProvider.
 *
 * No static tokens, no admin tokens, no fallback — fail closed on auth failure.
 */
export function createSdkAuthWorkflowClient(
  deps?: Partial<SdkAuthClientDependencies>,
): WorkflowClient {
  // Resolve config from environment, with overrides for testing
  const baseUrl = deps?.baseUrl ?? env.SVC_WORKFLOW_BASE_URL;
  const tokenEndpoint = deps?.tokenEndpoint ?? env.SVC_AUTH_TOKEN_ENDPOINT;
  const clientId = deps?.clientId ?? env.SVC_AUTH_MACHINE_CLIENT_ID;
  const resource = deps?.resource ?? env.SVC_AUTH_MACHINE_RESOURCE;
  const requestTimeoutMs = deps?.requestTimeoutMs ?? parseInt(env.REQUEST_TIMEOUT_MS, 10);

  // Parse scopes from comma-separated env var, or use default
  const rawScopes: readonly string[] = deps?.scopes ?? parseScopes(env.SVC_AUTH_MACHINE_SCOPES);

  // Resolve credential provider:
  // - Use injected provider if provided (for testing)
  // - Otherwise read client secret from env var
  const credentialProvider: () => string | Promise<string> =
    deps?.credentialProvider ?? (() => {
      const secret = env.SVC_AUTH_MACHINE_CLIENT_SECRET;
      if (!secret) {
        return Promise.reject(
          new Error('SVC_AUTH_MACHINE_CLIENT_SECRET is not configured'),
        );
      }
      return secret;
    });

  // Validate required config eagerly — fail on misconfiguration before any HTTP call
  if (!baseUrl) {
    throw new Error('SVC_WORKFLOW_BASE_URL is required for sdk_auth_v1 path');
  }
  if (!tokenEndpoint) {
    throw new Error('SVC_AUTH_TOKEN_ENDPOINT is required for sdk_auth_v1 path');
  }
  if (!clientId) {
    throw new Error('SVC_AUTH_MACHINE_CLIENT_ID is required for sdk_auth_v1 path');
  }

  // Resolve fetch implementation, defaulting to globalThis.fetch
  const doFetch = deps?.fetch ?? globalThis.fetch;

  // Create the official Machine Token Provider
  // The createMachineTokenProvider function performs its own eager validation
  // of config fields (tokenEndpoint, clientId, credentialProvider, resource, scopes)
  const tokenProvider = createMachineTokenProvider({
    tokenEndpoint,
    clientId,
    credentialProvider,
    resource,
    scopes: rawScopes,
    timeoutMs: requestTimeoutMs,
    fetch: doFetch,
  });

  // Create and return the WorkflowClient with the token provider injected
  return new WorkflowClient({
    baseUrl,
    tokenProvider,
    requestTimeoutMs,
    fetchImplementation: doFetch,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a comma-separated scope string into a string array.
 * Trims whitespace and filters empty entries.
 */
function parseScopes(raw: string): string[] {
  if (!raw || raw.trim().length === 0) {
    return ['workflow.read'];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
