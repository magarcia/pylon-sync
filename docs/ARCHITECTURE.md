# Architecture

## Overview

pylon-sync is a monorepo with five packages that syncs files to remote storage using provider REST APIs directly -- no git binary or native dependencies needed. It supports GitHub (via the Git Data API) and S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2). The core sync logic (reconciliation, three-way merge, snapshot computation) is implemented as pure functions with no platform dependencies. Each provider handles remote change detection in its own way: GitHub compares git trees; S3 compares object ETags against a stored manifest. Platform-specific concerns (filesystem access, HTTP transport) are abstracted behind interfaces, allowing the same engine to run in Obsidian (desktop and mobile) and as a standalone CLI.

### Packages

| Package | Path | Description |
|---------|------|-------------|
| `@pylon-sync/core` | `packages/core` | Platform-agnostic sync engine, reconciler, scanner, types |
| `@pylon-sync/provider-github` | `packages/provider-github` | GitHub provider using git-tree comparison |
| `@pylon-sync/provider-s3` | `packages/provider-s3` | S3-compatible storage provider (ETag-based change detection) |
| `@pylon-sync/cli` | `packages/cli` | CLI companion for syncing directories |
| `pylon-sync` | `packages/obsidian-plugin` | Obsidian plugin with vault integration and settings UI |

## Architecture Diagram

```
+-----------------------------------------------------------------------+
|  Consumers                                                            |
|                                                                       |
|  packages/obsidian-plugin          packages/cli                       |
|  - main.ts (Plugin entry point)   - main.ts (CLI entry point)         |
|  - settings.ts, status-bar.ts     - Implements FileSystem & HttpClient|
|  - Implements FileSystem &         for Node.js (fs + fetch)           |
|    HttpClient for Obsidian                                            |
|    (Vault API + requestUrl)                                           |
+-----------------------------------------------------------------------+
        |                                    |
        v                                    v
+-----------------------------------------------------------------------+
|  packages/core                                                        |
|                                                                       |
|  Sync Layer          Vault Layer           Core Layer                 |
|  - sync-engine.ts    - scanner.ts          - reconciler.ts            |
|  - scheduler.ts      - applier.ts          - snapshot.ts              |
|                      - tracked-path.ts     - hash.ts                  |
|                                                                       |
|  Abstractions                                                         |
|  - FileSystem interface                                               |
|  - HttpClient interface                                               |
|  - Provider interface                                                 |
+-----------------------------------------------------------------------+
        |
        v
+-----------------------------------+-----------------------------------+
|  packages/provider-github         |  packages/provider-s3             |
|                                   |                                   |
|  - github-provider.ts             |  - s3-provider.ts                 |
|    Implements Provider interface   |    Implements Provider interface   |
|  - github-api.ts                  |  - s3-api.ts                      |
|    Low-level HTTP calls            |    S3 REST API (XML parsing)      |
+-----------------------------------+-----------------------------------+
        |                                    |
        v                                    v
  GitHub REST API                      S3-compatible API
  (via HttpClient abstraction)         (via HttpClient abstraction)
```

## Module Breakdown

### Core Layer (`packages/core/src/`)

Pure functions with zero I/O. Fully testable without mocks.

| Module | Responsibility |
|--------|---------------|
| `hash.ts` | SHA-256 hashing via Web Crypto API. Produces `sha256-{hex}` strings for both text and binary content. Also exports `gitBlobSha` / `gitBlobShaText` for computing git-compatible blob SHA-1 hashes used to compare local files against tree entries. |
| `reconciler.ts` | `reconcile()` takes local and remote change sets plus stored base texts, and outputs a list of file mutations. `mergeText()` performs three-way merge using diff-match-patch. All conflict resolution is deterministic. |
| `snapshot.ts` | `computeSnapshot()` derives the next snapshot from the previous one plus mutations. |
| `classify.ts` | `classifyContent(buffer, mtime)` classifies an `ArrayBuffer` as text or binary using UTF-8 decode with `{ fatal: true }`. Shared by scanner and provider to avoid duplication. |

### Vault Layer (`packages/core/src/`)

Reads from and writes to the filesystem via the `FileSystem` abstraction.

