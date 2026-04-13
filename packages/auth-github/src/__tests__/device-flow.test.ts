import { vi, describe, it, expect, beforeEach } from "vitest";
import type { HttpClient } from "@pylon-sync/core";
import { startDeviceFlow, pollForToken } from "../device-flow";
import { DeviceFlowError } from "../errors";
import type { TokenSet } from "../types";

function createMockHttp() {
  return { request: vi.fn<HttpClient["request"]>() };
}

function mockResponse(
  status: number,
  json: unknown = {},
  headers: Record<string, string> = {},
) {
  return {
    status,
    headers,
    json,
    text: JSON.stringify(json),
    arrayBuffer: new ArrayBuffer(0),
  };
}

const CLIENT_ID = "Iv1.test_client_id";
const HOST = "github.com";

let mockHttp: ReturnType<typeof createMockHttp>;

beforeEach(() => {
  mockHttp = createMockHttp();
  vi.useFakeTimers();
});

describe("startDeviceFlow", () => {
  it("should POST to /login/device/code with form-encoded client_id", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        device_code: "dev_abc",
        user_code: "WDJB-MJHT",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    );

    await startDeviceFlow(mockHttp, CLIENT_ID, HOST);

    expect(mockHttp.request).toHaveBeenCalledWith({
      url: "https://github.com/login/device/code",
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "pylon-sync",
      },
      body: "client_id=Iv1.test_client_id",
    });
  });

  it("should parse device code response into typed object", async () => {
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        device_code: "dev_abc",
        user_code: "WDJB-MJHT",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    );

    const result = await startDeviceFlow(mockHttp, CLIENT_ID, HOST);

    expect(result).toEqual({
      deviceCode: "dev_abc",
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
      expiresAt: now + 900 * 1000,
      interval: 5,
    });
  });

  it("should use GHES hostname for URLs", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        device_code: "dev_abc",
        user_code: "WDJB-MJHT",
        verification_uri: "https://ghes.example.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    );

    await startDeviceFlow(mockHttp, CLIENT_ID, "ghes.example.com");

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://ghes.example.com/login/device/code",
      }),
    );
  });

  it("should throw DeviceFlowError on non-2xx response", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(400, { error: "invalid_client" }),
    );

    await expect(startDeviceFlow(mockHttp, CLIENT_ID, HOST)).rejects.toThrow(
      DeviceFlowError,
    );
  });

  it("should throw DeviceFlowError on network failure", async () => {
    mockHttp.request.mockRejectedValue(new Error("Network error"));

    await expect(startDeviceFlow(mockHttp, CLIENT_ID, HOST)).rejects.toThrow(
      DeviceFlowError,
    );
  });
});

