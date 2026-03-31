# Creating a New Provider

This guide explains how to implement a sync provider for Pylon Sync.

## Overview

Pylon Sync uses a provider-agnostic architecture. The core sync engine communicates with remote storage through the `Provider` interface. Each provider implements this interface using whatever API makes sense for its backend.

The existing GitHub provider (`@pylon-sync/provider-github`) serves as the reference implementation. This guide walks through the interface, the cursor model, and the practical steps for building a new provider (using S3 as a running example).

## The Provider Interface

The full interface lives in `@pylon-sync/core` (`packages/core/src/types.ts`):

```typescript
import type {
  Provider,
  SyncCursor,
  FetchResult,
  PushPayload,
  ChangeSet,
  FileState,
} from "@pylon-sync/core";
```

```typescript
export interface Provider {
  fetch(cursor?: SyncCursor, localPaths?: Set<string>): Promise<FetchResult>;
  push(payload: PushPayload, cursor?: SyncCursor): Promise<SyncCursor>;
  bootstrap(): Promise<SyncCursor>;
  getBase?(path: string, cursor: SyncCursor): Promise<string | null>;
}
```

### Method Reference

#### `fetch(cursor?, localPaths?)`

Detects what changed on the remote since the last sync.

| Parameter | Type | Description |
|-----------|------|-------------|
| `cursor` | `SyncCursor` (opaque) | State from the previous sync. `undefined` on first sync. |
| `localPaths` | `Set<string>` | Paths that exist locally. Optimization hint: the provider can skip downloading content for files the caller already has. |

Returns `FetchResult`:

```typescript
interface FetchResult {
  changes: ChangeSet;
  cursor: SyncCursor;
}

interface ChangeSet {
  added: Map<string, FileState>;
  modified: Map<string, FileState>;
  deleted: string[];
}

type FileState =
  | { type: "text"; content: string }
  | { type: "binary"; hash: string; modified: number; data: ArrayBuffer };
```

Use `classifyContent` from `@pylon-sync/core` to build `FileState` values from raw bytes:

```typescript
import { classifyContent } from "@pylon-sync/core";

const state: FileState = await classifyContent(arrayBuffer, Date.now());
```

This inspects the content and returns either a `text` or `binary` file state.

#### `push(payload, cursor?)`

Pushes local changes to the remote.

| Parameter | Type | Description |
|-----------|------|-------------|
| `payload.files` | `Map<string, string \| ArrayBuffer>` | Path-to-content map. Strings for text, ArrayBuffers for binary. |
| `payload.deletions` | `string[]` | Paths to delete on the remote. |
| `cursor` | `SyncCursor` | Cursor from the most recent fetch. |

Returns a new `SyncCursor` reflecting the post-push state.

Throws `PushConflictError` if the remote changed since the last fetch. The engine catches this and retries with a fresh fetch.

```typescript
import { PushConflictError } from "@pylon-sync/core";

if (remoteChangedSinceLastFetch) {
  throw new PushConflictError();
}
```

#### `bootstrap()`

Initializes the remote storage for first-time use. Called once during setup (the CLI's `init` command or the plugin's first sync).

Responsibilities:
- Create any required infrastructure (repo, bucket, directory)
- Return an initial cursor the engine can use for subsequent fetches

#### `getBase?(path, cursor)` (optional)

Fetches the content of a file at the state represented by the cursor.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | File path to retrieve. |
| `cursor` | `SyncCursor` | The cursor representing the point-in-time state. |

Returns the file content as a string, or `null` if the file did not exist at that state.

This method enables three-way merge. When both sides edit the same text file, the engine calls `getBase` to retrieve the common ancestor, then performs a three-way merge using diff-match-patch. If `getBase` is not implemented, the engine falls back to two-way merge (less accurate conflict resolution).

For backends that support version history natively (Git, databases), this is straightforward. For "dumb" backends (S3, WebDAV), you would need to store base copies yourself or omit this method.

## The Opaque Cursor Model

