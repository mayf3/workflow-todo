#!/usr/bin/env node

/**
 * Smoke test for the first vertical slice of workflow-todo.
 *
 * Prerequisites:
 *   - svc-workflow is running and reachable at SVC_WORKFLOW_BASE_URL
 *   - agent_self_task_v1 definition is provisioned
 *   - AGENT_A_PRINCIPAL_ID is set (the principal UUID to act as Agent A)
 *   - Access token for Agent A is in SVC_WORKFLOW_ACCESS_TOKEN
 *
 * Flow:
 *   1. Agent A creates an instance → sees it in assigned-to-me (propose)
 *   2. Agent A advances → efficiency manager sees it in assigned-to-me
 *   3. Agent A no longer sees it in assigned-to-me
 *   4. Agent A cannot execute the efficiency_check transition
 */

import { env } from '../src/config.js';
import { WorkflowClient } from '../src/client.js';

const PASS = '✅';
const FAIL = '❌';
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ${PASS} ${message}`);
    passed++;
  } else {
    console.error(`  ${FAIL} ${message}`);
    failed++;
  }
}

async function main() {
  console.log('\n=== workflow-todo Smoke Test ===\n');

  // Validate required env
  if (!env.AGENT_A_PRINCIPAL_ID) {
    console.error('ERROR: AGENT_A_PRINCIPAL_ID is required for smoke test');
    process.exit(1);
  }

  // Use Agent A's token (we reuse the same token; in production Agent A would have its own)
  const agentToken = env.SVC_WORKFLOW_ACCESS_TOKEN;

  const agentClient = new WorkflowClient({
    baseUrl: env.SVC_WORKFLOW_BASE_URL,
    accessTokenProvider: () => agentToken,
    requestTimeoutMs: parseInt(env.REQUEST_TIMEOUT_MS, 10),
    maxAttempts: parseInt(env.MAX_ATTEMPTS, 10) as 1 | 2 | 3,
  });

  // We need a separate token for the efficiency manager.
  // For smoke tests, both Agent A and efficiency manager share the same
  // access token because the test environment uses test-mode auth.
  // In production, each actor would have distinct tokens.
  const efficiencyToken = env.SVC_WORKFLOW_ACCESS_TOKEN;

  const efficiencyClient = new WorkflowClient({
    baseUrl: env.SVC_WORKFLOW_BASE_URL,
    accessTokenProvider: () => efficiencyToken,
    requestTimeoutMs: parseInt(env.REQUEST_TIMEOUT_MS, 10),
    maxAttempts: parseInt(env.MAX_ATTEMPTS, 10) as 1 | 2 | 3,
  });

  // Verify svc-workflow is reachable
  console.log('\n[Preflight]');
  try {
    await agentClient.assertSmokeReady();
    console.log(`  ${PASS} svc-workflow is reachable`);
  } catch (e) {
    console.error(`  ${FAIL} svc-workflow preflight failed: ${e}`);
    failed++;
    process.exit(1);
  }

  // Step 1: Agent A creates an instance
  console.log('\n[Step 1] Agent A creates an instance');
  let instanceId: string;
  try {
    const result = await agentClient.create(
      {
        domainId: env.DOMAIN_ID,
        definitionVersionId: env.DEFINITION_VERSION_ID,
        metadata: {},
        contextPayload: {
          title: 'Smoke test task',
          description: 'Created during smoke test',
          acceptanceCriteria: 'Smoke test passes',
        },
      },
      { idempotencyKey: `smoke-create-${Date.now()}` },
    );
    instanceId = result.workflowInstanceId;
    assert(true, `Instance created: ${instanceId}`);
  } catch (e) {
    console.error(`  ${FAIL} Failed to create instance: ${e}`);
    failed++;
    process.exit(1);
  }

  // Step 2: Agent A queries assigned-to-me → should see the instance at propose
  console.log('\n[Step 2] Agent A queries assigned-to-me');
  try {
    const page = await agentClient.worklistAssignedToMe();
    const found = page.items.some(
      (item) =>
        item.detail.instance.workflowInstanceId === instanceId &&
        item.detail.instance.currentNode.nodeKey === 'propose',
    );
    assert(found, 'Agent A sees the instance in assigned-to-me at propose node');
  } catch (e) {
    assert(false, `Failed to query worklist: ${e}`);
  }

  // Step 3: Agent A advances the instance
  console.log('\n[Step 3] Agent A advances the instance');
  try {
    const detail = await agentClient.detail(instanceId);
    if (detail.visibility !== 'full') {
      assert(false, 'Instance detail is not full visibility');
      process.exit(1);
    }
    const advanceTransition = detail.detail.outgoing_transitions.find(
      (t) => t.transition_effect === 'ADVANCE' && t.executable_for_actor === true,
    );
    if (!advanceTransition) {
      assert(false, 'No executable ADVANCE transition found');
      process.exit(1);
    }
    await agentClient.transition(
      instanceId,
      {
        transitionDefinitionId: advanceTransition.transition_id,
        expectedWorkflowStateVersion: detail.detail.instance.workflow_state_version,
        submissionPayload: { summary: 'Smoke test proposal' },
      },
      { idempotencyKey: `smoke-advance-${Date.now()}` },
    );
    assert(true, 'Advance succeeded');
  } catch (e) {
    assert(false, `Failed to advance: ${e}`);
  }

  // Step 4: Efficiency manager queries assigned-to-me → should see at efficiency_check
  console.log('\n[Step 4] Efficiency manager queries assigned-to-me');
  try {
    const page = await efficiencyClient.worklistAssignedToMe();
    const found = page.items.some(
      (item) =>
        item.detail.instance.workflowInstanceId === instanceId &&
        item.detail.instance.currentNode.nodeKey === 'efficiency_check',
    );
    assert(found, 'Efficiency manager sees the instance at efficiency_check node');
  } catch (e) {
    assert(false, `Failed to query worklist for efficiency manager: ${e}`);
  }

  // Step 5: Agent A queries assigned-to-me → should NOT contain the instance anymore
  console.log('\n[Step 5] Agent A queries assigned-to-me (should no longer see the instance)');
  try {
    const page = await agentClient.worklistAssignedToMe();
    const found = page.items.some(
      (item) => item.detail.instance.workflowInstanceId === instanceId,
    );
    assert(!found, 'Agent A no longer sees the instance in assigned-to-me');
  } catch (e) {
    assert(false, `Failed to query worklist: ${e}`);
  }

  // Step 6: Agent A attempts to execute efficiency_check transition (should fail)
  console.log('\n[Step 6] Agent A attempts efficiency_check transition (should be blocked)');
  try {
    const detail = await agentClient.detail(instanceId);
    if (detail.visibility === 'full') {
      const efficiencyTransition = detail.detail.outgoing_transitions.find(
        (t) => t.transition_effect === 'ADVANCE',
      );
      if (efficiencyTransition) {
        assert(
          !efficiencyTransition.executable_for_actor,
          'Efficiency ADVANCE is not executable for Agent A',
        );
      } else {
        assert(false, 'No ADVANCE transition found');
      }
    } else {
      // Historical participant — Agent A can see the instance but cannot act
      assert(true, 'Instance is historical for Agent A (cannot execute transitions)');
    }
  } catch (e) {
    assert(false, `Error checking transitions: ${e}`);
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Smoke test error:', e);
  process.exit(1);
});
