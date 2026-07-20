import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}

function required(name: string): () => string {
  return () => {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `Missing required configuration: ${name}. ` +
        `The SDK Auth V1 workflow path requires SVC_AUTH_TOKEN_ENDPOINT, ` +
        `SVC_AUTH_MACHINE_CLIENT_ID, SVC_AUTH_MACHINE_CLIENT_SECRET, and SVC_WORKFLOW_BASE_URL.`,
      );
    }
    return value;
  };
}

function optional(name: string, defaultValue: string): () => string {
  return () => process.env[name] ?? defaultValue;
}

// ---------------------------------------------------------------------------
// Environment configuration
//
// The SDK Auth V1 path is the only runtime path.  There is no legacy fallback,
// no static access token, and no workflow path flag.
//
// Values are lazily evaluated so that tests do not need to set every variable
// when they import config.ts.  Missing required variables will throw at first
// access, not at import time.
// ---------------------------------------------------------------------------

export const env = {
  /** Base URL for svc-workflow */
  get SVC_WORKFLOW_BASE_URL(): string { return required('SVC_WORKFLOW_BASE_URL')(); },

  // -- Auth-service configuration (required for Machine Token Provider) --

  /** Token endpoint for auth-service OAuth /oauth/token */
  get SVC_AUTH_TOKEN_ENDPOINT(): string { return required('SVC_AUTH_TOKEN_ENDPOINT')(); },

  /** Machine Client ID for client_credentials grant */
  get SVC_AUTH_MACHINE_CLIENT_ID(): string { return required('SVC_AUTH_MACHINE_CLIENT_ID')(); },

  /** Machine Client Secret for client_credentials grant */
  get SVC_AUTH_MACHINE_CLIENT_SECRET(): string { return required('SVC_AUTH_MACHINE_CLIENT_SECRET')(); },

  /** Target resource for token (default: svc-workflow) */
  get SVC_AUTH_MACHINE_RESOURCE(): string { return optional('SVC_AUTH_MACHINE_RESOURCE', 'svc-workflow')(); },

  /** Comma-separated scopes (default: workflow.read) */
  get SVC_AUTH_MACHINE_SCOPES(): string { return optional('SVC_AUTH_MACHINE_SCOPES', 'workflow.read')(); },

  // -- Workflow domain and definition configuration --

  get DOMAIN_ID(): string { return required('DOMAIN_ID')(); },
  get PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID(): string { return required('PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID')(); },
  get AGENT_SELF_TASK_DEFINITION_VERSION_ID(): string { return required('AGENT_SELF_TASK_DEFINITION_VERSION_ID')(); },

  /** Retained for backward compatibility with external scripts */
  get DEFINITION_VERSION_ID(): string { return required('DEFINITION_VERSION_ID')(); },

  get EFFICIENCY_MANAGER_PRINCIPAL_ID(): string { return required('EFFICIENCY_MANAGER_PRINCIPAL_ID')(); },
  get LOBSTER_PARTNER_PRINCIPAL_ID(): string { return required('LOBSTER_PARTNER_PRINCIPAL_ID')(); },
  get AGENT_A_PRINCIPAL_ID(): string { return optional('AGENT_A_PRINCIPAL_ID', '')(); },

  get REQUEST_TIMEOUT_MS(): string { return optional('SVC_WORKFLOW_REQUEST_TIMEOUT_MS', '35000')(); },
  get MAX_ATTEMPTS(): string { return optional('SVC_WORKFLOW_MAX_ATTEMPTS', '3')(); },
};
