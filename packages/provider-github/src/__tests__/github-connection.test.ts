import { vi, describe, it, expect, beforeEach } from "vitest";
import { GitHubConnection } from "../github-connection";
import type { HttpClient } from "@pylon-sync/core";

vi.mock("../sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

function createMockHttp() {
  return { request: vi.fn<HttpClient["request"]>() };
}

function mockResponse(status: number, json: unknown = {}) {
  return {
    status,
    headers: {},
    json,
    text: "",
    arrayBuffer: new ArrayBuffer(0),
  };
}

let mockHttp: ReturnType<typeof createMockHttp>;
let conn: GitHubConnection;

beforeEach(() => {
  mockHttp = createMockHttp();
  conn = new GitHubConnection(mockHttp, "test-token");
});

describe("GitHubConnection.listRepos", () => {
  it("should map permissions.push to can_push", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, [
        { full_name: "user/repo-a", private: false, permissions: { push: true } },
        { full_name: "user/repo-b", private: true, permissions: { push: false } },
        { full_name: "user/repo-c", private: false },
      ]),
    );

    const repos = await conn.listRepos();

    expect(repos).toEqual([
      { full_name: "user/repo-a", private: false, can_push: true },
      { full_name: "user/repo-b", private: true, can_push: false },
      { full_name: "user/repo-c", private: false, can_push: false },
    ]);
  });

  it("should accept a TokenProvider object", async () => {
    const getToken = vi.fn().mockResolvedValue("ghu_token");
    const providerConn = new GitHubConnection(mockHttp, { getToken });
    mockHttp.request.mockResolvedValue(mockResponse(200, []));

    await providerConn.listRepos();

    expect(getToken).toHaveBeenCalled();
  });
});

describe("GitHubConnection.listInstallations", () => {
  it("should map the installations response shape", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        total_count: 2,
        installations: [
          {
            id: 111,
            account: { login: "user" },
            target_type: "User",
            repository_selection: "selected",
          },
          {
            id: 222,
            account: { login: "my-org" },
            target_type: "Organization",
            repository_selection: "all",
          },
        ],
      }),
    );

    const installations = await conn.listInstallations();

    expect(installations).toEqual([
      {
        id: 111,
        account_login: "user",
        target_type: "User",
        repository_selection: "selected",
      },
      {
        id: 222,
        account_login: "my-org",
        target_type: "Organization",
        repository_selection: "all",
      },
    ]);
  });

  it("should return empty array when installations field is missing", async () => {
    mockHttp.request.mockResolvedValue(mockResponse(200, { total_count: 0 }));

    const installations = await conn.listInstallations();

    expect(installations).toEqual([]);
  });

  it("should request the /user/installations endpoint", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, { installations: [] }),
    );

    await conn.listInstallations();

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.github.com/user/installations",
      }),
    );
  });
});

describe("GitHubConnection.listInstallationRepos", () => {
  it("should request the installation repositories endpoint", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, { total_count: 0, repositories: [] }),
    );

    await conn.listInstallationRepos(42);

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.github.com/user/installations/42/repositories?per_page=100&page=1",
      }),
    );
  });

  it("should map repositories with permissions", async () => {
    mockHttp.request.mockResolvedValue(
      mockResponse(200, {
        total_count: 1,
        repositories: [
          {
            full_name: "user/notes",
            private: true,
            permissions: { push: true },
          },
        ],
      }),
    );

    const repos = await conn.listInstallationRepos(42);

    expect(repos).toEqual([
      { full_name: "user/notes", private: true, can_push: true },
    ]);
  });

  it("should return empty array when repositories field is missing", async () => {
    mockHttp.request.mockResolvedValue(mockResponse(200, { total_count: 0 }));

    const repos = await conn.listInstallationRepos(42);

    expect(repos).toEqual([]);
  });
});

describe("GitHubConnection with custom host", () => {
  it("should target GHES api path", async () => {
    const ghesConn = new GitHubConnection(
      mockHttp,
      "ghp_test",
      "ghes.example.com",
    );
    mockHttp.request.mockResolvedValue(mockResponse(200, []));

    await ghesConn.listRepos();

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("https://ghes.example.com/api/v3/"),
      }),
    );
  });
});