| Module | Responsibility |
|--------|---------------|
| `scanner.ts` | `scan()` detects local changes (added, modified, deleted) by comparing files against the snapshot. Uses mtime pre-filtering to skip unchanged files, with periodic full hash scans as a fallback. `readFileState()` classifies files as text or binary. |
| `applier.ts` | `applyMutations()` writes, creates, or deletes local files based on mutation instructions. Processes deletes before writes to avoid path conflicts. |
| `tracked-path.ts` | `isTrackedPath()` determines whether a file should be synced, filtering out dotfiles, `.trash/`, `.obsidian/` (unless opted in), and user-defined glob patterns via picomatch. |

### Provider Layer — GitHub (`packages/provider-github/src/`)

Handles all GitHub API communication via the `HttpClient` abstraction.

| Module | Responsibility |
|--------|---------------|
| `github-api.ts` | Low-level wrapper around `HttpClient`. Sets auth headers, parses responses, maps HTTP errors to typed error classes (`GitHubApiError`, `RateLimitError`). Includes `requestWithRetry` for automatic retry with exponential backoff and jitter on transient failures. |
| `github-provider.ts` | Implements the `Provider` interface. `fetch()` detects remote changes by comparing git trees. `push()` creates blobs, trees, and commits via the Git Data API, then updates the branch ref. `getBase()` retrieves file content at a specific commit for on-demand merge base resolution. `bootstrap()` initializes empty repos with a `.gitkeep` file. `ensureRepository()` auto-creates a private repo if it does not exist. `downloadArchive()` fetches a ZIP archive for fast first sync. |
| `github-connection.ts` | `GitHubConnection` validates tokens, lists user repositories, and lists branches for a given repo. Used by the settings UI for the Verify/Browse/Load buttons. |

### Provider Layer — S3 (`packages/provider-s3/src/`)

Handles S3-compatible storage via the `HttpClient` abstraction. Supports any S3-compatible API (AWS S3, Cloudflare R2, MinIO, Backblaze B2).

| Module | Responsibility |
|--------|---------------|
| `s3-api.ts` | Low-level S3 REST API wrapper. Handles AWS Signature V4 signing, XML response parsing, and bucket operations (ListObjectsV2, GetObject, PutObject, DeleteObject). |
| `s3-provider.ts` | Implements the `Provider` interface. `fetch()` detects remote changes by listing objects and comparing ETags against a stored manifest cursor. `push()` uploads and deletes objects. `bootstrap()` returns an empty manifest cursor. Does not implement `getBase()` (S3 has no version history), so the engine falls back to two-way merge. |
| `types.ts` | `S3Config` (bucket, region, endpoint, credentials, prefix) and `S3Cursor` (manifest-based cursor storing ETags and last-modified timestamps). |
| `xml.ts` | Minimal XML parser for S3 ListObjectsV2 responses. |

### Sync Layer (`packages/core/src/`)

Orchestrates the sync lifecycle.

| Module | Responsibility |
|--------|---------------|
| `sync-engine.ts` | `SyncEngine.sync()` runs one full sync cycle: scan local, fetch remote (via git tree comparison), fetch merge bases on-demand for concurrent edits, reconcile, push, apply, update snapshot and cursor. Manages an in-memory lock to prevent concurrent syncs. Retries on push conflicts (up to 5 times). Supports `onBeforeApply`/`onAfterApply` callbacks for event suppression during file writes, and `onProgress` for reporting sync progress. |
| `scheduler.ts` | `SyncScheduler` manages sync timing. Debounces change events (default 2s). On desktop, runs a poll interval (default 30s). On mobile, responds to visibility change events. Exposes state transitions (`idle`, `debouncing`, `syncing`, `error`) for the status bar. |

### UI Layer (`packages/obsidian-plugin/src/`)

Obsidian-specific user interface components.

| Module | Responsibility |
|--------|---------------|
| `settings.ts` | Settings tab with token input (with Verify button), repo selection (Browse dropdown), branch selection (Load branches dropdown), toggles, and connection test. |
| `status-bar.ts` | Shows sync state ("Synced", "Syncing...", "Sync error") with relative timestamps. Also displays per-file sync status indicators (checkmark/dot/plus) via `setFileStatus()`. |
| `notices.ts` | Obsidian notices for sync results, auth errors, rate limits, and Obsidian Sync conflict warnings. |

