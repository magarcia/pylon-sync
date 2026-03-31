# ADR-006: Git Blob SHA-1 for Local Comparison

## Status

Accepted

## Date

2026-03-31

## Context

GitHub's tree API returns blob SHAs for every file. These SHAs are computed using Git's blob hashing scheme: `SHA-1("blob " + byteLength + "\0" + content)`. Our local snapshot hashes use SHA-256 of raw content (via `hashBuffer` in `@pylon-sync/core`). These two hash schemes produce completely different values for identical content, making direct comparison impossible.

During `fetchFullTree`, we currently skip files that exist in the local snapshot or in `localPaths`, but we have no way to know if a remote file's content matches what we have locally. This means we either download files unnecessarily or skip them blindly and hope the reconciler catches differences.

Both github-gitless-sync and Fit compute git-compatible SHA-1 hashes locally to compare against the tree API response, enabling them to skip downloads for files that haven't changed.

See: `.project/COMPETITIVE-RESEARCH.md` (Priority 1: Git-compatible SHA-1 for local comparison)

## Options Considered

### Option A: Keep SHA-256, download all remote files (current implicit behavior)

- Pros: No changes needed, snapshot hashes remain consistent
- Cons: Cannot compare local files against remote tree SHAs. During first sync or tree-based fetches, we must either download everything or skip blindly. Wastes bandwidth and API calls on files that haven't changed.

### Option B: Add git blob SHA-1 computation

- Compute `SHA-1("blob " + byteLength + "\0" + content)` using Web Crypto API
- Compare the computed SHA against the blob SHA from GitHub's tree API
- Only download files where SHAs differ
- Pros: Exact match with GitHub's blob identification. Web Crypto's `SHA-1` is available on all target platforms (browser, Node, Obsidian mobile). Zero dependencies.
- Cons: Requires reading local file content to compute the hash. SHA-1 is cryptographically weak (irrelevant here — we're matching Git's format, not using it for security).

### Option C: Use SHA-256 for both sides and store a mapping

- Store a `Map<path, gitBlobSha>` alongside the snapshot, populated when we last fetched from remote
- Pros: Could compare without recomputing hashes
- Cons: Requires persisting extra metadata. Stale if files are modified outside Obsidian. Doesn't work for first sync (no prior mapping exists). Adds complexity to snapshot management.

## Decision

Option B. Add a `gitBlobSha(content: ArrayBuffer): Promise<string>` function to the hash module in `@pylon-sync/core`.

Implementation plan:
1. Add `gitBlobSha(content: ArrayBuffer): Promise<string>` to the hash module
2. The function prepends `"blob {byteLength}\0"` to the content and computes SHA-1 via `crypto.subtle.digest("SHA-1", ...)`
3. In `fetchFullTree`, after fetching the tree, read local file content for files that exist locally and compute their git blob SHA
4. Compare against tree blob SHAs — only add to `fetchPaths` files where SHAs differ
5. This complements ADR-005 (ZIP download): for first sync, ZIP is used. For subsequent full-tree fetches (e.g., after force-resync), git blob SHA comparison avoids redundant downloads.

## Consequences

- Adds SHA-1 computation capability (Web Crypto supports it on all platforms)
- Does not replace our SHA-256 snapshot hashes — those serve a different purpose (local change detection)
- `gitBlobSha` is only used for remote comparison during tree-based fetches
- Requires reading local file content during comparison, adding I/O during fetch. This is acceptable because reading local files is fast compared to downloading them from GitHub.
- For incremental syncs (tree diff), we already compare old vs new tree SHAs, so git blob SHA comparison is mainly useful for full-tree scenarios
