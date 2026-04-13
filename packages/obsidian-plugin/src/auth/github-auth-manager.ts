import type { HttpClient } from "@pylon-sync/core";
import {
  startDeviceFlow,
  pollForToken,
  refreshToken,
  isExpiringSoon,
  TokenRefreshError,
  type TokenSet,
  type DeviceCodeResponse,
} from "@pylon-sync/auth-github";

// Storage-agnostic secret store. The plugin wires this to SecretStorage; tests
// pass an in-memory Map.
export interface SecretStore {
  load(key: string): Promise<string>;
  save(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const OAUTH_TOKEN_SET_KEY = "github-oauth-token-set";

export interface GitHubAuthManagerConfig {
  readonly http: HttpClient;
  readonly store: SecretStore;
  readonly clientId: string;
  readonly host: string;
}

// Serializable TokenSet shape. TokenSet itself is readonly, but JSON stringify
// needs plain fields. The serialized form is what we store in SecretStorage.
interface StoredTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
}

function isStoredTokenSet(value: unknown): value is StoredTokenSet {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessToken === "string" &&
    typeof v.refreshToken === "string" &&
    typeof v.expiresAt === "number" &&
    typeof v.refreshExpiresAt === "number"
  );
}

export class GitHubAuthManager {
  private tokenSet: TokenSet | null = null;
  private loaded = false;

  // In-flight refresh promise, to coalesce concurrent calls into one refresh.
  private refreshInFlight: Promise<void> | null = null;

  constructor(private readonly config: GitHubAuthManagerConfig) {}

  // Synchronous check: true once ensureLoaded() has found a stored token set,
  // or after a successful signIn(). Used by isProviderConfigured() which
  // cannot be async.
  get hasTokenSet(): boolean {
    return this.tokenSet !== null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const raw = await this.config.store.load(OAUTH_TOKEN_SET_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (isStoredTokenSet(parsed)) {
        this.tokenSet = parsed;
      }
    } catch {
      // Stored value is malformed; treat as signed-out.
    }
  }

  async isSignedIn(): Promise<boolean> {
    await this.ensureLoaded();
    if (!this.tokenSet) return false;
    // Refresh token expired → can't recover silently.
    return this.tokenSet.refreshExpiresAt > Date.now();
  }

  // Returns the current user-facing state: either a valid access token
  // (possibly refreshed), or throws TokenRefreshError (caller should prompt
  // the user to sign in again).
  async getAccessToken(): Promise<string> {
    await this.ensureLoaded();
    if (!this.tokenSet) {
      throw new TokenRefreshError(
        "BAD_REFRESH_TOKEN",
        "Not signed in. Please sign in with GitHub.",
      );
    }

    if (!isExpiringSoon(this.tokenSet)) {
      return this.tokenSet.accessToken;
    }

    await this.refresh();
    return this.tokenSet!.accessToken;
  }

  // Force a refresh (used as the onUnauthorized callback in TokenProvider).
  async forceRefresh(): Promise<string> {
    await this.ensureLoaded();
    if (!this.tokenSet) {
      throw new TokenRefreshError(
        "BAD_REFRESH_TOKEN",
        "Not signed in. Please sign in with GitHub.",
      );
    }
    await this.refresh();
    return this.tokenSet!.accessToken;
  }

  // Refreshes the access token. Coalesces concurrent calls into a single
  // network request. Updates `this.tokenSet` internally — callers read the
  // accessToken from `this.tokenSet` after awaiting, so the full TokenSet
  // (including the refresh token) is never exposed to callers.
  private async refresh(): Promise<void> {
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }
    if (!this.tokenSet) {
      throw new TokenRefreshError(
        "BAD_REFRESH_TOKEN",
        "No token set available for refresh.",
      );
    }

    const currentRefresh = this.tokenSet.refreshToken;
    this.refreshInFlight = refreshToken(
      this.config.http,
      this.config.clientId,
      currentRefresh,
      this.config.host,
    )
      .then(async (next) => {
        this.tokenSet = next;
        await this.persist(next);
      })
      .catch(async (err) => {
        // If the refresh token itself is bad, clear everything so the next
        // getAccessToken() call surfaces a clean "please sign in" error.
        if (err instanceof TokenRefreshError && err.reason === "BAD_REFRESH_TOKEN") {
          this.tokenSet = null;
          await this.config.store.delete(OAUTH_TOKEN_SET_KEY);
        }
        throw err;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });

    await this.refreshInFlight;
  }

  // Runs the device flow to completion. The caller provides onCode so they
  // can open a modal with the user_code and verification URL. Call signIn
  // inside a try/catch in the UI layer — errors bubble up as DeviceFlowError.
  async signIn(
    onCode: (code: DeviceCodeResponse) => void,
    signal: AbortSignal,
  ): Promise<TokenSet> {
    const code = await startDeviceFlow(
      this.config.http,
      this.config.clientId,
      this.config.host,
    );
    onCode(code);

    const tokenSet = await pollForToken(
      this.config.http,
      this.config.clientId,
      code.deviceCode,
      code.interval,
      this.config.host,
      signal,
    );

    this.tokenSet = tokenSet;
    await this.persist(tokenSet);
    this.loaded = true;
    return tokenSet;
  }

  async signOut(): Promise<void> {
    this.tokenSet = null;
    await this.config.store.delete(OAUTH_TOKEN_SET_KEY);
  }

  private async persist(tokenSet: TokenSet): Promise<void> {
    const stored: StoredTokenSet = {
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      expiresAt: tokenSet.expiresAt,
      refreshExpiresAt: tokenSet.refreshExpiresAt,
    };
    await this.config.store.save(OAUTH_TOKEN_SET_KEY, JSON.stringify(stored));
  }
}
