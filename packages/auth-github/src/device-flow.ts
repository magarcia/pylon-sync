import type { HttpClient } from "@pylon-sync/core";
import { DeviceFlowError } from "./errors";
import type { DeviceCodeResponse, TokenSet } from "./types";
import { resolveHostUrls } from "./hosts";

// RFC 8628 grant type string (URL-encoded in the body).
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

// Raw GitHub response shapes. These use snake_case straight from the API so we
// can validate the shape with type guards instead of `as` casts.
interface RawDeviceCode {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly expires_in: number;
  readonly interval: number;
}

interface RawTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly refresh_token_expires_in: number;
}

interface RawPollError {
  readonly error: string;
}

function isRawDeviceCode(value: unknown): value is RawDeviceCode {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.device_code === "string" &&
    typeof v.user_code === "string" &&
    typeof v.verification_uri === "string" &&
    typeof v.expires_in === "number" &&
    typeof v.interval === "number"
  );
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

function isRawPollError(value: unknown): value is RawPollError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).error === "string"
  );
}

export async function startDeviceFlow(
  http: HttpClient,
  clientId: string,
  host: string,
): Promise<DeviceCodeResponse> {
  const urls = resolveHostUrls(host);

  let response;
  try {
    response = await http.request({
      url: urls.deviceCodeUrl,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "pylon-sync",
      },
      body: `client_id=${encodeURIComponent(clientId)}`,
    });
  } catch (err) {
    throw new DeviceFlowError(
      "DEVICE_CODE_REQUEST_FAILED",
      `Failed to request device code: ${(err as Error).message}`,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new DeviceFlowError(
      "DEVICE_CODE_REQUEST_FAILED",
      `Device code request failed with status ${response.status}`,
    );
  }

  if (!isRawDeviceCode(response.json)) {
    throw new DeviceFlowError(
      "DEVICE_CODE_REQUEST_FAILED",
      "Device code response did not match expected shape",
    );
  }

  const raw = response.json;
  return {
    deviceCode: raw.device_code,
    userCode: raw.user_code,
    // Use the locally-derived verification URL rather than the server-supplied
    // one. A malicious githubHost could return a phishing URL in the response.
    verificationUri: urls.verificationUri,
    expiresAt: Date.now() + raw.expires_in * 1000,
    interval: raw.interval,
  };
}

// Waits for `ms` milliseconds, cutting the wait short if the signal aborts
// mid-sleep. Resolves (instead of rejecting) on abort so we don't produce
// unhandled rejections; callers check `signal.aborted` at the top of each
// loop iteration and throw from there.
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollForToken(
  http: HttpClient,
  clientId: string,
  deviceCode: string,
  initialIntervalSeconds: number,
  host: string,
  signal: AbortSignal,
): Promise<TokenSet> {
  const urls = resolveHostUrls(host);
  let interval = Math.max(0, initialIntervalSeconds);

  const body = [
    `client_id=${encodeURIComponent(clientId)}`,
    `device_code=${encodeURIComponent(deviceCode)}`,
    `grant_type=${encodeURIComponent(DEVICE_GRANT_TYPE)}`,
  ].join("&");

  while (true) {
    if (signal.aborted) {
      throw new DeviceFlowError(
        "DEVICE_FLOW_ABORTED",
        "Device flow was aborted",
      );
    }

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
      throw new DeviceFlowError(
        "UNKNOWN",
        `Token poll request failed: ${(err as Error).message}`,
      );
    }

    // Success: a well-formed token response.
    if (isRawTokenResponse(response.json)) {
      const raw = response.json;
      return {
        accessToken: raw.access_token,
        refreshToken: raw.refresh_token,
        expiresAt: Date.now() + raw.expires_in * 1000,
        refreshExpiresAt: Date.now() + raw.refresh_token_expires_in * 1000,
      };
    }

    // GitHub returns 200 with an `error` field during polling. Some gateways
    // return 400. Either way, we look at the `error` field.
    if (isRawPollError(response.json)) {
      const error = response.json.error;
      switch (error) {
        case "authorization_pending":
          // Continue polling.
          break;
        case "slow_down":
          // RFC 8628: add 5 seconds to the polling interval.
          interval += 5;
          break;
        case "expired_token":
          throw new DeviceFlowError(
            "EXPIRED_TOKEN",
            "Device code has expired. Please start over.",
          );
        case "access_denied":
          throw new DeviceFlowError(
            "ACCESS_DENIED",
            "Authorization was denied by the user.",
          );
        case "unsupported_grant_type":
          throw new DeviceFlowError(
            "UNSUPPORTED_GRANT_TYPE",
            "Unsupported grant type.",
          );
        case "incorrect_client_credentials":
          throw new DeviceFlowError(
            "INCORRECT_CLIENT_CREDENTIALS",
            "Incorrect client credentials.",
          );
        case "incorrect_device_code":
          throw new DeviceFlowError(
            "INCORRECT_DEVICE_CODE",
            "Incorrect device code.",
          );
        default:
          throw new DeviceFlowError(
            "UNKNOWN",
            `Unknown device flow error: ${error}`,
          );
      }
    } else {
      throw new DeviceFlowError(
        "UNKNOWN",
        `Unexpected token response with status ${response.status}`,
      );
    }

    // Wait the interval before polling again. Abort-aware.
    await abortableSleep(interval * 1000, signal);
  }
}
