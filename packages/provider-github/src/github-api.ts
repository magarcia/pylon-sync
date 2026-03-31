import type { HttpClient, HttpResponse } from "@pylon-sync/core";
import { GitHubApiError, RateLimitError } from "./errors";
import { sleep } from "./sleep";

const BASE_URL = "https://api.github.com";

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

export class GitHubApi {
  constructor(private http: HttpClient) {}

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
    token: string,
    body?: unknown,
    headerOverrides?: Record<string, string>,
  ): Promise<RestResponse> {
    const headers: Record<string, string> = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "pylon-sync",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...headerOverrides,
    };

    const params: Parameters<HttpClient["request"]>[0] = {
      url: `${BASE_URL}${path}`,
      method,
      headers,
    };

    if (body !== undefined) {
      params.body = JSON.stringify(body);
    }

    const response: HttpResponse = await this.requestWithRetry(params);
    const { status, headers: resHeaders, json, text } = response;

    if ((status >= 200 && status < 300) || PASSTHROUGH_STATUSES.has(status)) {
      return { status, json, text, headers: resHeaders, arrayBuffer: response.arrayBuffer };
    }

    // Rate limit: 429, or 403 with x-ratelimit-remaining === "0"
    if (
      status === 429 ||
      (status === 403 && resHeaders["x-ratelimit-remaining"] === "0")
    ) {
      const resetSeconds = parseInt(resHeaders["x-ratelimit-reset"] || "0", 10);
      const resetAt = new Date(resetSeconds * 1000);
      throw new RateLimitError(
        `Rate limit exceeded for ${path}`,
        resetAt,
      );
    }

    const message =
      typeof json === "object" && json !== null && "message" in json
        ? (json as { message: string }).message
        : `GitHub API error: ${status}`;

    throw new GitHubApiError(message, status, path);
  }

  async downloadZip(
    owner: string,
    repo: string,
    ref: string,
    token: string,
  ): Promise<ArrayBuffer> {
    const response = await this.requestWithRetry({
      url: `${BASE_URL}/repos/${owner}/${repo}/zipball/${ref}`,
      method: "GET",
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "pylon-sync",
      },
    });
    return response.arrayBuffer;
  }

  async graphql(
    token: string,
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
