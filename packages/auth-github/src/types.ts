// Persisted token set returned by GitHub App device flow.
// Do NOT serialize into error messages or logs.
export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  // Absolute ms timestamp when the access token expires.
  readonly expiresAt: number;
  // Absolute ms timestamp when the refresh token expires (≈6 months).
  readonly refreshExpiresAt: number;
}

// Device code response from POST /login/device/code.
// `deviceCode` is secret — never log or serialize.
export interface DeviceCodeResponse {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: number;
  readonly interval: number;
}

// Token provider passed to GitHubApi.rest().
// Either a literal PAT string or an async function that returns the current
// access token (for device flow with auto-refresh).
export type TokenProvider =
  | string
  | { getToken(): Promise<string>; onUnauthorized?(): Promise<string> };
