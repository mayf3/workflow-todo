import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Config validation — the SDK Auth V1 path is the only runtime path.
// The legacy path, static token, and WORKFLOW_TODO_WORKFLOW_PATH flag
// have been removed. There is no fallback and no alternative runtime path.
// ---------------------------------------------------------------------------

describe('Config — required auth-service env vars', () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    // Clear env vars for each test
    delete process.env.SVC_AUTH_TOKEN_ENDPOINT;
    delete process.env.SVC_AUTH_MACHINE_CLIENT_ID;
    delete process.env.SVC_AUTH_MACHINE_CLIENT_SECRET;
    delete process.env.SVC_WORKFLOW_BASE_URL;
    delete process.env.DOMAIN_ID;
    delete process.env.PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID;
    delete process.env.AGENT_SELF_TASK_DEFINITION_VERSION_ID;
    delete process.env.DEFINITION_VERSION_ID;
    delete process.env.EFFICIENCY_MANAGER_PRINCIPAL_ID;
    delete process.env.LOBSTER_PARTNER_PRINCIPAL_ID;
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('throws when SVC_AUTH_TOKEN_ENDPOINT is missing', async () => {
    setAllExcept('SVC_AUTH_TOKEN_ENDPOINT');
    const mod = await import('../src/config.js');
    expect(() => mod.env.SVC_AUTH_TOKEN_ENDPOINT).toThrow(/SVC_AUTH_TOKEN_ENDPOINT/);
  });

  it('throws when SVC_AUTH_MACHINE_CLIENT_ID is missing', async () => {
    setAllExcept('SVC_AUTH_MACHINE_CLIENT_ID');
    const mod = await import('../src/config.js');
    expect(() => mod.env.SVC_AUTH_MACHINE_CLIENT_ID).toThrow(/SVC_AUTH_MACHINE_CLIENT_ID/);
  });

  it('throws when SVC_AUTH_MACHINE_CLIENT_SECRET is missing', async () => {
    setAllExcept('SVC_AUTH_MACHINE_CLIENT_SECRET');
    const mod = await import('../src/config.js');
    expect(() => mod.env.SVC_AUTH_MACHINE_CLIENT_SECRET).toThrow(/SVC_AUTH_MACHINE_CLIENT_SECRET/);
  });

  it('throws when SVC_WORKFLOW_BASE_URL is missing', async () => {
    setAllExcept('SVC_WORKFLOW_BASE_URL');
    const mod = await import('../src/config.js');
    expect(() => mod.env.SVC_WORKFLOW_BASE_URL).toThrow(/SVC_WORKFLOW_BASE_URL/);
  });

  it('throws when DOMAIN_ID is missing', async () => {
    setAllExcept('DOMAIN_ID');
    const mod = await import('../src/config.js');
    expect(() => mod.env.DOMAIN_ID).toThrow(/DOMAIN_ID/);
  });

  it('config does not export workflow path or static token', async () => {
    setAll();
    const mod = await import('../src/config.js');
    const env = mod.env;

    // No workflow path config (removed)
    expect((env as Record<string, unknown>).WORKFLOW_TODO_WORKFLOW_PATH).toBeUndefined();
    // No static access token (removed)
    expect((env as Record<string, unknown>).SVC_WORKFLOW_ACCESS_TOKEN).toBeUndefined();
    // validateWorkflowPath and resolveWorkflowPath should not exist
    expect((mod as Record<string, unknown>).validateWorkflowPath).toBeUndefined();
    expect((mod as Record<string, unknown>).resolveWorkflowPath).toBeUndefined();
  });

  it('config exports required auth fields', async () => {
    setAll();
    const mod = await import('../src/config.js');
    const cfg = mod.env;

    expect(cfg.SVC_AUTH_TOKEN_ENDPOINT).toBe('http://localhost:4001/oauth/token');
    expect(cfg.SVC_AUTH_MACHINE_CLIENT_ID).toBe('mc_test');
    expect(cfg.SVC_AUTH_MACHINE_CLIENT_SECRET).toBe('secret');
    expect(cfg.SVC_WORKFLOW_BASE_URL).toBe('http://localhost:8989');
    expect(cfg.DOMAIN_ID).toBe('d');
    expect(cfg.SVC_AUTH_MACHINE_RESOURCE).toBe('svc-workflow');
    expect(cfg.SVC_AUTH_MACHINE_SCOPES).toBe('workflow.read');
  });
});

function setAll(): void {
  process.env.SVC_AUTH_TOKEN_ENDPOINT = 'http://localhost:4001/oauth/token';
  process.env.SVC_AUTH_MACHINE_CLIENT_ID = 'mc_test';
  process.env.SVC_AUTH_MACHINE_CLIENT_SECRET = 'secret';
  process.env.SVC_WORKFLOW_BASE_URL = 'http://localhost:8989';
  process.env.DOMAIN_ID = 'd';
  process.env.PERSONAL_QUICK_ITEM_DEFINITION_VERSION_ID = 'v1';
  process.env.AGENT_SELF_TASK_DEFINITION_VERSION_ID = 'v2';
  process.env.DEFINITION_VERSION_ID = 'v3';
  process.env.EFFICIENCY_MANAGER_PRINCIPAL_ID = 'em';
  process.env.LOBSTER_PARTNER_PRINCIPAL_ID = 'lp';
}

function setAllExcept(except: string): void {
  setAll();
  delete process.env[except];
}