## Provider Interface

The sync engine communicates with remote storage through the `Provider` interface. This decouples the engine from any specific backend.

```typescript
interface Provider {
  fetch(cursor?: SyncCursor, localPaths?: Set<string>): Promise<FetchResult>;
  push(payload: PushPayload, cursor?: SyncCursor): Promise<SyncCursor>;
  bootstrap(): Promise<SyncCursor>;
  getBase?(path: string, cursor: SyncCursor): Promise<string | null>;
}
```

### Opaque Cursor Model

The provider tracks its position in the remote history using an opaque cursor (`SyncCursor = unknown`). The sync engine stores and passes cursors but never inspects their contents. Each provider defines its own internal shape:

- **`SyncCursor`** -- opaque to the engine, serialized/deserialized by the provider
- **`GitHubCursor`** -- the GitHub provider's implementation: `{ commitSha: string; treeSha: string }`
- **`S3Cursor`** -- the S3 provider's implementation: a manifest of `{ etag, lastModified }` per object path

This design allows each provider to use whatever bookmark makes sense for its API without changing the engine. "Smart" backends (Git) only need a pointer to a version; "dumb" backends (S3) store a full file manifest in the cursor.

## HttpClient Abstraction

All HTTP communication goes through a pluggable `HttpClient` interface:

```typescript
interface HttpClient {
  request(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<HttpResponse>;
}
```

Each consumer provides its own implementation:

| Consumer | Implementation |
|----------|---------------|
| Obsidian plugin | Wraps `requestUrl()` -- handles HTTPS on every platform, bypasses CORS |
| CLI | Wraps Node.js `fetch` -- standard HTTP client |

This replaces the previous direct dependency on Obsidian's `requestUrl`, allowing the same provider code to run in any JavaScript environment.

## FileSystem Abstraction

Filesystem operations go through a platform-agnostic `FileSystem` interface:

```typescript
interface FileSystem {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeText(path: string, content: string): Promise<void>;
  writeBinary(path: string, content: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  list(): Promise<FileEntry[]>;
  exists(path: string): Promise<boolean>;
}
```

Each consumer provides its own implementation:

| Consumer | Implementation |
|----------|---------------|
| Obsidian plugin | Wraps `Vault` and `vault.adapter` APIs -- unified across Electron, iOS sandbox, Android storage |
| CLI | Wraps Node.js `fs` module -- standard filesystem access |

This replaces the previous direct dependency on Obsidian's Vault API, allowing the scanner, applier, and engine to work with any filesystem.

## Data Flow: Sync Cycle

```
File Change Event
       |
       v
  Scheduler (debounce 2s)
       |
       v
  SyncEngine.sync()
       |
       +---> scanner.scan(fileSystem, snapshot)
       |         |
       |         v
       |     Local ChangeSet {added, modified, deleted}
       |
       +---> provider.fetch(cursor)
       |         |
       |         v
       |     Compare old tree (cursor.commitSha) vs new tree (HEAD)
       |     -> Remote ChangeSet + new cursor
       |
       +---> provider.getBase(path, cursor)
       |         |  (only for files with concurrent edits -- on-demand)
       |         v
       |     Merge base content for three-way merge
       |
       +---> reconciler.reconcile(local, remote, bases, binaryConflict)
       |         |
       |         v
       |     FileMutation[]
       |
       +---> provider.push(payload, cursor)
       |         |  (only if remote writes/deletes exist)
       |         v
       |     Blobs -> Tree -> Commit -> Update Ref
       |
       +---> applier.applyMutations(fileSystem, mutations)
       |         |  (only if local writes/deletes exist)
       |         v
       |     Write/delete files locally
       |
       +---> computeSnapshot()
                 |
                 v
            Save snapshot + cursor
```

If `provider.push()` returns a `PushConflictError` (the branch ref moved between fetch and push), the engine retries from the fetch step, up to 5 times.

## Key Design Decisions

### API-only transport (ADR-001)

