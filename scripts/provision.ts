#!/usr/bin/env node

/**
 * Provision the agent_self_task_v1 definition into svc-workflow
 * and configure the EFFICIENCY_MANAGER as DOMAIN_OWNER.
 *
 * Administration tokens are obtained from auth-service via an independent
 * Machine Principal (SVC_AUTH_PROVISIONING_CLIENT_ID/SECRET) scoped only to
 * workflow.admin.  No local JWT signing, no static tokens, no admin identity
 * construction.
 *
 * Usage:
 *   npm run provision
 *
 * Required env:
 *   SVC_AUTH_TOKEN_ENDPOINT            — Auth-service OAuth token endpoint
 *   SVC_AUTH_PROVISIONING_CLIENT_ID    — Machine Client with workflow.admin scope
 *   SVC_AUTH_PROVISIONING_CLIENT_SECRET
 *   SVC_WORKFLOW_BASE_URL              — svc-workflow base URL
 *   DOMAIN_ID                          — Target domain UUID
 *   EFFICIENCY_MANAGER_PRINCIPAL_ID
 *   LOBSTER_PARTNER_PRINCIPAL_ID
 *   DATABASE_URL                       — PostgreSQL URL (for Rust provisioning binary)
 *   PROVISIONING_PRINCIPAL_ID          — Principal allowed by svc-workflow allow-list
 *
 * Admin credentials are kept separate from the daily-running Machine Client
 * (SVC_AUTH_MACHINE_CLIENT_ID/SECRET) which only has workflow.read/execute.
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { createProvisioningTokenProvider } from './provision-auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is required`);
    process.exit(1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Validate required environment variables
  requireEnv('SVC_AUTH_TOKEN_ENDPOINT');
  requireEnv('SVC_AUTH_PROVISIONING_CLIENT_ID');
  requireEnv('SVC_AUTH_PROVISIONING_CLIENT_SECRET');
  requireEnv('SVC_WORKFLOW_BASE_URL');
  requireEnv('DATABASE_URL');
  requireEnv('PROVISIONING_PRINCIPAL_ID');
  requireEnv('DOMAIN_ID');
  requireEnv('EFFICIENCY_MANAGER_PRINCIPAL_ID');
  requireEnv('LOBSTER_PARTNER_PRINCIPAL_ID');

  const domainId = process.env.DOMAIN_ID!;
  const emPrincipalId = process.env.EFFICIENCY_MANAGER_PRINCIPAL_ID!;

  // -----------------------------------------------------------------------
  // Step 1: Provision definition via Rust binary (svc-workflow)
  // -----------------------------------------------------------------------
  const defFile = resolve(repoRoot, 'definitions', 'agent-self-task-v1.json');
  if (!existsSync(defFile)) {
    console.error(`ERROR: Definition file not found: ${defFile}`);
    process.exit(1);
  }

  const svcWorkflowDir = resolve(repoRoot, '..', 'svc-workflow');
  if (!existsSync(svcWorkflowDir)) {
    console.error(`ERROR: svc-workflow repository not found at ${svcWorkflowDir}`);
    process.exit(1);
  }

  console.log('Building provisioning binary...');
  execSync('cargo build --bin provision-todo-definition', {
    cwd: svcWorkflowDir,
    stdio: 'inherit',
    env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
  });

  const binaryPath = resolve(svcWorkflowDir, 'target', 'debug', 'provision-todo-definition');

  console.log('Running provisioning...');
  execSync(`"${binaryPath}" "${defFile}"`, {
    cwd: svcWorkflowDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
    },
  });

  console.log('Provisioning completed successfully.');
  console.log('');

  // -----------------------------------------------------------------------
  // Step 2: Provision DOMAIN_OWNER role binding for EFFICIENCY_MANAGER
  //
  // Uses the official Machine Token Provider with a dedicated admin Client.
  // No local JWT signing, no static tokens, no admin identity construction.
  // Fail-closed: missing config → immediate error; token failure → exit.
  // -----------------------------------------------------------------------
  await provisionDomainOwnerRoleBinding(domainId, emPrincipalId);
}

async function provisionDomainOwnerRoleBinding(
  domainId: string,
  emPrincipalId: string,
): Promise<void> {
  console.log('Adding DOMAIN_OWNER role binding for EFFICIENCY_MANAGER...');

  // Create token provider with dedicated admin Client.
  // The provisioning Machine Principal is separate from the daily-running
  // Machine Client to avoid granting workflow.admin to routine operations.
  const tokenProvider = createProvisioningTokenProvider({
    tokenEndpoint: process.env.SVC_AUTH_TOKEN_ENDPOINT!,
    clientId: process.env.SVC_AUTH_PROVISIONING_CLIENT_ID!,
    clientSecret: process.env.SVC_AUTH_PROVISIONING_CLIENT_SECRET!,
  });

  // Obtain admin token from auth-service via formal Machine Token Provider.
  // Throws on failure — no fallback to local signing or static token.
  const adminToken = await tokenProvider();

  const baseUrl = process.env.SVC_WORKFLOW_BASE_URL!;
  const roleBindingUrl = `${baseUrl}/internal/v1/admin/domains/${domainId}/role-bindings/${emPrincipalId}`;

  const commonHeaders: Record<string, string> = {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  };

  // First try PUT (idempotent create/enable)
  const firstRes = await fetch(roleBindingUrl, {
    method: 'PUT',
    headers: {
      ...commonHeaders,
      'Idempotency-Key': `provision-domain-owner-${domainId}-${emPrincipalId}-v1`,
    },
    body: JSON.stringify({ roleKey: 'DOMAIN_OWNER', enabled: true }),
  });

  const firstBody = await firstRes.text();

  if (firstRes.ok) {
    console.log(`DOMAIN_OWNER role binding created: ${firstBody}`);
    return;
  }

  // -- Conflict handling ----------------------------------------------------
  //
  // 409 (role binding exists) — revoke and retry
  // 412 (domain has active owner) — use owner replacement endpoint

  if (firstRes.status === 409) {
    console.log('Domain owner conflict, attempting to revoke existing...');
    await handleConflict409(roleBindingUrl, baseUrl, domainId, emPrincipalId, commonHeaders);
    return;
  }

  if (firstRes.status === 412) {
    console.log('Precondition: domain has an active owner, attempting replacement...');
    await handleConflict412(baseUrl, domainId, emPrincipalId, commonHeaders);
    return;
  }

  console.error(`ERROR: Failed to create DOMAIN_OWNER: ${firstRes.status} ${firstBody}`);
  process.exit(1);
}

async function handleConflict409(
  roleBindingUrl: string,
  baseUrl: string,
  domainId: string,
  emPrincipalId: string,
  headers: Record<string, string>,
): Promise<void> {
  // Try owner replacement first
  const ownerUrl = `${baseUrl}/internal/v1/admin/domains/${domainId}/owner`;
  const replaceRes = await fetch(ownerUrl, {
    method: 'PUT',
    headers: {
      ...headers,
      'Idempotency-Key': `replace-owner-${domainId}-${emPrincipalId}-v1`,
    },
    body: JSON.stringify({ newOwnerPrincipalId: emPrincipalId }),
  });
  const replaceBody = await replaceRes.text();

  if (replaceRes.ok) {
    console.log(`Domain owner replaced: ${replaceBody}`);
    return;
  }

  // Fall back to manual role binding adjustment via DELETE + PUT
  console.log(`Owner replacement also failed (${replaceRes.status}), adjusting role bindings directly...`);
  const deleteRes = await fetch(roleBindingUrl, {
    method: 'DELETE',
    headers: {
      ...headers,
      'Idempotency-Key': `disable-old-owner-${domainId}-v1`,
    },
    body: JSON.stringify({ roleKey: 'DOMAIN_OWNER' }),
  });
  console.log(`Revoke response: ${deleteRes.status}`);

  if (deleteRes.ok || deleteRes.status === 404) {
    const retryRes = await fetch(roleBindingUrl, {
      method: 'PUT',
      headers: {
        ...headers,
        'Idempotency-Key': `provision-domain-owner-${domainId}-${emPrincipalId}-v2`,
      },
      body: JSON.stringify({ roleKey: 'DOMAIN_OWNER', enabled: true }),
    });
    const retryBody = await retryRes.text();
    if (retryRes.ok) {
      console.log(`DOMAIN_OWNER role binding created: ${retryBody}`);
      return;
    }
    console.error(`ERROR: Failed to create DOMAIN_OWNER: ${retryRes.status} ${retryBody}`);
    process.exit(1);
  }
}

async function handleConflict412(
  baseUrl: string,
  domainId: string,
  emPrincipalId: string,
  headers: Record<string, string>,
): Promise<void> {
  const ownerUrl = `${baseUrl}/internal/v1/admin/domains/${domainId}/owner`;
  const replaceRes = await fetch(ownerUrl, {
    method: 'PUT',
    headers: {
      ...headers,
      'Idempotency-Key': `replace-owner-${domainId}-${emPrincipalId}-v1`,
    },
    body: JSON.stringify({ newOwnerPrincipalId: emPrincipalId }),
  });
  const replaceBody = await replaceRes.text();

  if (replaceRes.ok) {
    console.log(`Domain owner replaced: ${replaceBody}`);
    return;
  }

  console.error(`ERROR: Failed to replace domain owner: ${replaceRes.status} ${replaceBody}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
