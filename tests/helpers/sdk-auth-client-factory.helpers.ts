/**
 * Shared test helpers for sdk-auth-client-factory tests
 *
 * Extracted from the monolithic test file to support per-responsibility split.
 */

import { createSdkAuthWorkflowClient } from '../../src/sdk-auth-client-factory.js';

export { createSdkAuthWorkflowClient };

export interface MockResponse {
  status: number;
  body: Record<string, unknown> | string;
  headers?: Record<string, string>;
}

/**
 * Safely extract URL string from RequestInfo | URL
 */
export function urlStr(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  // Request object
  return input.url;
}

/**
 * Create a mock fetch implementation for testing.
 * The first call is expected to be the auth token request (POST /oauth/token),
 * and subsequent calls are workflow API calls.
 */
export function makeMockFetch(responses: MockResponse[]): typeof fetch {
  let callIndex = 0;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const idx = callIndex;
    callIndex++;

    if (idx >= responses.length) {
      return new Response(JSON.stringify({ error: 'unexpected call' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const mock = responses[idx];
    const bodyStr = typeof mock.body === 'string' ? mock.body : JSON.stringify(mock.body);

    return new Response(bodyStr, {
      status: mock.status,
      headers: {
        'Content-Type': 'application/json',
        ...mock.headers,
      },
    });
  };
}

/**
 * Success response from the auth token endpoint.
 * Returns a fake access token with 1 hour expiry.
 */
export function makeAuthSuccess(overrides?: Partial<{ accessToken: string; expiresIn: number }>): MockResponse {
  return {
    status: 200,
    body: {
      access_token: overrides?.accessToken ?? 'mock-access-token-for-testing',
      token_type: 'Bearer',
      expires_in: overrides?.expiresIn ?? 3600,
    },
  };
}

export const VALID_UUID = '00000000-0000-4000-8000-000000000001';
export const VALID_DEF_ID = '00000000-0000-4000-8000-000000000002';
export const VALID_DOMAIN_ID = '00000000-0000-4000-8000-000000000003';

/**
 * Success response from the workflow worklist endpoint.
 */
export function makeWorklistSuccess(items = 0): MockResponse {
  const entries = [];
  for (let i = 0; i < items; i++) {
    entries.push({
      detail: {
        instance: {
          workflow_instance_id: VALID_UUID,
          domain_id: VALID_DOMAIN_ID,
          definition_version_id: VALID_DEF_ID,
          definition_version_status: 'PUBLISHED',
          created_by_principal_id: '00000000-0000-4000-8000-000000000010',
          workflow_state_version: 1,
          external_reference: null,
          external_url: null,
          metadata: null,
          created_at: '2026-07-17T14:20:00Z',
          domain_enabled: true,
          is_terminal: false,
          current_node: {
            node_id: '00000000-0000-4000-8000-000000000020',
            node_key: 'propose',
            display_name: 'Propose',
            node_type: 'DRAFT',
          },
        },
        current_context_revision_id: '00000000-0000-4000-8000-000000000030',
        current_node_visit_id: '00000000-0000-4000-8000-000000000040',
        current_context: {
          context_revision_id: '00000000-0000-4000-8000-000000000030',
          workflow_instance_id: VALID_UUID,
          revision_number: 1,
          previous_revision_id: null,
          payload: { title: `Item ${i + 1}` },
          payload_digest: 'd1',
          created_by_principal_id: '00000000-0000-4000-8000-000000000010',
          created_at: '2026-07-17T14:20:00Z',
        },
        current_visit: {
          node_visit_id: '00000000-0000-4000-8000-000000000040',
          workflow_instance_id: VALID_UUID,
          node: {
            node_id: '00000000-0000-4000-8000-000000000020',
            node_key: 'propose',
            display_name: 'Propose',
            node_type: 'DRAFT',
          },
          visit_number: 1,
          assignee_principal_id: '00000000-0000-4000-8000-000000000010',
          entered_by_transition_id: null,
          instructions: null,
          created_at: '2026-07-17T14:20:00Z',
        },
        outgoing_transitions: [],
      },
      upstream_submissions: [],
      return_feedback_events: [],
      submissions_truncated: false,
      return_events_truncated: false,
    });
  }
  return {
    status: 200,
    body: { items: entries, next_cursor: null },
  };
}

export function makeCreateSuccess(): MockResponse {
  return {
    status: 200,
    body: {
      workflowInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workflowStateVersion: 1,
      currentContextRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      currentNodeVisitId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      eventSequence: 1,
    },
  };
}

export function makeDetailWithAdvance(): MockResponse {
  return {
    status: 200,
    body: {
      visibility: 'full',
      detail: {
        instance: {
          workflow_instance_id: VALID_UUID,
          domain_id: VALID_DOMAIN_ID,
          definition_version_id: VALID_DEF_ID,
          definition_version_status: 'PUBLISHED',
          created_by_principal_id: '00000000-0000-4000-8000-000000000010',
          workflow_state_version: 5,
          external_reference: null,
          external_url: null,
          metadata: null,
          created_at: '2026-07-17T14:20:00Z',
          domain_enabled: true,
          is_terminal: false,
          current_node: {
            node_id: '00000000-0000-4000-8000-000000000021',
            node_key: 'efficiency_check',
            display_name: 'Efficiency Check',
            node_type: 'APPROVAL',
          },
        },
        current_context_revision_id: '00000000-0000-4000-8000-000000000031',
        current_node_visit_id: '00000000-0000-4000-8000-000000000041',
        current_context: null,
        current_visit: null,
        outgoing_transitions: [
          {
            transition_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            transition_effect: 'ADVANCE',
            executable_for_actor: true,
            blocked_reason: null,
            target_node: {
              node_id: '00000000-0000-4000-8000-000000000022',
              node_key: 'completed',
              display_name: 'Completed',
              node_type: 'TERMINAL',
            },
          },
        ],
      },
    },
  };
}

export function makeTransitionSuccess(): MockResponse {
  return {
    status: 200,
    body: {
      workflowInstanceId: VALID_UUID,
      workflowStateVersion: 6,
      currentContextRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sourceNodeVisitId: '00000000-0000-4000-8000-000000000041',
      currentNodeVisitId: '00000000-0000-4000-8000-000000000042',
      submissionId: null,
      eventSequence: 3,
    },
  };
}
