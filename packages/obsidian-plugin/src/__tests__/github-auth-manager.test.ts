import { vi, describe, it, expect, beforeEach } from "vitest";
import type { HttpClient } from "@pylon-sync/core";
import {
  GitHubAuthManager,
  OAUTH_TOKEN_SET_KEY,
  type SecretStore,
} from "../auth/github-auth-manager";

function createMockHttp() {
  return { request: vi.fn<HttpClient["request"]>() };
}

function makeStore(): SecretStore & { _values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    _values: values,
    async load(key) {
      return values.get(key) ?? "";
    },
    async save(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

function tokenResponse(
  accessToken = "ghu_access",
  refreshToken = "ghr_refresh",
  expiresIn = 28800,
  refreshExpiresIn = 15811200,
) {
  return {
    status: 200,
    headers: {},
    json: {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      refresh_token_expires_in: refreshExpiresIn,
      token_type: "bearer",
      scope: "",
    },
    text: "",
    arrayBuffer: new ArrayBuffer(0),
  };
}

function storedTokenSet(overrides: Partial<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
}> = {}) {
  const now = Date.now();
  return JSON.stringify({
    accessToken: "ghu_stored",
    refreshToken: "ghr_stored",
    expiresAt: now + 3600_000,
    refreshExpiresAt: now + 15811200_000,
    ...overrides,
  });
}

const CLIENT_ID = "Iv1.test";
const HOST = "github.com";

let http: ReturnType<typeof createMockHttp>;
let store: ReturnType<typeof makeStore>;
let manager: GitHubAuthManager;

beforeEach(() => {
  http = createMockHttp();
  store = makeStore();
  manager = new GitHubAuthManager({
    http,
    store,
    clientId: CLIENT_ID,
    host: HOST,
  });
});

describe("GitHubAuthManager.isSignedIn", () => {
  it("should return false when no token is stored", async () => {
    expect(await manager.isSignedIn()).toBe(false);
  });

  it("should return true when a valid token set is stored", async () => {
    await store.save(OAUTH_TOKEN_SET_KEY, storedTokenSet());
    expect(await manager.isSignedIn()).toBe(true);
  });

  it("should return false when the refresh token is expired", async () => {
    await store.save(
      OAUTH_TOKEN_SET_KEY,
      storedTokenSet({ refreshExpiresAt: Date.now() - 1000 }),
    );
    expect(await manager.isSignedIn()).toBe(false);
  });

  it("should treat malformed stored JSON as signed-out", async () => {
    await store.save(OAUTH_TOKEN_SET_KEY, "not-json");
    expect(await manager.isSignedIn()).toBe(false);
  });
});

describe("GitHubAuthManager.getAccessToken", () => {
  it("should throw when not signed in", async () => {
    await expect(manager.getAccessToken()).rejects.toMatchObject({
      name: "TokenRefreshError",
      reason: "BAD_REFRESH_TOKEN",
    });
  });

  it("should return the current access token when not expiring soon", async () => {
    await store.save(
      OAUTH_TOKEN_SET_KEY,
      storedTokenSet({ expiresAt: Date.now() + 3600_000 }),
    );

    const token = await manager.getAccessToken();
    expect(token).toBe("ghu_stored");
    expect(http.request).not.toHaveBeenCalled();
  });

  it("should proactively refresh when expiring within 60 seconds", async () => {
    await store.save(
      OAUTH_TOKEN_SET_KEY,
      storedTokenSet({ expiresAt: Date.now() + 30_000 }),
    );
    http.request.mockResolvedValueOnce(tokenResponse("ghu_new", "ghr_new"));

    const token = await manager.getAccessToken();

    expect(token).toBe("ghu_new");
    expect(http.request).toHaveBeenCalledOnce();
  });

  it("should persist the refreshed token set back to the store", async () => {
    await store.save(
      OAUTH_TOKEN_SET_KEY,
      storedTokenSet({ expiresAt: Date.now() + 30_000 }),
    );
    http.request.mockResolvedValueOnce(tokenResponse("ghu_new", "ghr_new"));

    await manager.getAccessToken();

    const persisted = JSON.parse(await store.load(OAUTH_TOKEN_SET_KEY));
    expect(persisted.accessToken).toBe("ghu_new");
    expect(persisted.refreshToken).toBe("ghr_new");
  });

  it("should clear state when refresh token is bad", async () => {
    await store.save(
      OAUTH_TOKEN_SET_KEY,
      storedTokenSet({ expiresAt: Date.now() + 30_000 }),
    );
    http.request.mockResolvedValueOnce({
      status: 200,
      headers: {},
      json: { error: "bad_refresh_token" },
      text: "",
      arrayBuffer: new ArrayBuffer(0),
    });

    await expect(manager.getAccessToken()).rejects.toMatchObject({
      name: "TokenRefreshError",
      reason: "BAD_REFRESH_TOKEN",
    });

    // Store should be cleared so future calls don't keep trying.
    expect(await store.load(OAUTH_TOKEN_SET_KEY)).toBe("");
    expect(await manager.isSignedIn()).toBe(false);
  });

  it("should coalesce concurrent refresh calls into one", async () => {
    await store.save(
      OAUTH_TOKEN_SET_KEY,
      storedTokenSet({ expiresAt: Date.now() + 30_000 }),
    );
    http.request.mockResolvedValueOnce(tokenResponse("ghu_new", "ghr_new"));

    const [token1, token2, token3] = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.getAccessToken(),
    ]);

    expect(token1).toBe("ghu_new");
    expect(token2).toBe("ghu_new");
    expect(token3).toBe("ghu_new");
    expect(http.request).toHaveBeenCalledOnce();
  });
});

