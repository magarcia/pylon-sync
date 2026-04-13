import { vi, describe, it, expect, beforeEach } from "vitest";
import type { HttpClient } from "@pylon-sync/core";
import { refreshToken, isExpiringSoon } from "../token-refresh";
import { TokenRefreshError } from "../errors";
import type { TokenSet } from "../types";

function createMockHttp() {
  return { request: vi.fn<HttpClient["request"]>() };
}

function mockResponse(status: number, json: unknown = {}) {
  return {
    status,
    headers: {},
    json,
    text: JSON.stringify(json),
    arrayBuffer: new ArrayBuffer(0),
  };
}

const CLIENT_ID = "Iv1.test_client_id";
const HOST = "github.com";
const OLD_REFRESH = "ghr_old_refresh";

let mockHttp: ReturnType<typeof createMockHttp>;

beforeEach(() => {
  mockHttp = createMockHttp();
});

describe("refreshToken", () => {
  it("should POST to /login/oauth/access_token with refresh_token grant", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        access_token: "ghu_new_access",
        refresh_token: "ghr_new_refresh",
        expires_in: 28800,
        refresh_token_expires_in: 15811200,
        token_type: "bearer",
        scope: "",
      }),
    );

    await refreshToken(mockHttp, CLIENT_ID, OLD_REFRESH, HOST);

    const call = mockHttp.request.mock.calls[0]![0];
    expect(call).toMatchObject({
      url: "https://github.com/login/oauth/access_token",
      method: "POST",
    });
    expect(call.body).toContain("client_id=Iv1.test_client_id");
    expect(call.body).toContain("refresh_token=ghr_old_refresh");
    expect(call.body).toContain("grant_type=refresh_token");
  });

  it("should not send client_secret (device flow tokens don't require it)", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        access_token: "ghu_new_access",
        refresh_token: "ghr_new_refresh",
        expires_in: 28800,
        refresh_token_expires_in: 15811200,
      }),
    );

    await refreshToken(mockHttp, CLIENT_ID, OLD_REFRESH, HOST);

    const call = mockHttp.request.mock.calls[0]![0];
    expect(call.body).not.toContain("client_secret");
  });

  it("should return new TokenSet with absolute expiresAt timestamps", async () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        access_token: "ghu_new_access",
        refresh_token: "ghr_new_refresh",
        expires_in: 28800,
        refresh_token_expires_in: 15811200,
      }),
    );

    const result = await refreshToken(mockHttp, CLIENT_ID, OLD_REFRESH, HOST);

    expect(result).toEqual({
      accessToken: "ghu_new_access",
      refreshToken: "ghr_new_refresh",
      expiresAt: now + 28800 * 1000,
      refreshExpiresAt: now + 15811200 * 1000,
    });

    vi.useRealTimers();
  });

  it("should throw BAD_REFRESH_TOKEN error when server returns error: bad_refresh_token", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, { error: "bad_refresh_token" }),
    );

    await expect(
      refreshToken(mockHttp, CLIENT_ID, OLD_REFRESH, HOST),
    ).rejects.toMatchObject({
      name: "TokenRefreshError",
      reason: "BAD_REFRESH_TOKEN",
    });
  });

  it("should throw NETWORK error on request failure", async () => {
    mockHttp.request.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      refreshToken(mockHttp, CLIENT_ID, OLD_REFRESH, HOST),
    ).rejects.toMatchObject({
      name: "TokenRefreshError",
      reason: "NETWORK",
    });
  });

  it("should throw UNKNOWN error on unexpected response shape", async () => {
    mockHttp.request.mockResolvedValue(mockResponse(200, { foo: "bar" }));

    await expect(
      refreshToken(mockHttp, CLIENT_ID, OLD_REFRESH, HOST),
    ).rejects.toBeInstanceOf(TokenRefreshError);
  });

  it("should use GHES host when provided", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        access_token: "ghu_new_access",
        refresh_token: "ghr_new_refresh",
        expires_in: 28800,
        refresh_token_expires_in: 15811200,
      }),
    );

    await refreshToken(mockHttp, CLIENT_ID, OLD_REFRESH, "ghes.example.com");

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://ghes.example.com/login/oauth/access_token",
      }),
    );
  });
});

describe("isExpiringSoon", () => {
  const baseTokenSet: TokenSet = {
    accessToken: "ghu_test",
    refreshToken: "ghr_test",
    expiresAt: 0,
    refreshExpiresAt: Date.now() + 15811200_000,
  };

  it("should report token as expiring soon when within 60s window", () => {
    const token: TokenSet = { ...baseTokenSet, expiresAt: Date.now() + 30_000 };
    expect(isExpiringSoon(token)).toBe(true);
  });

  it("should report token as not expiring soon when outside 60s window", () => {
    const token: TokenSet = { ...baseTokenSet, expiresAt: Date.now() + 120_000 };
    expect(isExpiringSoon(token)).toBe(false);
  });
});