The engine communicates with remote storage exclusively through REST APIs. No git binary, no isomorphic-git. This eliminates the mobile instability that plagues git-binary-based approaches and ensures identical behavior across all platforms. The `Provider` interface now has two implementations: GitHub (Git Data API) and S3-compatible storage (ListObjectsV2, GetObject, PutObject, DeleteObject).

### Git tree comparison instead of remote snapshot (ADR-002)

Rather than storing a metadata file (like a snapshot) in the repository, the engine detects remote changes by comparing git trees. It stores the last-synced cursor locally and, on each fetch, retrieves both the old tree (at the cursor's commit SHA) and the new tree (at HEAD). Diffing these two trees reveals added, modified, and deleted files without any remote metadata. This means external tools (GitHub Actions, the web editor, pull requests) can modify the repository freely and the engine will detect all changes automatically.

### On-demand merge bases from git (ADR-003)

Three-way merge requires a base version of each concurrently edited file. Rather than storing base files locally, the engine fetches them on-demand from git via `provider.getBase(path, cursor)`. Only files that actually have concurrent local and remote edits trigger a base fetch, keeping API usage minimal. This eliminates the need for a local `bases/` directory entirely.

### Monorepo with platform abstractions

The project is structured as a pnpm monorepo. Platform-specific concerns (filesystem, HTTP) are abstracted behind interfaces defined in `@pylon-sync/core`. This allows the same sync engine and provider to run in Obsidian (plugin) and Node.js (CLI) without code duplication.

### ZIP archive download for first sync (ADR-005)

On first sync (no existing cursor), the provider downloads the repository as a ZIP archive instead of fetching files individually. This reduces API calls from 2 + N to approximately 3-5 regardless of repository size, and is significantly faster for large vaults.

### HTTP retry with exponential backoff (ADR-008)

Transient network errors and GitHub 5xx responses are retried automatically with exponential backoff and jitter via `requestWithRetry` in the provider layer. This prevents single-request failures from aborting an entire sync cycle.

### esbuild for builds, Vitest for tests (ADR-004)

esbuild matches the official Obsidian plugin template (CJS output, `obsidian` externalized). Vitest handles testing with the `obsidian` module aliased to a local mock. The core layer requires no mocks at all since it is pure functions.

## Snapshot Storage Strategy

Each consumer persists state in its own way:

### Obsidian plugin -- `data.json` (via `plugin.saveData()`)

```json
{
  "settings": { ... },
  "pluginData": {
    "snapshot": {
      "notes/todo.md": { "hash": "sha256-abc123...", "mtime": 1711700000000 },
      "images/photo.png": { "hash": "sha256-def456...", "mtime": 1711700000000, "modified": 1711700000000 }
    },
    "lastSyncTime": 1711700000000,
    "syncCount": 42,
    "cursor": { "commitSha": "abc123...", "treeSha": "def456..." }
  }
}
```

### CLI -- `.pylon/` directory

Config and data are stored in two separate files:

**`.pylon/config.json`**
```json
{
  "repo": "owner/repo",
  "branch": "main"
}
```

**`.pylon/data.json`**
```json
{
  "snapshot": { ... },
  "cursor": { "commitSha": "abc123...", "treeSha": "def456..." }
}
```

The snapshot maps each synced file path to its hash and local mtime. Binary files also store a `modified` timestamp for last-modified-wins conflict resolution. The cursor is opaque to the engine and serialized by the provider.

No remote metadata files are stored in the repository. No local base files are stored on disk -- merge bases are fetched on-demand from git when concurrent edits require three-way merge.

## Platform Adaptations

The platform abstractions (`FileSystem`, `HttpClient`) isolate consumers from environment differences:

| Abstraction | Obsidian Plugin | CLI |
|-------------|----------------|-----|
| `FileSystem` | `Vault` / `vault.adapter` -- unified across Electron, iOS sandbox, Android storage | Node.js `fs` module |
| `HttpClient` | `requestUrl()` -- bypasses CORS, native HTTP on mobile | `fetch` -- standard Node.js HTTP |
| Sync trigger | `document.visibilitychange` on mobile, polling on desktop | Manual invocation or cron |

No conditional imports or platform-specific code paths exist in the core or provider packages.
