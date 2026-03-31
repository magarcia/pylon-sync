# ADR-005: ZIP Archive Download for First Sync

## Status

Accepted

## Date

2026-03-31

## Context

First sync currently downloads each remote file individually via the GitHub Contents API (one API call per file). In `fetchFullTree`, every file that doesn't exist locally is fetched through `fetchFileContent`, which hits `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}` per file. A vault with 1377 files burns through the 5000 requests/hour rate limit in a single sync cycle.

The competing plugin github-gitless-sync solves this by downloading the entire repository as a ZIP archive in one API call: `GET /repos/{owner}/{repo}/zipball/{branch}`. This returns every file in the repo as a compressed archive, requiring only a single request regardless of vault size.

See: `.project/COMPETITIVE-RESEARCH.md` (Priority 1: First Sync Performance)

Current code path: `GitHubProvider.fetchFullTree` iterates `fetchPaths` and calls `fetchFileContent` in batches of 5, resulting in O(N) API calls (`packages/provider-github/src/github-provider.ts`, lines 363-432).

## Options Considered

### Option A: Per-file fetch (current)

- Pros: Simple implementation, no extra dependencies, works with any file
- Cons: O(N) API calls. A 1377-file vault requires ~276 sequential batches of 5, exhausting the rate limit. First sync is slow and unreliable for non-trivial vaults.

### Option B: ZIP archive download

- `GET /repos/{owner}/{repo}/zipball/{branch}` returns the entire repo as a ZIP file in one API call
- Extract locally using a JavaScript ZIP library (zip.js or fflate)
- Pros: First sync drops from ~1400 API calls to ~5 (branch check + ZIP download + tree fetch for push metadata). Works regardless of vault size.
- Cons: Downloads the entire repo even if some files already exist locally. Requires a ZIP extraction dependency. ZIP response includes a top-level directory wrapper that must be stripped.

### Option C: Git blob batch via GraphQL

- Use GitHub's GraphQL API to batch-fetch multiple blob contents in a single query
- Pros: Fewer API calls than per-file, more targeted than ZIP (can request specific files)
- Cons: GraphQL has its own rate limit (separate point budget). Still multiple queries for large repos. More complex query construction. Doesn't solve the problem as cleanly as ZIP for first sync.

## Decision

Option B for first sync (when no cursor exists). Keep per-file fetch for incremental syncs where the diff is small.

Implementation plan:
1. Add `downloadArchive(branch: string): Promise<ArrayBuffer>` to `GitHubProvider`
2. Add a ZIP extraction utility (using fflate — lightweight, no WASM, tree-shakeable)
3. In `fetchFullTree`, when called without a cursor (first sync), use ZIP download instead of per-file fetch
4. Strip the top-level directory from ZIP paths (GitHub wraps content in `{owner}-{repo}-{sha}/`)
5. Fall back to per-file fetch if ZIP download fails (e.g., repo too large for ZIP — GitHub caps at ~1 GB)

## Consequences

- First sync API usage drops from ~1400 calls to ~5, well within rate limits
- Adds a ZIP extraction dependency (fflate: ~8 KB gzipped, no WASM, works in all environments)
- ZIP downloads the entire repo, including files that may already exist locally. For first sync this is acceptable since most files won't exist yet. For repos with many binary files, the ZIP may be large but still faster than individual fetches.
- Incremental syncs (with cursor) are unaffected — they continue using tree comparison + per-file fetch for small diffs
- Need to handle the GitHub ZIP wrapper directory when extracting paths
