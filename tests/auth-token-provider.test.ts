import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AuthServiceMachineTokenProvider, TokenProviderError } from '../src/auth-token-provider.js';

const TOKEN_ENDPOINT = 'http://auth-test:3000/oauth/token';
const CLIENT_ID = 'mc_testClientId1234567890abcd';
const CLIENT_SECRET = 'test-secret-value-43-chars-base64url-encoded!';

/** Build a mock token endpoint response. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'pragma': 'no-cache' },
  });
}

describe('AuthServiceMachineTokenProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Silence provider logs during tests
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  it('requires all config fields', () => {
    expect(() => new AuthServiceMachineTokenProvider({ tokenEndpoint: '', clientId: 'c', clientSecret: 's' }))
      .toThrow('tokenEndpoint is required');
    expect(() => new AuthServiceMachineTokenProvider({ tokenEndpoint: 'http://e', clientId: '', clientSecret: 's' }))
      .toThrow('clientId is required');
    expect(() => new AuthServiceMachineTokenProvider({ tokenEndpoint: 'http://e', clientId: 'c', clientSecret: '' }))
      .toThrow('clientSecret is required');
  });

  // -----------------------------------------------------------------------
  // Successful token fetch
  // -----------------------------------------------------------------------

  it('fetches token with correct endpoint, audience, and scope', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      access_token: 'eyJhbG.eyJzdWI.valid-signature',
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'workflow.read',
    }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    const token = await provider.getToken();

    expect(token).toBe('eyJhbG.eyJzdWI.valid-signature');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify the request was made to the correct endpoint
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(init.method).toBe('POST');

    // Verify Basic auth header
    const headers = new Headers(init.headers);
    const expectedAuth = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    expect(headers.get('authorization')).toBe(expectedAuth);
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');

    // Verify body contains correct audience and scope
    const body = typeof init.body === 'string' ? init.body : '';
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('resource=svc-workflow');
    expect(body).toContain('scope=workflow.read');
  });

  // -----------------------------------------------------------------------
  // Cache hit (within safety window)
  // -----------------------------------------------------------------------

  it('returns cached token within safety window', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      access_token: 'cached-token-value',
      token_type: 'Bearer',
      expires_in: 600, // 10 minutes
      scope: 'workflow.read',
    }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    // First call fetches from server
    const token1 = await provider.getToken();
    expect(token1).toBe('cached-token-value');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call should use cache (within 80% of 600s = 480s safety window)
    const token2 = await provider.getToken();
    expect(token2).toBe('cached-token-value');
    // Should NOT have made a second fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Refresh near expiry
  // -----------------------------------------------------------------------

  it('refreshes token when nearing expiry', async () => {
    vi.useFakeTimers();

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: 'first-token',
        token_type: 'Bearer',
        expires_in: 600, // 10 min TTL
        scope: 'workflow.read',
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: 'refreshed-token',
        token_type: 'Bearer',
        expires_in: 600,
        scope: 'workflow.read',
      }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    // First call fetches and caches (refreshBefore = now + 480000ms)
    const token1 = await provider.getToken();
    expect(token1).toBe('first-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance time past the 80% refresh threshold (480s) but before hard expiry
    vi.advanceTimersByTime(481_000); // > 480s safety window

    // Second call should detect near-expiry and refresh
    const token2 = await provider.getToken();
    expect(token2).toBe('refreshed-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Concurrent request deduplication
  // -----------------------------------------------------------------------

  it('deduplicates concurrent getToken calls', async () => {
    let requestCount = 0;
    fetchMock.mockImplementation(async () => {
      requestCount++;
      // Simulate network delay
      await new Promise((r) => setTimeout(r, 50));
      return jsonResponse(200, {
        access_token: `token-from-request-${requestCount}`,
        token_type: 'Bearer',
        expires_in: 600,
        scope: 'workflow.read',
      });
    });

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    // Fire three concurrent requests
    const [t1, t2, t3] = await Promise.all([
      provider.getToken(),
      provider.getToken(),
      provider.getToken(),
    ]);

    // All should get the same token (only one fetch)
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Auth service HTTP errors
  // -----------------------------------------------------------------------

  it('rejects on 401 invalid_client', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {
      error: 'invalid_client',
      error_description: 'Client not found or secret wrong',
    }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: 'bad-client',
      clientSecret: 'bad-secret',
    });

    await expect(provider.getToken()).rejects.toMatchObject({ category: 'api', status: 401 });
  });

  it('rejects on 400 invalid_scope', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, {
      error: 'invalid_scope',
      error_description: 'Requested scope is not in allowedScopes',
    }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await expect(provider.getToken()).rejects.toMatchObject({ category: 'api' });
  });

  it('rejects on 500 server error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {
      error: 'server_error',
      error_description: 'Internal server error',
    }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await expect(provider.getToken()).rejects.toThrow(TokenProviderError);
  });

  // -----------------------------------------------------------------------
  // Transport errors
  // -----------------------------------------------------------------------

  it('rejects on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await expect(provider.getToken()).rejects.toThrow(TokenProviderError);
    await expect(provider.getToken()).rejects.toMatchObject({ category: 'transport' });
  });

  // -----------------------------------------------------------------------
  // Invalid response
  // -----------------------------------------------------------------------

  it('rejects on non-JSON response', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await expect(provider.getToken()).rejects.toThrow(TokenProviderError);
  });

  it('rejects on missing access_token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { token_type: 'Bearer', expires_in: 600 }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await expect(provider.getToken()).rejects.toThrow(TokenProviderError);
  });

  it('rejects on missing expires_in', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'some-token', token_type: 'Bearer' }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await expect(provider.getToken()).rejects.toThrow(TokenProviderError);
  });

  // -----------------------------------------------------------------------
  // Log safety
  // -----------------------------------------------------------------------

  it('does not log client secret or token content', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      access_token: 'secret-token-value',
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'workflow.read',
    }));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Override NODE_ENV to not be 'test' so logs are emitted
    vi.stubEnv('NODE_ENV', 'development');

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    await provider.getToken();

    const logOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(' ');
    // Should not contain sensitive data
    expect(logOutput).not.toContain(CLIENT_SECRET);
    expect(logOutput).not.toContain('secret-token-value');
    // Should contain safe fields
    expect(logOutput).toContain(TOKEN_ENDPOINT);
    expect(logOutput).toContain('svc-workflow');
    expect(logOutput).toContain('workflow.read');

    consoleSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Fail-closed: refresh failure does not return stale token
  // -----------------------------------------------------------------------

  it('throws when refresh fails and does not return stale cached token', async () => {
    vi.useFakeTimers();

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: 'first-token',
        token_type: 'Bearer',
        expires_in: 600,
        scope: 'workflow.read',
      }))
      .mockResolvedValueOnce(jsonResponse(401, {
        error: 'invalid_client',
        error_description: 'Client revoked',
      }));

    const provider = new AuthServiceMachineTokenProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    // First call succeeds
    const token1 = await provider.getToken();
    expect(token1).toBe('first-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past the 80% refresh threshold
    vi.advanceTimersByTime(481_000);

    // Second call should attempt refresh and fail — must not return first-token
    await expect(provider.getToken()).rejects.toThrow(TokenProviderError);

    vi.useRealTimers();
  });
});
