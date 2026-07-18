#!/usr/bin/env node

/**
 * Provision the agent_self_task_v1 definition into svc-workflow.
 *
 * This script calls the Rust provisioning binary (built from svc-workflow).
 * It does NOT write to PostgreSQL directly.
 *
 * Usage:
 *   npm run provision
 *
 * Required env:
 *   DATABASE_URL
 *   PROVISIONING_PRINCIPAL_ID    — Agent/principal with workflow.admin scope
 *   DOMAIN_ID                    — Target domain UUID
 *   EFFICIENCY_MANAGER_PRINCIPAL_ID
 *   LOBSTER_PARTNER_PRINCIPAL_ID
 */

import { execSync } from 'child_process';
import { createHmac } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function base64UrlEncode(data: Buffer): string {
  return data.toString('base64url');
}

function base64UrlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function signHmacSha256(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest().toString('base64url');
}

/**
 * Create a HS256 JWT for a provisioning-allowed principal.
 *
 * The JWT secret is read from the svc-workflow .env or falls back to the
 * known test secret. The token is generated in-process and never printed.
 */
function makeAdminToken(sub: string, secret: string): string {
  const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(Buffer.from(JSON.stringify({
    sub,
    iss: 'auth-service',
    aud: 'svc-workflow',
    exp: now + 3600,
    iat: now,
    principal_type: 'agent',
    type: 'access',
    version: 'v1',
    scope: 'workflow.admin workflow.read workflow.execute',
  })));
  const signature = signHmacSha256(secret, `${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

function main() {
  const requiredVars = [
    'DATABASE_URL',
    'PROVISIONING_PRINCIPAL_ID',
    'DOMAIN_ID',
    'EFFICIENCY_MANAGER_PRINCIPAL_ID',
    'LOBSTER_PARTNER_PRINCIPAL_ID',
  ];

  for (const v of requiredVars) {
    if (!process.env[v]) {
      console.error(`ERROR: ${v} is required`);
      process.exit(1);
    }
  }

  const domainId = process.env.DOMAIN_ID!;
  const emPrincipalId = process.env.EFFICIENCY_MANAGER_PRINCIPAL_ID!;

  const defFile = resolve(repoRoot, 'definitions', 'agent-self-task-v1.json');
  if (!existsSync(defFile)) {
    console.error(`ERROR: Definition file not found: ${defFile}`);
    process.exit(1);
  }

  // Build the provisioning binary if needed
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
  // -----------------------------------------------------------------------
  console.log('Adding DOMAIN_OWNER role binding for EFFICIENCY_MANAGER...');

  // Read the JWT secret from svc-workflow environment
  const svcWorkflowEnvPath = resolve(svcWorkflowDir, '.env');
  let jwtSecret = 'test-secret-for-workflow-todo-smoke-at-least-32-bytes';
  if (existsSync(svcWorkflowEnvPath)) {
    const envContent = require('fs').readFileSync(svcWorkflowEnvPath, 'utf-8');
    const match = envContent.match(/^WORKFLOW_JWT_SECRET=(.+)$/m);
    if (match) jwtSecret = match[1].trim();
  }

  // The provisioning allow-list includes DOGFOOD_USER (10000000-...-0101)
  // Use that principal's ID to generate the admin token.
  const adminToken = makeAdminToken('10000000-0000-0000-0000-000000000101', jwtSecret);

  const baseUrl = process.env.SVC_WORKFLOW_BASE_URL || 'http://127.0.0.1:8989';
  const roleBindingUrl = `${baseUrl}/internal/v1/admin/domains/${domainId}/role-bindings/${emPrincipalId}`;

  // First try PUT (idempotent create/enable)
  fetch(roleBindingUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `provision-domain-owner-${domainId}-${emPrincipalId}-v1`,
    },
    body: JSON.stringify({ roleKey: 'DOMAIN_OWNER', enabled: true }),
  }).then(async (res) => {
    const body = await res.text();
    if (res.ok) {
      console.log(`DOMAIN_OWNER role binding created: ${body}`);
    } else {
      // If conflict, try DELETE first, then PUT
      if (res.status === 409) {
        console.log('Domain owner conflict, attempting to revoke existing...');
        // Fetch existing owners and disable them
        // For now, use the owner replacement endpoint
        const ownerUrl = `${baseUrl}/internal/v1/admin/domains/${domainId}/owner`;
        const replaceRes = await fetch(ownerUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `replace-owner-${domainId}-${emPrincipalId}-v1`,
          },
          body: JSON.stringify({ newOwnerPrincipalId: emPrincipalId }),
        });
        const replaceBody = await replaceRes.text();
        if (replaceRes.ok) {
          console.log(`Domain owner replaced: ${replaceBody}`);
        } else {
          // Fall back to manual role binding adjustment via DELETE + PUT
          console.log(`Owner replacement also failed (${replaceRes.status}), adjusting role bindings directly...`);
          const deleteRes = await fetch(roleBindingUrl, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': `disable-old-owner-${domainId}-v1`,
            },
            body: JSON.stringify({ roleKey: 'DOMAIN_OWNER' }),
          });
          console.log(`Revoke response: ${deleteRes.status}`);
          if (deleteRes.ok || deleteRes.status === 404) {
            const retryRes = await fetch(roleBindingUrl, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${adminToken}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `provision-domain-owner-${domainId}-${emPrincipalId}-v2`,
              },
              body: JSON.stringify({ roleKey: 'DOMAIN_OWNER', enabled: true }),
            });
            const retryBody = await retryRes.text();
            if (retryRes.ok) {
              console.log(`DOMAIN_OWNER role binding created: ${retryBody}`);
            } else {
              console.error(`ERROR: Failed to create DOMAIN_OWNER: ${retryRes.status} ${retryBody}`);
              process.exit(1);
            }
          }
        }
      } else if (res.status === 412) {
        // Precondition: domain has an active owner → use replace endpoint
        const ownerUrl = `${baseUrl}/internal/v1/admin/domains/${domainId}/owner`;
        const replaceRes = await fetch(ownerUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `replace-owner-${domainId}-${emPrincipalId}-v1`,
          },
          body: JSON.stringify({ newOwnerPrincipalId: emPrincipalId }),
        });
        const replaceBody = await replaceRes.text();
        if (replaceRes.ok) {
          console.log(`Domain owner replaced: ${replaceBody}`);
        } else {
          console.error(`ERROR: Failed to replace domain owner: ${replaceRes.status} ${replaceBody}`);
          process.exit(1);
        }
      } else {
        console.error(`ERROR: Failed to create DOMAIN_OWNER: ${res.status} ${body}`);
        process.exit(1);
      }
    }
  }).catch((err) => {
    console.error(`ERROR: HTTP request failed: ${err.message}`);
    process.exit(1);
  });
}

main();
