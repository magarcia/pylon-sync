import { describe, it, expect, beforeEach } from "vitest";
import { MockFileSystem } from "./mock-fs";
import { scan, readFileState } from "../scanner";
import { hashText, hashBuffer } from "../hash";
import type { SnapshotEntry, SyncSettings } from "../types";
import { DEFAULT_SYNC_SETTINGS } from "../types";

let fs: MockFileSystem;

beforeEach(() => {
  fs = new MockFileSystem();
});

describe("scan", () => {
  const defaultSettings: SyncSettings = { ...DEFAULT_SYNC_SETTINGS };

  it("should detect added files (in vault, not in snapshot)", async () => {
    fs.seed({ "notes/a.md": "hello", "notes/b.md": "world" }, 1000);
    const snapshot: Record<string, SnapshotEntry> = {};

    const result = await scan(fs, snapshot, 0, false, defaultSettings);

    expect(result.added.size).toBe(2);
    expect(result.added.has("notes/a.md")).toBe(true);
    expect(result.added.has("notes/b.md")).toBe(true);
    expect(result.modified.size).toBe(0);
    expect(result.deleted).toEqual([]);
  });

  it("should detect modified files (hash changed since snapshot)", async () => {
    const oldHash = await hashText("old content");
    fs.seed({ "notes/a.md": "new content" }, 2000);
    const snapshot: Record<string, SnapshotEntry> = {
      "notes/a.md": { hash: oldHash, mtime: 1000 },
    };

    const result = await scan(fs, snapshot, 0, true, defaultSettings);

    expect(result.modified.size).toBe(1);
    expect(result.modified.has("notes/a.md")).toBe(true);
    const state = result.modified.get("notes/a.md")!;
    expect(state.type).toBe("text");
    if (state.type === "text") {
      expect(state.content).toBe("new content");
    }
  });

  it("should detect deleted files (in snapshot, not in vault)", async () => {
    const snapshot: Record<string, SnapshotEntry> = {
      "notes/gone.md": { hash: "sha256-abc", mtime: 1000 },
    };

    const result = await scan(fs, snapshot, 0, false, defaultSettings);

    expect(result.deleted).toEqual(["notes/gone.md"]);
    expect(result.added.size).toBe(0);
    expect(result.modified.size).toBe(0);
  });

  it("should skip files with mtime <= lastSyncTime (mtime pre-filter)", async () => {
    const hash = await hashText("unchanged");
    fs.seed({ "notes/a.md": "unchanged" }, 1000);
    const snapshot: Record<string, SnapshotEntry> = {
      "notes/a.md": { hash, mtime: 1000 },
    };

    const result = await scan(fs, snapshot, 2000, false, defaultSettings);

    expect(result.modified.size).toBe(0);
    expect(result.added.size).toBe(0);
  });

  it("should read and hash files with mtime > lastSyncTime", async () => {
    const oldHash = await hashText("old");
    fs.seed({ "notes/a.md": "updated" }, 3000);
    const snapshot: Record<string, SnapshotEntry> = {
      "notes/a.md": { hash: oldHash, mtime: 1000 },
    };

    const result = await scan(fs, snapshot, 2000, false, defaultSettings);

    expect(result.modified.size).toBe(1);
    expect(result.modified.has("notes/a.md")).toBe(true);
  });

  it("should read all files when forceFullScan is true (ignoring mtime)", async () => {
    const oldHash = await hashText("old");
    fs.seed({ "notes/a.md": "changed" }, 500);
    const snapshot: Record<string, SnapshotEntry> = {
      "notes/a.md": { hash: oldHash, mtime: 500 },
    };

    const result = await scan(fs, snapshot, 2000, true, defaultSettings);

    expect(result.modified.size).toBe(1);
    expect(result.modified.has("notes/a.md")).toBe(true);
  });

  it("should filter out untracked paths (dotfiles, .obsidian/, etc.)", async () => {
    fs.seed(
      {
        "notes/a.md": "tracked",
        ".obsidian/config.json": "settings",
        ".hidden": "dotfile",
        ".trash/deleted.md": "trash",
      },
      1000,
    );
    const snapshot: Record<string, SnapshotEntry> = {};

    const result = await scan(fs, snapshot, 0, false, defaultSettings);

    expect(result.added.size).toBe(1);
    expect(result.added.has("notes/a.md")).toBe(true);
  });

  it("should handle empty vault (no files)", async () => {
    const snapshot: Record<string, SnapshotEntry> = {
      "notes/a.md": { hash: "sha256-abc", mtime: 1000 },
    };

    const result = await scan(fs, snapshot, 0, false, defaultSettings);

    expect(result.added.size).toBe(0);
    expect(result.modified.size).toBe(0);
    expect(result.deleted).toEqual(["notes/a.md"]);
  });

  it("should handle empty snapshot (all files are added)", async () => {
    fs.seed(
      {
        "notes/a.md": "one",
        "notes/b.md": "two",
        "notes/c.md": "three",
      },
      1000,
    );
    const snapshot: Record<string, SnapshotEntry> = {};

    const result = await scan(fs, snapshot, 0, false, defaultSettings);

    expect(result.added.size).toBe(3);
    expect(result.modified.size).toBe(0);
    expect(result.deleted).toEqual([]);
  });

  it("should include dot-directory files when listed in includePaths", async () => {
    fs.seed(
      {
        "notes/a.md": "tracked",
        ".claude/CLAUDE.md": "rules",
        ".git/config": "git config",
      },
      1000,
    );
    const snapshot: Record<string, SnapshotEntry> = {};

    const result = await scan(fs, snapshot, 0, false, { ...defaultSettings, includePaths: [".claude"] });

    expect(result.added.size).toBe(2);
    expect(result.added.has("notes/a.md")).toBe(true);
    expect(result.added.has(".claude/CLAUDE.md")).toBe(true);
    expect(result.added.has(".git/config")).toBe(false);
  });
});

describe("readFileState", () => {
  it("should return text FileState for UTF-8 string content", async () => {
    fs.seed({ "notes/hello.md": "hello world" }, 1000);

    const state = await readFileState(fs, { path: "notes/hello.md", mtime: 1000, size: 11 });

    expect(state.type).toBe("text");
    if (state.type === "text") {
      expect(state.content).toBe("hello world");
    }
  });

  it("should return binary FileState for binary content (non-UTF-8 ArrayBuffer)", async () => {
    const buf = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0xc0, 0xc1]).buffer;
    fs.seed({ "images/photo.png": buf }, 2000);

    const state = await readFileState(fs, { path: "images/photo.png", mtime: 2000, size: 6 });

    expect(state.type).toBe("binary");
    if (state.type === "binary") {
      const expectedHash = await hashBuffer(buf);
      expect(state.hash).toBe(expectedHash);
      expect(state.modified).toBe(2000);
      expect(state.data).toBe(buf);
    }
  });
});
