#!/usr/bin/env node

/**
 * Smoke test for workflow-todo SDK Auth V1 path.
 *
 * Prerequisites:
 *   - auth-service running at SVC_AUTH_TOKEN_ENDPOINT
 *   - svc-workflow running at SVC_WORKFLOW_BASE_URL
 *   - Machine Client for Agent A provisioned with workflow.read + workflow.execute
 *
 * Flow:
 *   1. Agent A creates an instance → sees it in assigned-to-me (propose)
 *   2. Agent A advances → efficiency manager sees it in assigned-to-me
 *   3. Agent A no longer sees it in assigned-to-me
 *   4. Agent A cannot execute the efficiency_check transition
 */

import { createSdkAuthWorkflowClient } from '../src/sdk-auth-client-factory.js';
import { env } from '../src/config.js';
import { toWorklistPageView } from '../src/sdk-adapter.js';

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
  console.log('\n=== workflow-todo SDK Auth V1 Smoke Test ===\n');

  // Create Agent A client using the Machine Token Provider
  const agentClient = createSdkAuthWorkflowClient();
  const efficiencyClient = createSdkAuthWorkflowClient({
    scopes: ['workflow.read', 'workflow.execute'],
  });

  // Verify svc-workflow is reachable
  console.log('\n[Preflight]');
  try {
    const preflight = await agentClient.worklistAssignedToMe();
    console.log(`  ${PASS} svc-workflow is reachable`);
  } catch (e) {
    console.error(`  ${FAIL} svc-workflow preflight failed: ${e}`);
    failed++;
    process.exit(1);
  }

  // Step 1: Agent A creates an instance
  console.log('\n[Step 1] Agent A creates an instance');
  let instanceId: string;
  const createKey1 = `smoke-create-${Date.now()}`;
  try {
    const result = await agentClient.create(
      {
        domainId: env.DOMAIN_ID,
        definitionVersionId: env.DEFINITION_VERSION_ID,
        metadata: {},
        contextPayload: {
          title: 'SDK Smoke test task',
          description: 'Created during SDK smoke test',
          acceptanceCriteria: 'Smoke test passes',
        },
      },
      { idempotencyKey: createKey1 },
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
      (item: { detail: { instance: { workflow_instance_id: string; current_node: { node_key: string } } } }) =>
        item.detail.instance.workflow_instance_id === instanceId &&
        item.detail.instance.current_node.node_key === 'propose',
    );
    assert(found, 'Agent A sees the instance in assigned-to-me at propose node');
  } catch (e) {
    assert(false, `Failed to query worklist: ${e}`);
  }

  // Step 3: Agent A advances the instance
  console.log('\n[Step 3] Agent A advances the instance');
  try {
    const detail = await agentClient.detail(instanceId);
    const raw = detail as unknown as Record<string, unknown>;
    if (raw.visibility !== 'full') {
      assert(false, 'Instance detail is not full visibility');
      process.exit(1);
    }
    const det = raw.detail as Record<string, unknown>;
    const instance = det.instance as Record<string, unknown>;
    const outgoingTransitions = det.outgoing_transitions as Array<Record<string, unknown>> | undefined;
    const advanceTransition = outgoingTransitions?.find(
      (t: { transition_effect?: string; executable_for_actor?: boolean }) =>
        t.transition_effect === 'ADVANCE' && t.executable_for_actor === true,
    );
    if (!advanceTransition) {
      assert(false, 'No executable ADVANCE transition found');
      process.exit(1);
    }
    await agentClient.transition(
      instanceId,
      {
        transitionDefinitionId: advanceTransition.transition_id as string,
        expectedWorkflowStateVersion: instance.workflow_state_version as number,
        submissionPayload: { summary: 'SDK Smoke test proposal' },
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
      (item: { detail: { instance: { workflow_instance_id: string; current_node: { node_key: string } } } }) =>
        item.detail.instance.workflow_instance_id === instanceId &&
        item.detail.instance.current_node.node_key === 'efficiency_check',
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
      (item: { detail: { instance: { workflow_instance_id: string } } }) =>
        item.detail.instance.workflow_instance_id === instanceId,
    );
    assert(!found, 'Agent A no longer sees the instance in assigned-to-me');
  } catch (e) {
    assert(false, `Failed to query worklist: ${e}`);
  }

  // Step 6: Agent A attempts to execute efficiency_check transition (should fail)
  console.log('\n[Step 6] Agent A attempts efficiency_check transition (should be blocked)');
  try {
    const detail = await agentClient.detail(instanceId);
    const raw = detail as unknown as Record<string, unknown>;
    if (raw.visibility === 'full') {
      const det = raw.detail as Record<string, unknown>;
      const outgoingTransitions = det.outgoing_transitions as Array<Record<string, unknown>> | undefined;
      const advTrans = outgoingTransitions?.find(
        (t: { transition_effect?: string }) => t.transition_effect === 'ADVANCE',
      );
      if (advTrans) {
        assert(
          !advTrans.executable_for_actor,
          'Efficiency ADVANCE is not executable for Agent A',
        );
      } else {
        assert(false, 'No ADVANCE transition found');
      }
    } else {
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
