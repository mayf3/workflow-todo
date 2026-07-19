import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

// ---------------------------------------------------------------------------
// Workflow path configuration
// ---------------------------------------------------------------------------

export type WorkflowPath = 'legacy' | 'sdk_auth_v1';

const VALID_WORKFLOW_PATHS: WorkflowPath[] = ['legacy', 'sdk_auth_v1'];

/**
 * Strictly validate the workflow path configuration.
 * Unknown values are fatal errors — no silent fallback to legacy.
 */
export function validateWorkflowPath(raw: string): WorkflowPath {
  if (raw === 'legacy') return 'legacy';
  if (raw === 'sdk_auth_v1') return 'sdk_auth_v1';
  throw new Error(
    `WORKFLOW_TODO_WORKFLOW_PATH must be "legacy" or "sdk_auth_v1", got "${raw}"`,
  );
}

/**
 * Resolve the effective workflow path.
 *
 * If sdk_auth_v1 is selected but the official auth-service Machine Token
 * Provider is not yet available, this fails with a clear configuration error.
 * No fallback to legacy, no static token fallback.
 */
export function resolveWorkflowPath(raw: string): WorkflowPath {
  const path = validateWorkflowPath(raw);

  if (path === 'sdk_auth_v1') {
    // The official @unified-auth/machine-token-provider package is now available
    // as a pinned tarball dependency. Eager validation is deferred to the
    // client factory (src/sdk-auth-client-factory.ts) which performs
    // configuration validation at assembly time.
    return path;
  }

  return path;
}

export const env = {
  SVC_WORKFLOW_BASE_URL: required('SVC_WORKFLOW_BASE_URL'),
  SVC_WORKFLOW_ACCESS_TOKEN: required('SVC_WORKFLOW_ACCESS_TOKEN'),
  DOMAIN_ID: required('DOMAIN_ID'),
  // Personal Quick Item (普通 Todo)
  PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID: required('PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID'),
  // Agent Self Task (正式 Agent 工作)
  AGENT_SELF_TASK_DEFINITION_VERSION_ID: required('AGENT_SELF_TASK_DEFINITION_VERSION_ID'),
  // Retained for backward compatibility with external scripts
  DEFINITION_VERSION_ID: required('DEFINITION_VERSION_ID'),
  EFFICIENCY_MANAGER_PRINCIPAL_ID: required('EFFICIENCY_MANAGER_PRINCIPAL_ID'),
  LOBSTER_PARTNER_PRINCIPAL_ID: required('LOBSTER_PARTNER_PRINCIPAL_ID'),
  AGENT_A_PRINCIPAL_ID: optional('AGENT_A_PRINCIPAL_ID', ''),
  REQUEST_TIMEOUT_MS: optional('SVC_WORKFLOW_REQUEST_TIMEOUT_MS', '35000'),
  MAX_ATTEMPTS: optional('SVC_WORKFLOW_MAX_ATTEMPTS', '3'),

  // Workflow path feature flag (default: legacy — current behavior unchanged)
  WORKFLOW_TODO_WORKFLOW_PATH: optional('WORKFLOW_TODO_WORKFLOW_PATH', 'legacy'),

  // Auth-service Machine Token Provider configuration (required for sdk_auth_v1 path)
  SVC_AUTH_TOKEN_ENDPOINT: optional('SVC_AUTH_TOKEN_ENDPOINT', ''),
  SVC_AUTH_MACHINE_CLIENT_ID: optional('SVC_AUTH_MACHINE_CLIENT_ID', ''),
  SVC_AUTH_MACHINE_CLIENT_SECRET: optional('SVC_AUTH_MACHINE_CLIENT_SECRET', ''),
  SVC_AUTH_MACHINE_RESOURCE: optional('SVC_AUTH_MACHINE_RESOURCE', 'svc-workflow'),
  SVC_AUTH_MACHINE_SCOPES: optional('SVC_AUTH_MACHINE_SCOPES', 'workflow.read'),
};
