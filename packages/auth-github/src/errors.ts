import { ProviderError } from "@pylon-sync/core";

export type DeviceFlowErrorCode =
  | "DEVICE_CODE_REQUEST_FAILED"
  | "AUTHORIZATION_PENDING"
  | "SLOW_DOWN"
  | "EXPIRED_TOKEN"
  | "ACCESS_DENIED"
  | "UNSUPPORTED_GRANT_TYPE"
  | "INCORRECT_CLIENT_CREDENTIALS"
  | "INCORRECT_DEVICE_CODE"
  | "DEVICE_FLOW_ABORTED"
  | "UNKNOWN";

export class DeviceFlowError extends ProviderError {
  readonly reason: DeviceFlowErrorCode;

  constructor(reason: DeviceFlowErrorCode, message: string) {
    super("DEVICE_FLOW_ERROR", message);
    this.name = "DeviceFlowError";
    this.reason = reason;
  }
}

export class TokenRefreshError extends ProviderError {
  readonly reason: "BAD_REFRESH_TOKEN" | "NETWORK" | "UNKNOWN";

  constructor(reason: "BAD_REFRESH_TOKEN" | "NETWORK" | "UNKNOWN", message: string) {
    super("TOKEN_REFRESH_ERROR", message);
    this.name = "TokenRefreshError";
    this.reason = reason;
  }
}
