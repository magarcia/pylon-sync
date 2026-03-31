import { vi, describe, it, expect, beforeEach } from "vitest";
import type {
  ChangeSet,
  FileMutation,
  PluginData,
  SyncSettings,
  Provider,
  FetchResult,
  SyncCursor,
  FileSystem,
} from "../types";
import { PushConflictError, ProviderError, DEFAULT_SYNC_SETTINGS } from "../types";

vi.mock("../scanner", () => ({
  scan: vi.fn(),
}));
vi.mock("../applier", () => ({
  applyMutations: vi.fn(),
}));
vi.mock("../reconciler", () => ({
  reconcile: vi.fn(),
}));
vi.mock("../snapshot", () => ({
  computeSnapshot: vi.fn(),
}));
vi.mock("../hash", () => ({
  hashText: vi.fn((content: string) => Promise.resolve(`sha256-${content}`)),
}));

import { scan } from "../scanner";
import { applyMutations } from "../applier";
import { reconcile } from "../reconciler";
import { computeSnapshot } from "../snapshot";
import { hashText } from "../hash";
import { SyncEngine } from "../sync-engine";

const mockScan = vi.mocked(scan);
const mockApplyMutations = vi.mocked(applyMutations);
const mockReconcile = vi.mocked(reconcile);
const mockComputeSnapshot = vi.mocked(computeSnapshot);
const mockHashText = vi.mocked(hashText);

function createMockProvider(): {
  fetch: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
  bootstrap: ReturnType<typeof vi.fn>;
  getBase: ReturnType<typeof vi.fn>;
} {
  return {
    fetch: vi.fn(),
    push: vi.fn(),
    bootstrap: vi.fn(),
    getBase: vi.fn(),
  };
}

function emptyChangeSet(): ChangeSet {
  return { added: new Map(), modified: new Map(), deleted: [] };
}

function createSettings(overrides?: Partial<SyncSettings>): SyncSettings {
  return {
    ...DEFAULT_SYNC_SETTINGS,
    githubRepo: "owner/repo",
    ...overrides,
  };
}

function createPluginData(overrides?: Partial<PluginData>): PluginData {
  return {
    snapshot: {},
    lastSyncTime: 0,
    syncCount: 1,
    cursor: undefined,
    ...overrides,
  };
}

function createCallbacks() {
  return {
    onSaveData: vi.fn().mockResolvedValue(undefined),
  };
}

