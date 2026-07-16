import { describe, expect, it, vi } from 'vitest';
import { WorkflowClient, WorkflowError } from '../src/client.js';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const DOMAIN_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const TRANSITION_ID = '88888888-8888-4888-8888-888888888888';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchMock: typeof globalThis.fetch): WorkflowClient {
  globalThis.fetch = fetchMock;
  return new WorkflowClient({
    baseUrl: 'http://127.0.0.1:8989',
    accessTokenProvider: () => 'test-token',
    maxAttempts: 1,
  });
}

describe('WorkflowClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls create and returns expected shape', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, {
        workflowInstanceId: INSTANCE_ID,
        workflowStateVersion: 1,
        currentContextRevisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        currentNodeVisitId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        eventSequence: 1,
      }),
    );
    const client = makeClient(fetchMock);

    const result = await client.create(
      { domainId: DOMAIN_ID, definitionVersionId: DEFINITION_ID, metadata: {}, contextPayload: {} },
      { idempotencyKey: 'create-key' },
    );

    expect(result.workflowInstanceId).toBe(INSTANCE_ID);
    expect(result.workflowStateVersion).toBe(1);
  });

  it('rejects create with extra fields (actor override protection)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(422, {
        error: { code: 'invalid_input', message: 'unknown field principalId' },
      }),
    );
    const client = makeClient(fetchMock);

    await expect(
      client.create(
        {
          domainId: DOMAIN_ID,
          definitionVersionId: DEFINITION_ID,
          metadata: {},
          contextPayload: {},
          principalId: INSTANCE_ID,
        } as never,
        { idempotencyKey: 'create-key' },
      ),
    ).rejects.toThrow(WorkflowError);
  });

  it('rejects invalid idempotency key without transport', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, {}));
    const client = makeClient(fetchMock);

    await expect(
      client.create(
        { domainId: DOMAIN_ID, definitionVersionId: DEFINITION_ID, metadata: {}, contextPayload: {} },
        { idempotencyKey: 'has space' },
      ),
    ).rejects.toThrow(WorkflowError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects expired stateVersion on transition', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, {
        error: {
          code: 'workflow_state_version_conflict',
          message: 'workflow state version does not match',
        },
      }),
    );
    const client = makeClient(fetchMock);

    await expect(
      client.transition(
        INSTANCE_ID,
        { transitionDefinitionId: TRANSITION_ID, expectedWorkflowStateVersion: 1 },
        { idempotencyKey: 'transition-key' },
      ),
    ).rejects.toMatchObject({
      kind: 'api',
      status: 409,
      code: 'workflow_state_version_conflict',
      attempts: 1,
    });
  });

  it('idempotency key retry does not duplicate', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      return jsonResponse(201, {
        workflowInstanceId: INSTANCE_ID,
        workflowStateVersion: 1,
        currentContextRevisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        currentNodeVisitId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        eventSequence: 1,
      });
    });
    const client = makeClient(fetchMock);

    const result1 = await client.create(
      { domainId: DOMAIN_ID, definitionVersionId: DEFINITION_ID, metadata: {}, contextPayload: {} },
      { idempotencyKey: 'same-key' },
    );
    const result2 = await client.create(
      { domainId: DOMAIN_ID, definitionVersionId: DEFINITION_ID, metadata: {}, contextPayload: {} },
      { idempotencyKey: 'same-key' },
    );

    // svc-workflow handles idempotency server-side; client just passes the key
    // Both calls should use the same idempotency key
    const bodies = fetchMock.mock.calls.map(([_, init]) =>
      JSON.parse(String((init as RequestInit).body)),
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(result1).toEqual(result2);
  });

  it('assigned-to-me returns worklist page shape', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        items: [
          {
            detail: {
              instance: {
                workflowInstanceId: INSTANCE_ID,
                domainId: DOMAIN_ID,
                definitionVersionId: DEFINITION_ID,
                definitionVersionStatus: 'PUBLISHED',
                createdByPrincipalId: INSTANCE_ID,
                workflowStateVersion: 1,
                createdAt: '2026-07-17T00:00:00Z',
                domainEnabled: true,
                isTerminal: false,
                currentNode: {
                  nodeId: 'node-1',
                  nodeKey: 'propose',
                  displayName: 'Propose',
                  nodeType: 'NORMAL',
                },
              },
              currentContextRevisionId: 'ctx-1',
              currentNodeVisitId: 'visit-1',
              currentContext: {
                contextRevisionId: 'ctx-1',
                workflowInstanceId: INSTANCE_ID,
                revisionNumber: 1,
                previousRevisionId: null,
                payload: {},
                payloadDigest: 'digest',
                createdByPrincipalId: INSTANCE_ID,
                createdAt: '2026-07-17T00:00:00Z',
              },
              currentVisit: {
                nodeVisitId: 'visit-1',
                workflowInstanceId: INSTANCE_ID,
                node: {
                  nodeId: 'node-1',
                  nodeKey: 'propose',
                  displayName: 'Propose',
                  nodeType: 'NORMAL',
                },
                visitNumber: 1,
                assigneePrincipalId: INSTANCE_ID,
                enteredByTransitionId: null,
                instructions: null,
                createdAt: '2026-07-17T00:00:00Z',
              },
              outgoingTransitions: [],
            },
            upstreamSubmissions: [],
            returnFeedbackEvents: [],
            submissionsTruncated: false,
            returnEventsTruncated: false,
          },
        ],
        nextCursor: null,
      }),
    );
    const client = makeClient(fetchMock);

    const page = await client.worklistAssignedToMe();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].detail.instance.currentNode.nodeKey).toBe('propose');
    expect(page.items[0].detail.instance.workflowStateVersion).toBe(1);
  });
});
