import type { HttpClient } from "@pylon-sync/core";
import { TokenRefreshError } from "./errors";
import type { TokenSet } from "./types";
import { resolveHostUrls } from "./hosts";

interface RawTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly refresh_token_expires_in: number;
}

function isRawTokenResponse(value: unknown): value is RawTokenResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access_token === "string" &&
    typeof v.refresh_token === "string" &&
    typeof v.expires_in === "number" &&
    typeof v.refresh_token_expires_in === "number"
  );
}

// How often to refresh proactively: if the token expires within this many ms,
// refresh before the next API call. 60 seconds gives enough slack to avoid
// mid-sync failures.
export const REFRESH_EAGER_WINDOW_MS = 60_000;

export function isExpiringSoon(tokenSet: TokenSet, now = Date.now()): boolean {
  return tokenSet.expiresAt - now < REFRESH_EAGER_WINDOW_MS;
}

export async function refreshToken(
  http: HttpClient,
  clientId: string,
  currentRefreshToken: string,
  host: string,
): Promise<TokenSet> {
  const urls = resolveHostUrls(host);
  const body = [
    `client_id=${encodeURIComponent(clientId)}`,
    `grant_type=refresh_token`,
    `refresh_token=${encodeURIComponent(currentRefreshToken)}`,
  ].join("&");

  let response;
  try {
    response = await http.request({
      url: urls.accessTokenUrl,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "pylon-sync",
      },
      body,
    });
  } catch (err) {
    throw new TokenRefreshError(
      "NETWORK",
      `Token refresh failed: ${(err as Error).message}`,
    );
  }

  // GitHub returns 200 with `{ error: "bad_refresh_token" }` rather than a 4xx.
  if (
    typeof response.json === "object" &&
    response.json !== null &&
    "error" in response.json
  ) {
    const error = (response.json as { error: string }).error;
    if (error === "bad_refresh_token") {
      throw new TokenRefreshError(
        "BAD_REFRESH_TOKEN",
        "Refresh token is invalid or expired. Please sign in again.",
      );
    }
    throw new TokenRefreshError("UNKNOWN", `Token refresh error: ${error}`);
  }

  if (!isRawTokenResponse(response.json)) {
    throw new TokenRefreshError(
      "UNKNOWN",
      "Token refresh response did not match expected shape",
    );
  }

  const raw = response.json;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: Date.now() + raw.expires_in * 1000,
    refreshExpiresAt: Date.now() + raw.refresh_token_expires_in * 1000,
  };
}
