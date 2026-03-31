import { vi, describe, it, expect, beforeEach } from "vitest";
import { GitHubApiError, RateLimitError } from "../errors";
import { GitHubApi } from "../github-api";
import type { HttpClient, HttpResponse } from "@pylon-sync/core";

vi.mock("../sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

function createMockHttp() {
  return { request: vi.fn<HttpClient["request"]>() };
}

let mockHttp: ReturnType<typeof createMockHttp>;
let api: GitHubApi;

beforeEach(() => {
  mockHttp = createMockHttp();
  api = new GitHubApi(mockHttp);
});

function mockResponse(
  status: number,
  json: unknown = {},
  headers: Record<string, string> = {},
) {
  mockHttp.request.mockResolvedValue({
    status,
    headers,
    json,
    text: JSON.stringify(json),
    arrayBuffer: new ArrayBuffer(0),
  });
}

const TOKEN = "ghp_test123";

describe("GitHubApi.rest", () => {
  it("should set correct headers", async () => {
    mockResponse(200);

    await api.rest("GET", "/repos/owner/repo", TOKEN);

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          Authorization: `token ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "pylon-sync",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("should make GET request without body", async () => {
    mockResponse(200);

    await api.rest("GET", "/repos/owner/repo", TOKEN);

    const call = mockHttp.request.mock.calls[0]![0];
    expect(call).toMatchObject({
      url: "https://api.github.com/repos/owner/repo",
      method: "GET",
    });
    expect(call).not.toHaveProperty("body");
  });

  it("should make POST request with JSON body", async () => {
    mockResponse(201, { sha: "abc123" });
    const body = { message: "test", content: "base64data" };

    await api.rest("POST", "/repos/owner/repo/git/blobs", TOKEN, body);

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  });

  it("should return parsed response for 2xx status", async () => {
    const json = { sha: "abc123", url: "https://api.github.com/..." };
    mockResponse(200, json, { etag: '"abc"' });

    const result = await api.rest("GET", "/repos/owner/repo", TOKEN);

    expect(result).toEqual({
      status: 200,
      json,
      text: JSON.stringify(json),
      headers: { etag: '"abc"' },
      arrayBuffer: expect.any(ArrayBuffer),
    });
  });

  it("should return response (not throw) for 304 status", async () => {
    mockResponse(304);

    const result = await api.rest("GET", "/repos/owner/repo", TOKEN);

    expect(result.status).toBe(304);
  });

  it("should return response (not throw) for 409 status", async () => {
    mockResponse(409, { message: "Git Repository is empty." });

    const result = await api.rest(
      "GET",
      "/repos/owner/repo/git/ref/heads/main",
      TOKEN,
    );

    expect(result.status).toBe(409);
  });

  it("should return response (not throw) for 422 status", async () => {
    mockResponse(422, { message: "Reference does not exist" });

    const result = await api.rest(
      "PATCH",
      "/repos/owner/repo/git/refs/heads/main",
      TOKEN,
      { sha: "abc", force: false },
    );

    expect(result.status).toBe(422);
  });

  it("should throw GitHubApiError for 401 status", async () => {
    mockResponse(401, { message: "Bad credentials" });

    await expect(
      api.rest("GET", "/repos/owner/repo", TOKEN),
    ).rejects.toThrow(GitHubApiError);

    mockResponse(401, { message: "Bad credentials" });
    try {
      await api.rest("GET", "/repos/owner/repo", TOKEN);
    } catch (e) {
      expect(e).toBeInstanceOf(GitHubApiError);
      expect((e as GitHubApiError).status).toBe(401);
      expect((e as GitHubApiError).endpoint).toBe("/repos/owner/repo");
    }
  });

  it("should return response (not throw) for 404 status", async () => {
    mockResponse(404, { message: "Not Found" });

    const result = await api.rest("GET", "/repos/owner/repo", TOKEN);

    expect(result.status).toBe(404);
  });

  it("should throw GitHubApiError for 403 without rate limit headers", async () => {
    mockResponse(403, { message: "Forbidden" });

    await expect(
      api.rest("GET", "/repos/owner/repo", TOKEN),
    ).rejects.toThrow(GitHubApiError);
  });

  it("should throw GitHubApiError for 500 status", async () => {
    mockResponse(500, { message: "Internal Server Error" });

    await expect(
      api.rest("GET", "/repos/owner/repo", TOKEN),
    ).rejects.toThrow(GitHubApiError);
  });

  it("should throw RateLimitError on 429 status", async () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
    mockResponse(429, { message: "rate limit exceeded" }, {
      "x-ratelimit-reset": String(resetTimestamp),
    });

    await expect(
      api.rest("GET", "/repos/owner/repo", TOKEN),
    ).rejects.toThrow(RateLimitError);
  });

  it("should throw RateLimitError on 403 with x-ratelimit-remaining: '0'", async () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
    mockResponse(403, { message: "API rate limit exceeded" }, {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(resetTimestamp),
    });

    await expect(
      api.rest("GET", "/repos/owner/repo", TOKEN),
    ).rejects.toThrow(RateLimitError);
  });

  it("should NOT throw RateLimitError on 403 without rate limit headers", async () => {
    mockResponse(403, { message: "Forbidden" });

    await expect(
      api.rest("GET", "/repos/owner/repo", TOKEN),
    ).rejects.toThrow(GitHubApiError);

    mockResponse(403, { message: "Forbidden" });
    await expect(
      api.rest("GET", "/repos/owner/repo", TOKEN),
    ).rejects.not.toThrow(RateLimitError);
  });

  it("should parse x-ratelimit-reset header into Date for RateLimitError", async () => {
    const resetTimestamp = 1700000000;
    mockResponse(429, { message: "rate limit exceeded" }, {
      "x-ratelimit-reset": String(resetTimestamp),
    });

    try {
      await api.rest("GET", "/repos/owner/repo", TOKEN);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      const error = e as RateLimitError;
      expect(error.resetAt).toEqual(new Date(resetTimestamp * 1000));
    }
  });
});

describe("GitHubApi.graphql", () => {
  it("should send POST to /graphql with query and variables", async () => {
    mockResponse(200, { data: { repository: { id: "123" } } });

    const query = "query { repository(owner: $owner, name: $name) { id } }";
    const variables = { owner: "test", name: "repo" };

    await api.graphql(TOKEN, query, variables);

    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://api.github.com/graphql",
        body: JSON.stringify({ query, variables }),
      }),
    );
  });

  it("should return data from response", async () => {
    const data = { repository: { id: "123", name: "test-repo" } };
    mockResponse(200, { data });

    const result = await api.graphql(TOKEN, "query { repository { id } }");

    expect(result).toEqual(data);
  });

  it("should throw GitHubApiError when response contains errors array", async () => {
    mockResponse(200, {
      errors: [{ message: "Field 'foo' not found" }, { message: "other" }],
    });

    try {
      await api.graphql(TOKEN, "query { foo }");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GitHubApiError);
      const error = e as GitHubApiError;
      expect(error.message).toBe("Field 'foo' not found");
      expect(error.status).toBe(200);
      expect(error.endpoint).toBe("/graphql");
    }
  });
});