describe("GitHubAuthManager.forceRefresh", () => {
  it("should refresh even when not expiring soon (used by retry-on-401)", async () => {
    await store.save(
      OAUTH_TOKEN_SET_KEY,
      storedTokenSet({ expiresAt: Date.now() + 3600_000 }),
    );
    http.request.mockResolvedValueOnce(tokenResponse("ghu_new", "ghr_new"));

    const token = await manager.forceRefresh();

    expect(token).toBe("ghu_new");
  });

  it("should throw when forceRefresh is called while not signed in", async () => {
    await expect(manager.forceRefresh()).rejects.toMatchObject({
      name: "TokenRefreshError",
      reason: "BAD_REFRESH_TOKEN",
    });
  });
});

describe("GitHubAuthManager.signOut", () => {
  it("should clear the stored token set", async () => {
    await store.save(OAUTH_TOKEN_SET_KEY, storedTokenSet());
    // Load first so manager has state.
    expect(await manager.isSignedIn()).toBe(true);

    await manager.signOut();

    expect(await store.load(OAUTH_TOKEN_SET_KEY)).toBe("");
    expect(await manager.isSignedIn()).toBe(false);
  });
});

describe("GitHubAuthManager.signIn", () => {
  it("should run device flow and persist the resulting token set", async () => {
    http.request
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        json: {
          device_code: "dev_abc",
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 0,
        },
        text: "",
        arrayBuffer: new ArrayBuffer(0),
      })
      .mockResolvedValueOnce(tokenResponse("ghu_fresh", "ghr_fresh"));

    const controller = new AbortController();
    const onCode = vi.fn();

    const result = await manager.signIn(onCode, controller.signal);

    expect(onCode).toHaveBeenCalledWith(
      expect.objectContaining({
        userCode: "WDJB-MJHT",
        verificationUri: "https://github.com/login/device",
      }),
    );
    expect(result.accessToken).toBe("ghu_fresh");

    const persisted = JSON.parse(await store.load(OAUTH_TOKEN_SET_KEY));
    expect(persisted.accessToken).toBe("ghu_fresh");
  });

  it("should leave store untouched if device flow is aborted", async () => {
    http.request.mockResolvedValueOnce({
      status: 200,
      headers: {},
      json: {
        device_code: "dev_abc",
        user_code: "WDJB-MJHT",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
      text: "",
      arrayBuffer: new ArrayBuffer(0),
    });

    const controller = new AbortController();
    controller.abort();

    const settled = manager
      .signIn(() => {}, controller.signal)
      .then(() => ({ ok: true }), (err: unknown) => ({ ok: false, err }));
    const result = await settled;

    expect(result.ok).toBe(false);
    expect(await store.load(OAUTH_TOKEN_SET_KEY)).toBe("");
  });
});
