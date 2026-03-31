import { ProviderError } from "@pylon-sync/core";

export class GitHubApiError extends ProviderError {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super("API_ERROR", message);
    this.name = "GitHubApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class RateLimitError extends ProviderError {
  readonly resetAt: Date;

  constructor(message: string, resetAt: Date) {
    super("RATE_LIMIT", message);
    this.name = "RateLimitError";
    this.resetAt = resetAt;
  }
}
