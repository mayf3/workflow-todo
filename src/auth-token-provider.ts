/**
 * AuthServiceMachineTokenProvider
 *
 * Implements the Machine Client Credentials flow for auth-service.
 *
 * Responsibilities (only):
 *   - Call POST /oauth/token with client_credentials grant
 *   - Request audience=svc-workflow, scope=workflow.read
 *   - Cache the access token in memory with safety-window refresh
 *   - Fail-closed: any error throws, no fallback
 *
 * Explicitly NOT:
 *   - Parse or validate JWT claims
 *   - Cache JWKS
 *   - Sign or verify tokens locally
 *   - Fall back to static/admin tokens
 *   - Log token contents or client secret
 */

export interface AuthMachineTokenProviderConfig {
  /** Full URL of the auth-service token endpoint (e.g. http://auth:3000/oauth/token) */
  tokenEndpoint: string;
  /** OAuth client ID for this machine (format: mc_<base64url>) */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
}

interface CachedToken {
  accessToken: string;
  /** Absolute expiry time (ms since epoch) at which we MUST refresh */
  hardExpiresAt: number;
  /** Absolute time (ms since epoch) at which we SHOULD refresh (80 % of TTL) */
  refreshBefore: number;
}

const REFRESH_THRESHOLD = 0.8; // refresh when 80 % of TTL has elapsed

export class AuthServiceMachineTokenProvider {
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly config: AuthMachineTokenProviderConfig) {
    if (!config.tokenEndpoint) throw new Error('AuthServiceMachineTokenProvider: tokenEndpoint is required');
    if (!config.clientId) throw new Error('AuthServiceMachineTokenProvider: clientId is required');
    if (!config.clientSecret) throw new Error('AuthServiceMachineTokenProvider: clientSecret is required');
  }

  // -----------------------------------------------------------------------
  // Public API — returns a Bearer token string
  // -----------------------------------------------------------------------

  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.refreshBefore) {
      this.emitLog('token-cache-hit', { cacheStatus: 'valid' });
      return this.cached.accessToken;
    }

    if (this.cached && Date.now() < this.cached.hardExpiresAt) {
      this.emitLog('token-cache-refresh', { cacheStatus: 'refreshing-early' });
    }

    // Deduplicate concurrent requests
    if (this.inflight) {
      this.emitLog('token-cache-wait', { cacheStatus: 'waiting-for-inflight' });
      return this.inflight;
    }

    this.inflight = this.fetchToken();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async fetchToken(): Promise<string> {
    const { tokenEndpoint, clientId, clientSecret } = this.config;

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      resource: 'svc-workflow',
      scope: 'workflow.read',
    });

    this.emitLog('token-fetch-start', {
      endpoint: tokenEndpoint,
      audience: 'svc-workflow',
      scope: 'workflow.read',
    });

    let response: Response;
    try {
      response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
          Accept: 'application/json',
        },
        body: params.toString(),
      });
    } catch (cause) {
      this.emitLog('token-fetch-error', { errorCategory: 'transport' });
      throw new TokenProviderError(
        `Auth token request failed: auth-service unreachable`,
        'transport',
        cause,
      );
    }

    let body: unknown;
    try {
      body = await response.json() as Record<string, unknown>;
    } catch {
      this.emitLog('token-fetch-error', { errorCategory: 'invalid-response', status: response.status });
      throw new TokenProviderError(
        `Auth token request returned non-JSON response (HTTP ${response.status})`,
        'protocol',
      );
    }

    if (!response.ok) {
      const errBody = body as Record<string, string> | undefined;
      const errorCode = errBody?.error ?? 'unknown';
      const errorDesc = errBody?.error_description ?? '';
      this.emitLog('token-fetch-error', { errorCategory: 'api', status: response.status, errorCode });
      throw new TokenProviderError(
        `Auth token request failed: ${errorCode}${errorDesc ? ` — ${errorDesc}` : ''}`,
        'api',
        undefined,
        response.status,
      );
    }

    const accessToken = (body as Record<string, unknown>)?.access_token;
    const expiresIn = (body as Record<string, unknown>)?.expires_in;

    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      this.emitLog('token-fetch-error', { errorCategory: 'missing-access-token' });
      throw new TokenProviderError(
        'Auth token response missing access_token',
        'protocol',
      );
    }

    if (typeof expiresIn !== 'number' || expiresIn <= 0) {
      this.emitLog('token-fetch-error', { errorCategory: 'invalid-expires-in', expiresIn });
      throw new TokenProviderError(
        'Auth token response missing or invalid expires_in',
        'protocol',
      );
    }

    const now = Date.now();
    const ttlMs = expiresIn * 1000;
    this.cached = {
      accessToken,
      hardExpiresAt: now + ttlMs - 5_000, // 5-second safety margin
      refreshBefore: now + ttlMs * REFRESH_THRESHOLD,
    };

    this.emitLog('token-fetch-success', {
      expiresIn,
      refreshBeforeMs: this.cached.refreshBefore - now,
    });

    return accessToken;
  }

  // -----------------------------------------------------------------------
  // Safe logging — never logs token content, client secret, or full Auth header
  // -----------------------------------------------------------------------

  private emitLog(event: string, data: Record<string, unknown>): void {
    // Only safe fields are logged:
    //   endpoint, audience, scope, cache status, HTTP status, error category
    // Token contents and client secret are NEVER included.
    if (process.env.NODE_ENV !== 'test') {
      // In test mode, silence logs so they don't pollute test output.
      // In production, structured JSON logging to stderr would be appropriate.
      console.error(`[AuthTokenProvider] ${event} ${JSON.stringify(data)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class TokenProviderError extends Error {
  readonly name = 'TokenProviderError';

  constructor(
    message: string,
    public readonly category: 'transport' | 'protocol' | 'api',
    public readonly cause?: unknown,
    public readonly status?: number,
  ) {
    super(message);
  }
}
