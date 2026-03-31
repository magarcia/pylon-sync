---
paths:
  - "packages/provider-github/**/*.ts"
---

# GitHub Provider Rules

- Implements the `Provider` interface from `@pylon-sync/core` with opaque `GitHubCursor`
- Uses `GitHubApi` class (wraps `HttpClient`) — NEVER import `requestUrl` directly
- All API calls go through `requestWithRetry()` — automatic exponential backoff on 429/5xx
- `downloadZip()` bypasses retry (large binary response, different error handling)
- ZIP extraction uses async `unzip` from fflate — NEVER `unzipSync` (blocks main thread)
- Decompression size limit: 500MB. File size limit: 100MB (GitHub API limit)
- Don't filter dotfiles in `buildBlobMap()` or `downloadArchive()` — let core's `isTrackedPath` decide
- Validate owner/repo/branch with regex in constructor — reject invalid characters
- `push()` returns the new commit SHA as a `SyncCursor` — the engine stores it
- On 422 ref update: re-fetch HEAD to distinguish conflict (HEAD moved) from permission error (HEAD unchanged)
- `ensureRepository()` in bootstrap: creates private repo if it doesn't exist (user or org)
- `GitHubConnection` class is for settings UI discovery (list repos/branches) — not used in sync