describe("pollForToken", () => {
  it("should return TokenSet on successful authorization", async () => {
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        access_token: "ghu_access",
        refresh_token: "ghr_refresh",
        expires_in: 28800,
        refresh_token_expires_in: 15811200,
        token_type: "bearer",
        scope: "",
      }),
    );

    const controller = new AbortController();
    const promise = pollForToken(mockHttp, CLIENT_ID, "dev_abc", 0, HOST, controller.signal);

    const result = await promise;

    expect(result).toEqual({
      accessToken: "ghu_access",
      refreshToken: "ghr_refresh",
      expiresAt: now + 28800 * 1000,
      refreshExpiresAt: now + 15811200 * 1000,
    });
  });

  it("should POST correct body to access_token endpoint", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        access_token: "ghu_access",
        refresh_token: "ghr_refresh",
        expires_in: 28800,
        refresh_token_expires_in: 15811200,
      }),
    );

    const controller = new AbortController();
    await pollForToken(mockHttp, CLIENT_ID, "dev_abc", 0, HOST, controller.signal);

    const call = mockHttp.request.mock.calls[0]![0];
    expect(call).toMatchObject({
      url: "https://github.com/login/oauth/access_token",
      method: "POST",
    });
    // grant_type must be the literal RFC 8628 string, URL-encoded.
    expect(call.body).toContain("client_id=Iv1.test_client_id");
    expect(call.body).toContain("device_code=dev_abc");
    expect(call.body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code");
  });

  it("should keep polling on authorization_pending", async () => {
    mockHttp.request
      .mockResolvedValueOnce(mockResponse(200, { error: "authorization_pending" }))
      .mockResolvedValueOnce(mockResponse(200, { error: "authorization_pending" }))
      .mockResolvedValueOnce(
        mockResponse(200, {
          access_token: "ghu_access",
          refresh_token: "ghr_refresh",
          expires_in: 28800,
          refresh_token_expires_in: 15811200,
        }),
      );

    const controller = new AbortController();
    const promise = pollForToken(mockHttp, CLIENT_ID, "dev_abc", 1, HOST, controller.signal);

    // Advance time to skip through the interval waits.
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result.accessToken).toBe("ghu_access");
    expect(mockHttp.request).toHaveBeenCalledTimes(3);
  });

  it("should increase interval by 5 seconds on slow_down", async () => {
    mockHttp.request
      .mockResolvedValueOnce(mockResponse(200, { error: "slow_down" }))
      .mockResolvedValueOnce(
        mockResponse(200, {
          access_token: "ghu_access",
          refresh_token: "ghr_refresh",
          expires_in: 28800,
          refresh_token_expires_in: 15811200,
        }),
      );

    const controller = new AbortController();
    const promise = pollForToken(mockHttp, CLIENT_ID, "dev_abc", 1, HOST, controller.signal);

    // After slow_down, interval is 1 + 5 = 6 seconds. Advance well past.
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    expect(mockHttp.request).toHaveBeenCalledTimes(2);
  });

  it("should throw DeviceFlowError with EXPIRED_TOKEN reason", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, { error: "expired_token" }),
    );

    const controller = new AbortController();
    const promise = pollForToken(mockHttp, CLIENT_ID, "dev_abc", 0, HOST, controller.signal);

    await expect(promise).rejects.toMatchObject({
      name: "DeviceFlowError",
      reason: "EXPIRED_TOKEN",
    });
  });

  it("should throw DeviceFlowError with ACCESS_DENIED reason", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, { error: "access_denied" }),
    );

    const controller = new AbortController();
    const promise = pollForToken(mockHttp, CLIENT_ID, "dev_abc", 0, HOST, controller.signal);

    await expect(promise).rejects.toMatchObject({
      name: "DeviceFlowError",
      reason: "ACCESS_DENIED",
    });
  });

  it("should throw DeviceFlowError when abort signal fires", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, { error: "authorization_pending" }),
    );

    const controller = new AbortController();
    // Attach a catch handler immediately so the eventual rejection is never
    // observed as "unhandled" during the fake-timer advance.
    const settled = pollForToken(
      mockHttp,
      CLIENT_ID,
      "dev_abc",
      2,
      HOST,
      controller.signal,
    ).then(
      (v: TokenSet) => ({ ok: true as const, value: v }),
      (err: unknown) => ({ ok: false as const, err }),
    );

    // Let the first poll happen, then abort during the wait.
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(3000);

    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err).toMatchObject({
        name: "DeviceFlowError",
        reason: "DEVICE_FLOW_ABORTED",
      });
    }
  });

  it("should not include Authorization header (device flow is unauthenticated)", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        access_token: "ghu_access",
        refresh_token: "ghr_refresh",
        expires_in: 28800,
        refresh_token_expires_in: 15811200,
      }),
    );

    const controller = new AbortController();
    await pollForToken(mockHttp, CLIENT_ID, "dev_abc", 0, HOST, controller.signal);

    const call = mockHttp.request.mock.calls[0]![0];
    expect(call.headers).not.toHaveProperty("Authorization");
  });

  it("should throw DeviceFlowError with INCORRECT_DEVICE_CODE reason", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, { error: "incorrect_device_code" }),
    );

    const controller = new AbortController();
    const promise = pollForToken(mockHttp, CLIENT_ID, "dev_abc", 0, HOST, controller.signal);

    await expect(promise).rejects.toMatchObject({
      name: "DeviceFlowError",
      reason: "INCORRECT_DEVICE_CODE",
    });
  });

  it("should throw DeviceFlowError with UNKNOWN reason on unrecognized error", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, { error: "some_new_error" }),
    );

    const controller = new AbortController();
    const promise = pollForToken(mockHttp, CLIENT_ID, "dev_abc", 0, HOST, controller.signal);

    await expect(promise).rejects.toMatchObject({
      name: "DeviceFlowError",
      reason: "UNKNOWN",
    });
  });

  it("should throw DeviceFlowError on network failure during poll", async () => {
    mockHttp.request.mockRejectedValue(new Error("fetch failed"));

    const controller = new AbortController();
    const promise = pollForToken(mockHttp, CLIENT_ID, "dev_abc", 0, HOST, controller.signal);

    await expect(promise).rejects.toMatchObject({
      name: "DeviceFlowError",
      reason: "UNKNOWN",
    });
  });
});

describe("startDeviceFlow", () => {
  it("should throw when response has unexpected shape", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, { foo: "bar" }),
    );

    await expect(
      startDeviceFlow(mockHttp, CLIENT_ID, HOST),
    ).rejects.toMatchObject({
      name: "DeviceFlowError",
      reason: "DEVICE_CODE_REQUEST_FAILED",
    });
  });
});