describe("SyncEngine", () => {
  const fs = {} as FileSystem;
  let provider: ReturnType<typeof createMockProvider>;
  let settings: SyncSettings;
  let pluginData: PluginData;
  let callbacks: ReturnType<typeof createCallbacks>;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = createMockProvider();
    settings = createSettings();
    pluginData = createPluginData();
    callbacks = createCallbacks();

    mockScan.mockResolvedValue(emptyChangeSet());
    provider.fetch.mockResolvedValue({
      changes: emptyChangeSet(),
      cursor: "cursor-abc",
    } satisfies FetchResult);
    mockReconcile.mockReturnValue([]);
    mockComputeSnapshot.mockReturnValue({});
    mockApplyMutations.mockResolvedValue(undefined);
    provider.push.mockResolvedValue("cursor-new");
    provider.bootstrap.mockResolvedValue("cursor-bootstrap");
    provider.getBase.mockResolvedValue(null);
  });

  it('should return { status: "no-changes" } when nothing changed locally or remotely', async () => {
    const engine = new SyncEngine(
      fs,
      provider as unknown as Provider,
      settings,
      pluginData,
      callbacks,
    );

    const result = await engine.sync();

    expect(result.status).toBe("no-changes");
    expect(result.mutations).toEqual([]);
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(provider.push).not.toHaveBeenCalled();
  });

  it("should push local-only changes to remote", async () => {
    const localChanges: ChangeSet = {
      added: new Map([
        ["notes/new.md", { type: "text", content: "hello" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);

    const mutations: FileMutation[] = [
      {
        path: "notes/new.md",
        disk: "skip",
        remote: "write",
        content: "hello",
        source: "local",
        hash: "sha256-hello",
      },
    ];
    mockReconcile.mockReturnValue(mutations);

    const newSnapshot = { "notes/new.md": { hash: "sha256-hello", mtime: 1000 } };
    mockComputeSnapshot.mockReturnValue(newSnapshot);

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    const result = await engine.sync();

    expect(result.status).toBe("success");
    expect(result.mutations).toBe(mutations);
    expect(provider.push).toHaveBeenCalledOnce();
    expect(provider.push).toHaveBeenCalledWith(
      { files: expect.any(Map), deletions: [] },
      "cursor-abc",
    );
    expect(mockApplyMutations).toHaveBeenCalledWith(fs, mutations);
  });

  it("should pull remote-only changes to local", async () => {
    const remoteChanges: ChangeSet = {
      added: new Map([
        ["notes/remote.md", { type: "text", content: "remote content" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    provider.fetch.mockResolvedValue({
      changes: remoteChanges,
      cursor: "cursor-abc",
    } satisfies FetchResult);

    const mutations: FileMutation[] = [
      {
        path: "notes/remote.md",
        disk: "write",
        remote: "skip",
        content: "remote content",
        source: "remote",
        hash: "sha256-remote",
      },
    ];
    mockReconcile.mockReturnValue(mutations);
    mockComputeSnapshot.mockReturnValue({
      "notes/remote.md": { hash: "sha256-remote", mtime: 2000 },
    });

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    const result = await engine.sync();

    expect(result.status).toBe("success");
    expect(result.mutations).toBe(mutations);
    expect(mockApplyMutations).toHaveBeenCalledWith(fs, mutations);
  });

  it("should merge concurrent text changes", async () => {
    const localChanges: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/shared.md", { type: "text", content: "A\nB-local\nC" }],
      ]),
      deleted: [],
    };
    const remoteChanges: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/shared.md", { type: "text", content: "A\nB\nC-remote" }],
      ]),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);
    provider.fetch.mockResolvedValue({
      changes: remoteChanges,
      cursor: "cursor-abc",
    } satisfies FetchResult);

    const mutations: FileMutation[] = [
      {
        path: "notes/shared.md",
        disk: "write",
        remote: "write",
        content: "A\nB-local\nC-remote",
        source: "merged",
        hash: "sha256-merged",
      },
    ];
    mockReconcile.mockReturnValue(mutations);
    mockComputeSnapshot.mockReturnValue({
      "notes/shared.md": { hash: "sha256-merged", mtime: 3000 },
    });

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    const result = await engine.sync();

    expect(result.status).toBe("success");
    expect(result.mutations).toBe(mutations);
    expect(provider.push).toHaveBeenCalledOnce();
    expect(mockApplyMutations).toHaveBeenCalledWith(fs, mutations);
  });

  it("should retry on PushConflictError up to 5 times", async () => {
    const localChanges: ChangeSet = {
      added: new Map([
        ["notes/file.md", { type: "text", content: "content" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);

    const mutations: FileMutation[] = [
      {
        path: "notes/file.md",
        disk: "skip",
        remote: "write",
        content: "content",
        source: "local",
        hash: "sha256-c",
      },
    ];
    mockReconcile.mockReturnValue(mutations);
    mockComputeSnapshot.mockReturnValue({
      "notes/file.md": { hash: "sha256-c", mtime: 1000 },
    });

    provider.push
      .mockRejectedValueOnce(new PushConflictError())
      .mockRejectedValueOnce(new PushConflictError())
      .mockRejectedValueOnce(new PushConflictError())
      .mockRejectedValueOnce(new PushConflictError())
      .mockResolvedValueOnce("cursor-retry");

    provider.fetch.mockResolvedValue({
      changes: emptyChangeSet(),
      cursor: "cursor-refreshed",
    } satisfies FetchResult);

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    const result = await engine.sync();

    expect(result.status).toBe("success");
    // 1 initial fetch + 4 retry fetches
    expect(provider.fetch).toHaveBeenCalledTimes(5);
    expect(provider.push).toHaveBeenCalledTimes(5);
  });

  it("should return error result on ProviderError", async () => {
    const apiError = new ProviderError("API_ERROR", "Not found");
    provider.fetch.mockRejectedValue(apiError);

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    const result = await engine.sync();

    expect(result.status).toBe("error");
    expect(result.error).toBe(apiError);
    expect(result.mutations).toEqual([]);
  });

  it("should return early if already syncing", async () => {
    let resolveScan!: (value: ChangeSet) => void;
    mockScan.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);

    const firstSync = engine.sync();
    expect(engine.isSyncing).toBe(true);

    const secondResult = await engine.sync();
    expect(secondResult.status).toBe("no-changes");
    expect(secondResult.mutations).toEqual([]);

    resolveScan(emptyChangeSet());
    await firstSync;
    expect(engine.isSyncing).toBe(false);
  });

  it("should save snapshot and cursor after successful sync via onSaveData callback", async () => {
    const localChanges: ChangeSet = {
      added: new Map([
        ["notes/a.md", { type: "text", content: "a" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);

    const mutations: FileMutation[] = [
      {
        path: "notes/a.md",
        disk: "skip",
        remote: "write",
        content: "a",
        source: "local",
        hash: "sha256-a",
      },
    ];
    mockReconcile.mockReturnValue(mutations);

    const newSnapshot = { "notes/a.md": { hash: "sha256-a", mtime: 1000 } };
    mockComputeSnapshot.mockReturnValue(newSnapshot);

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    expect(callbacks.onSaveData).toHaveBeenCalledOnce();
    const savedData = callbacks.onSaveData.mock.calls[0]![0];
    expect(savedData.snapshot).toBe(newSnapshot);
    expect(savedData.cursor).toBe("cursor-new");
  });

  it("should increment syncCount after successful sync", async () => {
    pluginData.syncCount = 5;

    const localChanges: ChangeSet = {
      added: new Map([
        ["notes/c.md", { type: "text", content: "c" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);
    mockReconcile.mockReturnValue([
      {
        path: "notes/c.md",
        disk: "skip",
        remote: "write",
        content: "c",
        source: "local",
        hash: "sha256-c",
      },
    ]);
    mockComputeSnapshot.mockReturnValue({});

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    const savedData = callbacks.onSaveData.mock.calls[0]![0];
    expect(savedData.syncCount).toBe(6);
  });

  it("should trigger full scan when syncCount % fullScanInterval === 0", async () => {
    pluginData.syncCount = 10;
    settings.fullScanInterval = 10;

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    expect(mockScan).toHaveBeenCalledWith(
      fs,
      pluginData.snapshot,
      pluginData.lastSyncTime,
      true,
      settings.ignorePatterns,
      settings.syncObsidianSettings,
    );
  });

  it("should call bootstrap when provider.fetch returns null cursor", async () => {
    provider.fetch
      .mockResolvedValueOnce({
        changes: emptyChangeSet(),
        cursor: null,
      })
      .mockResolvedValueOnce({
        changes: emptyChangeSet(),
        cursor: "cursor-after-bootstrap",
      });

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    expect(provider.bootstrap).toHaveBeenCalledOnce();
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it("should pass cursor to provider.fetch", async () => {
    pluginData.cursor = "prev-cursor";

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    expect(provider.fetch).toHaveBeenCalledWith("prev-cursor", expect.any(Set));
  });

  it("should fetch merge base from provider for concurrent edits", async () => {
    pluginData.cursor = "base-cursor";

    const localChanges: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/shared.md", { type: "text", content: "local version" }],
      ]),
      deleted: [],
    };
    const remoteChanges: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/shared.md", { type: "text", content: "remote version" }],
      ]),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);
    provider.fetch.mockResolvedValue({
      changes: remoteChanges,
      cursor: "cursor-head",
    } satisfies FetchResult);
    provider.getBase.mockResolvedValue("base version");

    const mutations: FileMutation[] = [
      {
        path: "notes/shared.md",
        disk: "write",
        remote: "write",
        content: "merged",
        source: "merged",
        hash: "sha256-merged",
      },
    ];
    mockReconcile.mockReturnValue(mutations);
    mockComputeSnapshot.mockReturnValue({});

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    expect(provider.getBase).toHaveBeenCalledWith(
      "notes/shared.md",
      "base-cursor",
    );
    expect(mockReconcile).toHaveBeenCalledWith(
      localChanges,
      remoteChanges,
      { "notes/shared.md": "base version" },
      settings.binaryConflict,
    );
  });

  it("should fetch merge base for concurrent adds", async () => {
    pluginData.cursor = "base-cursor";

    const localChanges: ChangeSet = {
      added: new Map([
        ["notes/both-added.md", { type: "text", content: "local" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    const remoteChanges: ChangeSet = {
      added: new Map([
        ["notes/both-added.md", { type: "text", content: "remote" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);
    provider.fetch.mockResolvedValue({
      changes: remoteChanges,
      cursor: "cursor-head",
    } satisfies FetchResult);
    provider.getBase.mockResolvedValue(null);

    mockReconcile.mockReturnValue([]);
    mockComputeSnapshot.mockReturnValue({});

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    expect(provider.getBase).toHaveBeenCalledWith(
      "notes/both-added.md",
      "base-cursor",
    );
    expect(mockReconcile).toHaveBeenCalledWith(
      localChanges,
      remoteChanges,
      {},
      settings.binaryConflict,
    );
  });

  it("should not fetch merge bases when cursor is undefined", async () => {
    pluginData.cursor = undefined;

    const localChanges: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/file.md", { type: "text", content: "local" }],
      ]),
      deleted: [],
    };
    const remoteChanges: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/file.md", { type: "text", content: "remote" }],
      ]),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);
    provider.fetch.mockResolvedValue({
      changes: remoteChanges,
      cursor: "cursor-head",
    } satisfies FetchResult);
    mockReconcile.mockReturnValue([]);
    mockComputeSnapshot.mockReturnValue({});

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    expect(provider.getBase).not.toHaveBeenCalled();
    expect(mockReconcile).toHaveBeenCalledWith(
      localChanges,
      remoteChanges,
      {},
      settings.binaryConflict,
    );
  });

  it("should not include snapshot in push payload", async () => {
    const localChanges: ChangeSet = {
      added: new Map([
        ["notes/new.md", { type: "text", content: "hello" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);

    const mutations: FileMutation[] = [
      {
        path: "notes/new.md",
        disk: "skip",
        remote: "write",
        content: "hello",
        source: "local",
        hash: "sha256-hello",
      },
    ];
    mockReconcile.mockReturnValue(mutations);
    mockComputeSnapshot.mockReturnValue({});

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    const pushPayload = provider.push.mock.calls[0]![0];
    expect(pushPayload).toHaveProperty("files");
    expect(pushPayload).toHaveProperty("deletions");
    expect(pushPayload).not.toHaveProperty("snapshot");
  });

  it("should compute hashes for text mutations that lack them before building snapshot", async () => {
    const localChanges: ChangeSet = {
      added: new Map([
        ["notes/new.md", { type: "text", content: "hello" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);

    const textMutation: FileMutation = {
      path: "notes/new.md",
      disk: "skip",
      remote: "write",
      content: "hello",
      source: "local",
    };
    mockReconcile.mockReturnValue([textMutation]);
    mockComputeSnapshot.mockReturnValue({
      "notes/new.md": { hash: "sha256-hello", mtime: 1000 },
    });

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    // hashText should have been called for the text mutation
    expect(mockHashText).toHaveBeenCalledWith("hello");
    // The mutation should now have a hash set
    expect(textMutation.hash).toBe("sha256-hello");
  });

  it("should apply mutations before saving snapshot", async () => {
    const localChanges: ChangeSet = {
      added: new Map([
        ["notes/a.md", { type: "text", content: "a" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    mockScan.mockResolvedValue(localChanges);

    const mutations: FileMutation[] = [
      {
        path: "notes/a.md",
        disk: "skip",
        remote: "write",
        content: "a",
        source: "local",
        hash: "sha256-a",
      },
    ];
    mockReconcile.mockReturnValue(mutations);
    mockComputeSnapshot.mockReturnValue({});

    const callOrder: string[] = [];
    mockApplyMutations.mockImplementation(async () => {
      callOrder.push("applyMutations");
    });
    callbacks.onSaveData.mockImplementation(async () => {
      callOrder.push("onSaveData");
    });

    const engine = new SyncEngine(fs, provider as unknown as Provider, settings, pluginData, callbacks);
    await engine.sync();

    expect(callOrder).toEqual(["applyMutations", "onSaveData"]);
  });
});
