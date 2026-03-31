---
name: obsidian-plugin-test
description: >
  Obsidian plugin testing patterns and strategies. TRIGGER when: writing tests for
  Obsidian plugins, setting up test infrastructure (vitest/jest), mocking the Obsidian
  API, writing unit tests for plugin logic, or when the user asks about testing
  strategies for Obsidian plugins. Also triggers when reviewing test coverage or
  test architecture for Obsidian plugin code.
user-invocable: false
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
  - Agent
---

# Obsidian Plugin Testing

## Strategy

The Obsidian API is not available outside the app runtime. Testing strategy:

| Layer | Testable? | Approach |
|-------|-----------|----------|
| Pure logic (reconciler, hash, merge) | Directly | Standard unit tests — no mocks needed |
| Vault operations (scanner, applier) | With mocks | Thin mock of `Vault` interface |
| HTTP/API (provider) | With mocks | Mock `requestUrl` responses |
| UI (modals, settings, views) | Manual only | Test in Obsidian directly |
| Integration (full sync cycle) | With mocks | Mock Vault + requestUrl, test full flow |

**Principle:** Maximize pure logic, minimize Obsidian API surface. The more code you can write as pure functions on plain types, the more you can test without mocks.

## Setup with Vitest

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      obsidian: "./test/mocks/obsidian.ts",
    },
  },
});
```

```json
// package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

## Mocking the Obsidian API

See [obsidian-mocks.md](references/obsidian-mocks.md) for complete mock implementations including:
- Vault mock (files as in-memory Map)
- requestUrl mock for HTTP testing
- Notice/Modal stubs
- Plugin lifecycle simulation

### Minimal Vault Mock

```typescript
// test/mocks/obsidian.ts
export class TFile {
  path: string;
  stat: { mtime: number; ctime: number; size: number };
  constructor(path: string, mtime = Date.now()) {
    this.path = path;
    this.stat = { mtime, ctime: mtime, size: 0 };
  }
}

export class MockVault {
  private files = new Map<string, string | ArrayBuffer>();

  getFiles(): TFile[] {
    return [...this.files.keys()].map((p) => new TFile(p));
  }

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) as string;
  }

  async create(path: string, data: string): Promise<TFile> {
    this.files.set(path, data);
    return new TFile(path);
  }

  async modify(file: TFile, data: string): Promise<void> {
    this.files.set(file.path, data);
  }

  async delete(file: TFile): Promise<void> {
    this.files.delete(file.path);
  }

  getFileByPath(path: string): TFile | null {
    return this.files.has(path) ? new TFile(path) : null;
  }

  // Seed files for tests
  seed(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, content);
    }
  }
}
```

## Test Patterns

### Pure Logic Tests (No Mocks)

```typescript
// test/core/reconciler.test.ts
import { describe, it, expect } from "vitest";
import { reconcile } from "../../src/core/reconciler";

describe("reconcile", () => {
  it("pushes local edits when remote unchanged", () => {
    const local = { added: new Map(), modified: new Map([["a.md", { type: "text", content: "new" }]]), deleted: [] };
    const remote = { added: new Map(), modified: new Map(), deleted: [] };
    const mutations = reconcile(local, remote);
    expect(mutations).toContainEqual(
      expect.objectContaining({ path: "a.md", disk: "skip", remote: "write" })
    );
  });
});
```

### Vault-Dependent Tests

```typescript
// test/vault/scanner.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { MockVault } from "../mocks/obsidian";
import { scan } from "../../src/vault/scanner";

describe("scanner", () => {
  let vault: MockVault;

  beforeEach(() => {
    vault = new MockVault();
    vault.seed({
      "notes/hello.md": "# Hello",
      "notes/world.md": "# World",
    });
  });

  it("detects new files not in snapshot", async () => {
    const result = await scan(vault as any, {}, 0);
    expect(result.added.size).toBe(2);
    expect(result.added.has("notes/hello.md")).toBe(true);
  });
});
```

### HTTP Mock Tests

```typescript
// test/provider/github-provider.test.ts
import { describe, it, expect, vi } from "vitest";
import { GitHubProvider } from "../../src/provider/github-provider";

// Mock requestUrl at module level
vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
}));

import { requestUrl } from "obsidian";

describe("GitHubProvider", () => {
  it("fetches remote snapshot", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce({ status: 200, json: { commit: { sha: "abc" } }, headers: {} })
      .mockResolvedValueOnce({ status: 200, json: { content: btoa("{}") }, headers: {} });

    const provider = new GitHubProvider("token", "owner/repo");
    const result = await provider.fetch({});
    expect(result).toBeDefined();
  });
});
```

## Test Organization

```
test/
├── mocks/
│   └── obsidian.ts          # Obsidian API mocks
├── core/
│   ├── reconciler.test.ts   # Pure logic — no mocks
│   ├── snapshot.test.ts     # Pure logic — no mocks
│   └── hash.test.ts         # Pure logic — no mocks
├── vault/
│   ├── scanner.test.ts      # Uses MockVault
│   └── applier.test.ts      # Uses MockVault
├── provider/
│   └── github-provider.test.ts  # Uses requestUrl mock
└── sync/
    └── sync-engine.test.ts  # Integration — MockVault + requestUrl mock
```

## What NOT to Unit Test

- **Settings UI** — test manually in Obsidian
- **Modals and views** — test manually in Obsidian
- **Obsidian lifecycle** — trust the framework
- **CSS/styling** — visual verification only

Focus test effort on: reconciliation logic, snapshot management, scanning, and provider API calls.
