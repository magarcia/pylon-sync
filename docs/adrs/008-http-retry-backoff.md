# ADR-008: HTTP Retry with Exponential Backoff

## Status

Accepted

## Date

2026-03-31

## Context

Currently, if any single API call fails — whether from a transient network error, a 500 server error, or a 429 rate limit response — the entire sync cycle fails. The user must manually retry, and the failed sync may leave the engine in an inconsistent state.

All three competing plugins implement retry logic:
- Fit uses Octokit's built-in retry plugin (3 retries, 2x backoff)
- github-gitless-sync retries on 422 with configurable max retries
- gitsync has basic retry on network errors

Our `HttpClient` interface (`packages/core/src/types.ts`) is a simple request/response abstraction with no retry behavior. Errors like `RateLimitError` and `GitHubApiError` are thrown immediately.

See: `.project/COMPETITIVE-RESEARCH.md` (Priority 3: Retry with exponential backoff)

## Options Considered

### Option A: No retry (current)

- Pros: Simple, predictable behavior
- Cons: Fragile. A single transient 500 or brief network interruption kills the entire sync. Rate limit hits (429) are unrecoverable without manual intervention. Poor UX for users on unstable connections or during GitHub incidents.

### Option B: Retry at HttpClient level

- Wrap every HTTP request with retry logic inside the `HttpClient` implementations (`ObsidianHttpClient`, `NodeHttpClient`)
- All providers benefit automatically without any code changes
- Pros: Single implementation point. Every API call gets retry for free. Provider code stays clean — no retry logic mixed with business logic.
- Cons: Retry behavior is invisible to the provider. Some requests (e.g., non-idempotent POSTs) might not be safe to retry, though in practice GitHub's Git Data API is idempotent (creating the same blob/tree twice returns the same SHA).

### Option C: Retry at provider level

- Each provider implements its own retry wrapper around specific API calls
- Pros: Full control over which calls get retried and with what parameters
- Cons: Duplicated retry logic across providers. Mixes retry concerns with sync logic. Every new provider must re-implement retry.

### Option D: Retry at sync engine level

- Retry the entire sync cycle on failure
- Pros: Simple — just wrap `sync()` in a retry loop
- Cons: Coarse-grained. A failure on the last API call restarts the entire sync from scratch. Wastes all the work done before the failure. Doesn't help with rate limits (retrying the whole cycle burns more quota).

## Decision

Option B. Add retry logic to the `HttpClient` implementations.

Retry configuration:
- **Max retries**: 3
- **Initial delay**: 1000ms
- **Backoff factor**: 2x (delays: 1000ms, 2000ms, 4000ms)
- **Max delay**: 10000ms

Retry on:
- `429` (rate limited) — wait for the duration specified in `Retry-After` header or `X-RateLimit-Reset` timestamp, then retry
- `500`, `502`, `503` (server errors) — exponential backoff
- Network errors (connection reset, timeout) — exponential backoff

Do NOT retry on:
- `400` (bad request) — malformed request, won't succeed on retry
- `401` (unauthorized) — invalid token, won't succeed on retry
- `403` (forbidden) — insufficient permissions, won't succeed on retry
- `404` (not found) — resource doesn't exist, won't succeed on retry
- `422` (unprocessable entity) — semantic error (e.g., push conflict), won't succeed on retry

Implementation plan:
1. Create a `withRetry` wrapper function in `@pylon-sync/core` that accepts an `HttpClient` and returns a new `HttpClient` with retry behavior
2. The wrapper intercepts responses, checks status codes, and retries with backoff when appropriate
3. For 429 responses, parse `Retry-After` (seconds) or `X-RateLimit-Reset` (Unix timestamp) headers to determine wait duration
4. Apply the wrapper in `ObsidianHttpClient` and `NodeHttpClient` constructors, or at the provider construction site
5. Add jitter (0-25% random addition) to backoff delays to avoid thundering herd

## Consequences

- All API calls across all providers get automatic retry without code changes
- Rate limit handling is significantly improved: instead of failing immediately, the client waits for the rate limit window to reset
- Transient GitHub outages (502/503) are handled gracefully
- Total worst-case delay per request: ~7 seconds (1s + 2s + 4s) before giving up, acceptable for a background sync
- The `RateLimitError` class in `types.ts` may still be thrown after all retries are exhausted, preserving existing error handling
- Provider code remains clean — no retry logic mixed with sync logic