Each provider defines its own cursor shape. The core engine stores cursors (via `PluginData` or CLI's `data.json`) and passes them back on subsequent syncs, but never inspects their contents. The `SyncCursor` type is `unknown`.

This means:
- The cursor must be JSON-serializable (it gets persisted to disk)
- The provider casts the opaque `SyncCursor` to its concrete type internally
- The cursor shape can evolve, but you should handle older cursor formats gracefully

### Example Cursor Shapes

**GitHub provider** (smart backend -- minimal cursor):

```typescript
interface GitHubCursor {
  commitSha: string;
  treeSha: string;
}
```

Git tracks full history, so two SHA strings are enough to detect changes.

**S3 provider** (dumb backend -- manifest cursor):

```typescript
interface S3Cursor {
  snapshot: Record<string, { etag: string; lastModified: string }>;
}
```

S3 has no version history, so the cursor stores a full manifest of known files. On fetch, the provider lists the bucket and diffs against this manifest.

**WebDAV provider** (dumb backend -- manifest cursor):

```typescript
interface WebDAVCursor {
  snapshot: Record<string, { hash: string; lastModified: string }>;
}
```

Same strategy as S3: store a manifest, diff on fetch.

The key insight: "smart" backends (Git, databases) only need a pointer to a version. "Dumb" backends (S3, WebDAV, local filesystem) need to store a full file manifest in the cursor.

## Step-by-Step: Implementing an S3 Provider

### 1. Create the package

```
packages/provider-s3/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── index.ts
    ├── s3-provider.ts
    └── __tests__/
        └── s3-provider.test.ts
```

`package.json`:

```json
{
  "name": "@pylon-sync/provider-s3",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@pylon-sync/core": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^3.1.1",
    "typescript": "^5.8.2"
  }
}
```

### 2. Implement the Provider

```typescript
// src/s3-provider.ts
import type {
  Provider,
  SyncCursor,
  FetchResult,
  PushPayload,
  ChangeSet,
  HttpClient,
} from "@pylon-sync/core";
import { PushConflictError, classifyContent } from "@pylon-sync/core";

interface S3Cursor {
  snapshot: Record<string, { etag: string; lastModified: string }>;
}

interface S3Config {
  bucket: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3Provider implements Provider {
  private config: S3Config;
  private http: HttpClient;

  constructor(config: S3Config, http: HttpClient) {
    this.config = config;
    this.http = http;
  }

  async fetch(cursor?: SyncCursor, localPaths?: Set<string>): Promise<FetchResult> {
    const prev = cursor as S3Cursor | undefined;
    const prevSnapshot = prev?.snapshot ?? {};

    // List all objects in the bucket under our prefix
    const currentObjects = await this.listObjects();

    const changes: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: [],
    };

    // Detect additions and modifications
    for (const [path, meta] of Object.entries(currentObjects)) {
      const prevMeta = prevSnapshot[path];

      if (!prevMeta) {
        // New file on remote
        if (localPaths?.has(path)) continue; // caller already has it
        const content = await this.getObject(path);
        changes.added.set(path, await classifyContent(content, Date.now()));
      } else if (prevMeta.etag !== meta.etag) {
        // Modified on remote
        const content = await this.getObject(path);
        changes.modified.set(path, await classifyContent(content, Date.now()));
      }
    }

    // Detect deletions
    for (const path of Object.keys(prevSnapshot)) {
      if (!(path in currentObjects)) {
        changes.deleted.push(path);
      }
    }

    const newCursor: S3Cursor = { snapshot: currentObjects };
    return { changes, cursor: newCursor };
  }

  async push(payload: PushPayload, cursor?: SyncCursor): Promise<SyncCursor> {
    const prev = cursor as S3Cursor | undefined;

    // Conflict check: verify remote hasn't changed since our last fetch
    if (prev) {
      const currentObjects = await this.listObjects();
      for (const [path, meta] of Object.entries(currentObjects)) {
        const prevMeta = prev.snapshot[path];
        if (prevMeta && prevMeta.etag !== meta.etag) {
          throw new PushConflictError();
        }
      }
    }

    // Upload files
    for (const [path, content] of payload.files) {
      const body = typeof content === "string"
        ? content
        : this.arrayBufferToString(content);
      await this.putObject(path, body);
    }

    // Delete files
    for (const path of payload.deletions) {
      await this.deleteObject(path);
    }

    // Build new cursor from current state
    const snapshot = await this.listObjects();
    return { snapshot } satisfies S3Cursor;
  }

  async bootstrap(): Promise<SyncCursor> {
    // For S3, the bucket must already exist (or create it here).
    // Return an empty cursor -- first fetch will treat all remote files as added.
    return { snapshot: {} } satisfies S3Cursor;
  }

  // S3 has no version history, so getBase is not implemented.
  // The engine will fall back to two-way merge.

  // --- Private helpers (not shown in full) ---

  private async listObjects(): Promise<Record<string, { etag: string; lastModified: string }>> {
    // GET /?list-type=2&prefix=... against the S3 endpoint
    // Parse XML response into a path -> { etag, lastModified } map
    // Implementation depends on your S3 signing logic
    throw new Error("Not implemented");
  }

  private async getObject(path: string): Promise<ArrayBuffer> {
    // GET /path against the S3 endpoint
    throw new Error("Not implemented");
  }

  private async putObject(path: string, body: string): Promise<void> {
    // PUT /path against the S3 endpoint
    throw new Error("Not implemented");
  }

  private async deleteObject(path: string): Promise<void> {
    // DELETE /path against the S3 endpoint
    throw new Error("Not implemented");
  }

  private arrayBufferToString(buffer: ArrayBuffer): string {
    return new TextDecoder().decode(buffer);
  }
}
```

### 3. Export from the barrel file

```typescript
// src/index.ts
export { S3Provider } from "./s3-provider";
```

### 4. Wire it into the sync engine

The provider is injected into `SyncEngine` via its constructor. Both the CLI and the Obsidian plugin create a provider instance and pass it in:

```typescript
import { SyncEngine } from "@pylon-sync/core";
import { S3Provider } from "@pylon-sync/provider-s3";

const provider = new S3Provider(config, httpClient);
const engine = new SyncEngine(provider, fileSystem, callbacks);
```

### 5. Register with the CLI

Add a provider selection to the `init` command so users can choose between GitHub, S3, etc. The config shape in `.pylon/config.json` would need a `provider` field:

```json
{
  "provider": "s3",
  "bucket": "my-vault-backup",
  "region": "us-east-1",
  "prefix": "vault/"
}
```

## HttpClient

Providers must accept an `HttpClient` for all HTTP operations:

```typescript
interface HttpClient {
  request(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<HttpResponse>;
}

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
}
```

This abstraction exists because Obsidian and Node.js have different HTTP APIs:
- **Obsidian**: `requestUrl` (the only allowed HTTP API in plugins)
- **Node.js (CLI)**: `fetch`

By coding against `HttpClient`, the same provider works in both environments without modification.

The GitHub provider wraps `HttpClient` in a `GitHubApi` class that adds authentication headers and retry logic. Your provider can do the same or use `HttpClient` directly.

### Retry logic

Implement retry/backoff in an HTTP wrapper layer, not in the provider methods themselves. This keeps the provider logic focused on the sync protocol. See `packages/provider-github/src/github-api.ts` for the retry pattern used in the GitHub provider.

## Testing

Mock the `HttpClient` to unit test your provider without hitting real APIs:

```typescript
import { describe, it, expect, vi } from "vitest";
import { S3Provider } from "../s3-provider";
import type { HttpClient, HttpResponse } from "@pylon-sync/core";

function mockHttp(responses: Map<string, Partial<HttpResponse>>): HttpClient {
  return {
    request: vi.fn(async ({ url }) => {
      const response = responses.get(url);
      if (!response) throw new Error(`Unexpected request: ${url}`);
      return {
        status: 200,
        headers: {},
        json: null,
        text: "",
        arrayBuffer: new ArrayBuffer(0),
        ...response,
      };
    }),
  };
}

describe("S3Provider", () => {
  it("should treat all remote files as added on first fetch", async () => {
    const http = mockHttp(new Map([
      // ... mock S3 ListObjects and GetObject responses
    ]));
    const provider = new S3Provider(config, http);
    const result = await provider.fetch(undefined);

    expect(result.changes.added.size).toBe(2);
    expect(result.changes.modified.size).toBe(0);
    expect(result.changes.deleted).toEqual([]);
  });

  it("should detect modifications by comparing ETags", async () => {
    // ... test with a previous cursor containing known ETags
  });

  it("should throw PushConflictError when remote changed since fetch", async () => {
    // ... test that push detects divergent ETags
  });
});
```

### What to test

- **First fetch** (no cursor): all remote files appear as `added`
- **Incremental fetch**: only changed files appear as `modified`, removed files as `deleted`
- **Push**: files uploaded, deletions applied, new cursor returned
- **Conflict detection**: `PushConflictError` thrown when remote diverged
- **Bootstrap**: infrastructure created, initial cursor returned
- **Edge cases**: empty remote, cursor from an older format, network errors

## Error Handling

| Situation | What to do |
|-----------|-----------|
| Remote changed between fetch and push | Throw `PushConflictError` |
| Network/auth errors | Let them propagate -- the engine wraps them in `SyncResult.error` |
| Rate limiting (429) | Handle in your HTTP wrapper with exponential backoff |
| Invalid configuration | Throw in the constructor with a descriptive message |

Do not catch and swallow errors in the provider. The engine needs to see them to report status to the user.

## Checklist

Before submitting a new provider:

- [ ] Implements all required `Provider` methods (`fetch`, `push`, `bootstrap`)
- [ ] Uses `HttpClient` for all HTTP operations (no direct `fetch` or `requestUrl`)
- [ ] Cursor is JSON-serializable
- [ ] `PushConflictError` thrown on remote divergence during push
- [ ] Uses `classifyContent` to build `FileState` values
- [ ] Unit tests cover first fetch, incremental fetch, push, conflict detection
- [ ] No tokens logged or included in error messages
- [ ] Path validation rejects traversal attempts (`..`, absolute paths, null bytes)
- [ ] Works in both Obsidian (requestUrl) and Node.js (fetch) via HttpClient
