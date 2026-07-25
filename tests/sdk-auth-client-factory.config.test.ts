/**
 * Tests for SDK Auth Client Factory — Config Validation
 *
 * Verifies that the factory eagerly validates required configuration fields.
 */

import { describe, expect, it } from 'vitest';
import { createSdkAuthWorkflowClient, makeMockFetch, makeAuthSuccess, makeWorklistSuccess } from './helpers/sdk-auth-client-factory.helpers.js';

// ---------------------------------------------------------------------------
// Factory config validation
// ---------------------------------------------------------------------------

describe('createSdkAuthWorkflowClient config validation', () => {
  it('throws when baseUrl is missing', () => {
    expect(() =>
      createSdkAuthWorkflowClient({
        baseUrl: '',
        tokenEndpoint: 'http://auth/token',
        clientId: 'mc_test',
        credentialProvider: () => 'secret',
        resource: 'svc-workflow',
        scopes: ['workflow.read'],
        requestTimeoutMs: 5000,
        fetch: makeMockFetch([]),
      }),
    ).toThrow('SVC_WORKFLOW_BASE_URL is required');
  });

  it('throws when tokenEndpoint is missing', () => {
    expect(() =>
      createSdkAuthWorkflowClient({
        baseUrl: 'http://workflow/api',
        tokenEndpoint: '',
        clientId: 'mc_test',
        credentialProvider: () => 'secret',
        resource: 'svc-workflow',
        scopes: ['workflow.read'],
        requestTimeoutMs: 5000,
        fetch: makeMockFetch([]),
      }),
    ).toThrow('SVC_AUTH_TOKEN_ENDPOINT is required');
  });

  it('throws when clientId is missing', () => {
    expect(() =>
      createSdkAuthWorkflowClient({
        baseUrl: 'http://workflow/api',
        tokenEndpoint: 'http://auth/token',
        clientId: '',
        credentialProvider: () => 'secret',
        resource: 'svc-workflow',
        scopes: ['workflow.read'],
        requestTimeoutMs: 5000,
        fetch: makeMockFetch([]),
      }),
    ).toThrow('SVC_AUTH_MACHINE_CLIENT_ID is required');
  });

  it('accepts valid minimal config', () => {
    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => 'mock-secret',
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: makeMockFetch([makeAuthSuccess(), makeWorklistSuccess(0)]),
    });
    expect(client).toBeDefined();
    expect(typeof client.worklistAssignedToMe).toBe('function');
  });

  it('rejects credential provider that throws at call time', async () => {
    const client = createSdkAuthWorkflowClient({
      baseUrl: 'http://workflow/api',
      tokenEndpoint: 'http://auth/token',
      clientId: 'mc_test',
      credentialProvider: () => { throw new Error('secret loading failed'); },
      resource: 'svc-workflow',
      scopes: ['workflow.read'],
      requestTimeoutMs: 5000,
      fetch: makeMockFetch([]),
    });

    // The error from credentialProvider is caught by the MachineTokenProvider
    // and rethrown as ConfigurationError
    await expect(client.worklistAssignedToMe()).rejects.toThrow();
  });
});
