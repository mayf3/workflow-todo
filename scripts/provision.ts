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
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

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
}

main();
