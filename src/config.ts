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
};
