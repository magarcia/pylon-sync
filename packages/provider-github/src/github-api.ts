import type { HttpClient, HttpResponse } from "@pylon-sync/core";
import type { TokenProvider } from "@pylon-sync/auth-github";
import { resolveHostUrls } from "@pylon-sync/auth-github";
import { GitHubApiError, RateLimitError } from "./errors";
import { sleep } from "./sleep";

const PASSTHROUGH_STATUSES = new Set([304, 404, 409, 422]);

export interface RestResponse {
  status: number;
  json: unknown;
  text?: string;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
}

const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000;
const BACKOFF_FACTOR = 2;
const MAX_DELAY = 10000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

// Resolve a TokenProvider to a string. `force` re-invokes a function provider
// (used for the retry-on-401 path to request a refreshed token).
async function resolveToken(
  provider: TokenProvider,
  force: boolean,
): Promise<string> {
  if (typeof provider === "string") return provider;
  if (force && provider.onUnauthorized) {
    return provider.onUnauthorized();
  }
  return provider.getToken();
}

export class GitHubApi {
  private readonly apiBase: string;

  constructor(
    private http: HttpClient,
    host: string = "github.com",
  ) {
    this.apiBase = resolveHostUrls(host).apiBase;
  }

  private async requestWithRetry(
    params: Parameters<HttpClient["request"]>[0],
  ): Promise<HttpResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.http.request(params);

        if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
          let delay: number;
          if (response.status === 429) {
            const retryAfter = response.headers["retry-after"];
            const resetAt = response.headers["x-ratelimit-reset"];
            if (retryAfter) {
              delay = parseInt(retryAfter, 10) * 1000;
            } else if (resetAt) {
              delay = Math.max(0, parseInt(resetAt, 10) * 1000 - Date.now());
            } else {
              delay = INITIAL_DELAY * Math.pow(BACKOFF_FACTOR, attempt);
            }
          } else {
            delay = INITIAL_DELAY * Math.pow(BACKOFF_FACTOR, attempt);
          }

          delay = Math.min(delay, MAX_DELAY);
          // Jitter: +-25%
          delay = delay * (0.75 + Math.random() * 0.5);

          console.log(
            `[GitHubApi] Retrying after ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES}, status ${response.status})`,
          );
          await sleep(delay);
          continue;
        }

        return response;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const delay =
            Math.min(INITIAL_DELAY * Math.pow(BACKOFF_FACTOR, attempt), MAX_DELAY) *
            (0.75 + Math.random() * 0.5);
          console.log(
            `[GitHubApi] Network error, retrying after ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES}):`,
            (err as Error).message,
          );
          await sleep(delay);
          lastError = err as Error;
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }

  async rest(
    method: string,
    path: string,
    token: TokenProvider,
    body?: unknown,
    headerOverrides?: Record<string, string>,
  ): Promise<RestResponse> {
    // First attempt: use the current token.
    let response = await this.doRest(method, path, token, false, body, headerOverrides);

    // Retry once on 401 only if the caller gave us a refreshable provider
    // (object with onUnauthorized). PATs and plain provider objects skip the
    // retry — repeating the same token won't help.
    const canRefresh =
      typeof token === "object" && typeof token.onUnauthorized === "function";
    if (response.status === 401 && canRefresh) {
      response = await this.doRest(method, path, token, true, body, headerOverrides);
    }

    if (
      (response.status >= 200 && response.status < 300) ||
      PASSTHROUGH_STATUSES.has(response.status)
    ) {
      return response;
    }

    // Rate limit: 429, or 403 with x-ratelimit-remaining === "0"
    if (
      response.status === 429 ||
      (response.status === 403 && response.headers["x-ratelimit-remaining"] === "0")
    ) {
      const resetSeconds = parseInt(response.headers["x-ratelimit-reset"] || "0", 10);
      const resetAt = new Date(resetSeconds * 1000);
      throw new RateLimitError(`Rate limit exceeded for ${path}`, resetAt);
    }

    const message =
      typeof response.json === "object" &&
      response.json !== null &&
      "message" in response.json
        ? (response.json as { message: string }).message
        : `GitHub API error: ${response.status}`;

    throw new GitHubApiError(message, response.status, path);
  }

  private async doRest(
    method: string,
    path: string,
    tokenProvider: TokenProvider,
    forceRefresh: boolean,
    body?: unknown,
    headerOverrides?: Record<string, string>,
  ): Promise<RestResponse> {
    const resolvedToken = await resolveToken(tokenProvider, forceRefresh);

    const headers: Record<string, string> = {
      Authorization: `token ${resolvedToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "pylon-sync",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...headerOverrides,
    };

    const params: Parameters<HttpClient["request"]>[0] = {
      url: `${this.apiBase}${path}`,
      method,
      headers,
    };

    if (body !== undefined) {
      params.body = JSON.stringify(body);
    }

    const response: HttpResponse = await this.requestWithRetry(params);
    return {
      status: response.status,
      json: response.json,
      text: response.text,
      headers: response.headers,
      arrayBuffer: response.arrayBuffer,
    };
  }

  async downloadZip(
    owner: string,
    repo: string,
    ref: string,
    token: TokenProvider,
  ): Promise<ArrayBuffer> {
    const url = `${this.apiBase}/repos/${owner}/${repo}/zipball/${ref}`;

    const buildRequest = (resolvedToken: string) => ({
      url,
      method: "GET" as const,
      headers: {
        Authorization: `token ${resolvedToken}`,
        "User-Agent": "pylon-sync",
      },
    });

    let resolvedToken = await resolveToken(token, false);
    let response = await this.requestWithRetry(buildRequest(resolvedToken));

    const canRefresh =
      typeof token === "object" && typeof token.onUnauthorized === "function";
    if (response.status === 401 && canRefresh) {
      resolvedToken = await resolveToken(token, true);
      response = await this.requestWithRetry(buildRequest(resolvedToken));
    }

    return response.arrayBuffer;
  }

  async graphql(
    token: TokenProvider,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.rest("POST", "/graphql", token, {
      query,
      variables,
    });

    const json = response.json as Record<string, unknown>;

    if (Array.isArray(json.errors) && json.errors.length > 0) {
      throw new GitHubApiError(
        (json.errors[0] as { message: string }).message,
        200,
        "/graphql",
      );
    }

    return json.data;
  }
}
