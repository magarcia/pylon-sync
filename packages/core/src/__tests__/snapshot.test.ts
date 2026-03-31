import { describe, it, expect } from "vitest";
import { computeSnapshot } from "../snapshot";
import type { FileMutation, SnapshotEntry } from "../types";

describe("computeSnapshot", () => {
  it("should preserve entries for files with disk=skip and remote=skip", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {
      "notes/existing.md": { hash: "sha256-aaa", mtime: 1000 },
    };
    const mutations: FileMutation[] = [
      { path: "notes/existing.md", disk: "skip", remote: "skip" },
    ];

    const result = computeSnapshot(oldSnapshot, mutations);

    expect(result["notes/existing.md"]).toEqual({ hash: "sha256-aaa", mtime: 1000 });
  });

  it("should update entries for written files with new hash/mtime from the mutation", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {
      "notes/file.md": { hash: "sha256-old", mtime: 1000 },
    };
    const mutations: FileMutation[] = [
      {
        path: "notes/file.md",
        disk: "write",
        remote: "skip",
        hash: "sha256-new",
        modified: 2000,
        content: "updated content",
        source: "local",
      },
    ];

    const result = computeSnapshot(oldSnapshot, mutations);

    expect(result["notes/file.md"]).toEqual({ hash: "sha256-new", mtime: 2000 });
  });

  it("should use Date.now() when mutation has hash but no modified timestamp", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {};
    const before = Date.now();
    const mutations: FileMutation[] = [
      {
        path: "notes/new.md",
        disk: "write",
        remote: "write",
        hash: "sha256-abc",
        content: "new file",
        source: "local",
      },
    ];

    const result = computeSnapshot(oldSnapshot, mutations);
    const after = Date.now();

    expect(result["notes/new.md"]!.hash).toBe("sha256-abc");
    expect(result["notes/new.md"]!.mtime).toBeGreaterThanOrEqual(before);
    expect(result["notes/new.md"]!.mtime).toBeLessThanOrEqual(after);
  });

  it("should remove entries for files deleted on both sides", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {
      "notes/gone.md": { hash: "sha256-old", mtime: 1000 },
    };
    const mutations: FileMutation[] = [
      { path: "notes/gone.md", disk: "delete", remote: "delete" },
    ];

    const result = computeSnapshot(oldSnapshot, mutations);

    expect(result["notes/gone.md"]).toBeUndefined();
  });

  it("should remove entry when disk=delete and remote=skip (remote-initiated delete applied locally)", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {
      "notes/local-deleted.md": { hash: "sha256-old", mtime: 1000 },
    };
    const mutations: FileMutation[] = [
      {
        path: "notes/local-deleted.md",
        disk: "delete",
        remote: "skip",
      },
    ];

    const result = computeSnapshot(oldSnapshot, mutations);

    expect(result["notes/local-deleted.md"]).toBeUndefined();
  });

  it("should remove entry when disk=skip and remote=delete (local-initiated delete propagated to remote)", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {
      "notes/remote-deleted.md": { hash: "sha256-old", mtime: 1000 },
    };
    const mutations: FileMutation[] = [
      {
        path: "notes/remote-deleted.md",
        disk: "skip",
        remote: "delete",
      },
    ];

    const result = computeSnapshot(oldSnapshot, mutations);

    expect(result["notes/remote-deleted.md"]).toBeUndefined();
  });

  it("should add entries for newly created files not in old snapshot", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {};
    const mutations: FileMutation[] = [
      {
        path: "notes/brand-new.md",
        disk: "write",
        remote: "write",
        hash: "sha256-new",
        modified: 5000,
        content: "hello",
        source: "local",
      },
    ];

    const result = computeSnapshot(oldSnapshot, mutations);

    expect(result["notes/brand-new.md"]).toEqual({ hash: "sha256-new", mtime: 5000 });
  });

  it("should handle empty mutations list by returning a copy of old snapshot", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {
      "a.md": { hash: "sha256-a", mtime: 100 },
      "b.md": { hash: "sha256-b", mtime: 200 },
    };

    const result = computeSnapshot(oldSnapshot, []);

    expect(result).toEqual(oldSnapshot);
    // Should be a copy, not the same reference
    expect(result).not.toBe(oldSnapshot);
  });

  it("should handle mutations for files not in old snapshot (new files)", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {
      "existing.md": { hash: "sha256-existing", mtime: 100 },
    };
    const mutations: FileMutation[] = [
      {
        path: "new-from-remote.md",
        disk: "write",
        remote: "skip",
        hash: "sha256-remote",
        modified: 9000,
        content: "from remote",
        source: "remote",
      },
    ];

    const result = computeSnapshot(oldSnapshot, mutations);

    expect(result["existing.md"]).toEqual({ hash: "sha256-existing", mtime: 100 });
    expect(result["new-from-remote.md"]).toEqual({ hash: "sha256-remote", mtime: 9000 });
  });

  it("should preserve the modified field for binary entries", () => {
    const oldSnapshot: Record<string, SnapshotEntry> = {};
    const mutations: FileMutation[] = [
      {
        path: "image.png",
        disk: "write",
        remote: "skip",
        hash: "sha256-img",
        modified: 7000,
        binaryContent: new ArrayBuffer(8),
      },
    ];

    const result = computeSnapshot(oldSnapshot, mutations);

    expect(result["image.png"]).toEqual({ hash: "sha256-img", mtime: 7000 });
  });
});

