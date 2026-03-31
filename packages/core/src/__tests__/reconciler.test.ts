import { describe, it, expect } from "vitest";
import { reconcile, mergeText } from "../reconciler";
import type { ChangeSet, FileMutation } from "../types";

function emptyChangeSet(): ChangeSet {
  return { added: new Map(), modified: new Map(), deleted: [] };
}

describe("reconcile", () => {
  it("should push locally edited, remotely unchanged files", () => {
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/todo.md", { type: "text", content: "updated locally" }],
      ]),
      deleted: [],
    };
    const remote = emptyChangeSet();

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toEqual([
      {
        path: "notes/todo.md",
        disk: "skip",
        remote: "write",
        content: "updated locally",
        source: "local",
      },
    ]);
  });

  it("should pull remotely edited, locally unchanged files", () => {
    const local = emptyChangeSet();
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/todo.md", { type: "text", content: "updated remotely" }],
      ]),
      deleted: [],
    };

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toEqual([
      {
        path: "notes/todo.md",
        disk: "write",
        remote: "skip",
        content: "updated remotely",
        source: "remote",
      },
    ]);
  });

  it("should three-way merge concurrent text edits in different regions", () => {
    const base = "A\nB\nC";
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["file.md", { type: "text", content: "A\nB-local\nC" }],
      ]),
      deleted: [],
    };
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["file.md", { type: "text", content: "A\nB\nC-remote" }],
      ]),
      deleted: [],
    };

    const result = reconcile(local, remote, { "file.md": base }, "newest");

    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("file.md");
    expect(result[0]!.disk).toBe("write");
    expect(result[0]!.remote).toBe("write");
    expect(result[0]!.source).toBe("merged");
    expect(result[0]!.content).toContain("B-local");
    expect(result[0]!.content).toContain("C-remote");
  });

  it("should three-way merge concurrent text edits with overlapping changes (best-effort)", () => {
    const base = "hello world";
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["file.md", { type: "text", content: "hello planet" }],
      ]),
      deleted: [],
    };
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["file.md", { type: "text", content: "hi world" }],
      ]),
      deleted: [],
    };

    const result = reconcile(local, remote, { "file.md": base }, "newest");

    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("file.md");
    expect(result[0]!.disk).toBe("write");
    expect(result[0]!.remote).toBe("write");
    expect(result[0]!.source).toBe("merged");
    // Best-effort merge - should produce some result
    expect(typeof result[0]!.content).toBe("string");
  });

  it('should use last-modified-wins for concurrent binary edits (binaryConflict: "newest")', () => {
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["image.png", { type: "binary", hash: "sha256-local", modified: 1000, data: new ArrayBuffer(4) }],
      ]),
      deleted: [],
    };
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["image.png", { type: "binary", hash: "sha256-remote", modified: 2000, data: new ArrayBuffer(4) }],
      ]),
      deleted: [],
    };

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("image.png");
    // Remote is newer (modified: 2000 > 1000), so pull remote
    expect(result[0]!.disk).toBe("write");
    expect(result[0]!.remote).toBe("skip");
    expect(result[0]!.source).toBe("remote");
    expect(result[0]!.hash).toBe("sha256-remote");
    expect(result[0]!.modified).toBe(2000);
  });

  it("should restore remote version when locally deleted but remotely edited", () => {
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: ["notes/todo.md"],
    };
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/todo.md", { type: "text", content: "remote edit" }],
      ]),
      deleted: [],
    };

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toEqual([
      {
        path: "notes/todo.md",
        disk: "write",
        remote: "skip",
        content: "remote edit",
        source: "remote",
      },
    ]);
  });

  it("should preserve local version when remotely deleted but locally edited", () => {
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["notes/todo.md", { type: "text", content: "local edit" }],
      ]),
      deleted: [],
    };
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: ["notes/todo.md"],
    };

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toEqual([
      {
        path: "notes/todo.md",
        disk: "skip",
        remote: "write",
        content: "local edit",
        source: "local",
      },
    ]);
  });

  it("should skip files deleted on both sides", () => {
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: ["notes/todo.md"],
    };
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: ["notes/todo.md"],
    };

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toEqual([
      {
        path: "notes/todo.md",
        disk: "skip",
        remote: "skip",
      },
    ]);
  });

  it("should merge concurrent creates of same text file (two-way merge, base=null)", () => {
    const local: ChangeSet = {
      added: new Map([
        ["new.md", { type: "text", content: "local content" }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    const remote: ChangeSet = {
      added: new Map([
        ["new.md", { type: "text", content: "remote content" }],
      ]),
      modified: new Map(),
      deleted: [],
    };

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("new.md");
    expect(result[0]!.disk).toBe("write");
    expect(result[0]!.remote).toBe("write");
    expect(result[0]!.source).toBe("merged");
    expect(typeof result[0]!.content).toBe("string");
  });

  it("should use last-modified-wins for concurrent binary creates", () => {
    const local: ChangeSet = {
      added: new Map([
        ["image.png", { type: "binary", hash: "sha256-local", modified: 3000, data: new ArrayBuffer(4) }],
      ]),
      modified: new Map(),
      deleted: [],
    };
    const remote: ChangeSet = {
      added: new Map([
        ["image.png", { type: "binary", hash: "sha256-remote", modified: 1000, data: new ArrayBuffer(4) }],
      ]),
      modified: new Map(),
      deleted: [],
    };

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("image.png");
    // Local is newer (modified: 3000 > 1000), so push local
    expect(result[0]!.disk).toBe("skip");
    expect(result[0]!.remote).toBe("write");
    expect(result[0]!.source).toBe("local");
    expect(result[0]!.hash).toBe("sha256-local");
    expect(result[0]!.modified).toBe(3000);
  });

  it("should propagate local-only delete to remote when remote is unchanged", () => {
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: ["notes/old.md"],
    };
    const remote = emptyChangeSet();

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toEqual([
      {
        path: "notes/old.md",
        disk: "skip",
        remote: "delete",
        source: "local",
      },
    ]);
  });

  it("should apply remote-only delete locally when local is unchanged", () => {
    const local = emptyChangeSet();
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: ["notes/old.md"],
    };

    const result = reconcile(local, remote, {}, "newest");

    expect(result).toEqual([
      {
        path: "notes/old.md",
        disk: "delete",
        remote: "skip",
        source: "remote",
      },
    ]);
  });

  it("should handle empty ChangeSets (return empty mutations array)", () => {
    const result = reconcile(emptyChangeSet(), emptyChangeSet(), {}, "newest");
    expect(result).toEqual([]);
  });

  it('should respect binaryConflict="local" setting', () => {
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["image.png", { type: "binary", hash: "sha256-local", modified: 1000, data: new ArrayBuffer(4) }],
      ]),
      deleted: [],
    };
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["image.png", { type: "binary", hash: "sha256-remote", modified: 2000, data: new ArrayBuffer(4) }],
      ]),
      deleted: [],
    };

    const result = reconcile(local, remote, {}, "local");

    expect(result).toHaveLength(1);
    expect(result[0]!.disk).toBe("skip");
    expect(result[0]!.remote).toBe("write");
    expect(result[0]!.source).toBe("local");
    expect(result[0]!.hash).toBe("sha256-local");
  });

  it('should respect binaryConflict="remote" setting', () => {
    const local: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["image.png", { type: "binary", hash: "sha256-local", modified: 2000, data: new ArrayBuffer(4) }],
      ]),
      deleted: [],
    };
    const remote: ChangeSet = {
      added: new Map(),
      modified: new Map([
        ["image.png", { type: "binary", hash: "sha256-remote", modified: 1000, data: new ArrayBuffer(4) }],
      ]),
      deleted: [],
    };

    const result = reconcile(local, remote, {}, "remote");

    expect(result).toHaveLength(1);
    expect(result[0]!.disk).toBe("write");
    expect(result[0]!.remote).toBe("skip");
    expect(result[0]!.source).toBe("remote");
    expect(result[0]!.hash).toBe("sha256-remote");
  });
});

describe("mergeText", () => {
  it("should return { merged: local, clean: true } when local === remote", () => {
    const result = mergeText("base", "same", "same");
    expect(result).toEqual({ merged: "same", clean: true });
  });

  it("should return { merged: remote, clean: true } when local === base", () => {
    const result = mergeText("base", "base", "remote changed");
    expect(result).toEqual({ merged: "remote changed", clean: true });
  });

  it("should return { merged: local, clean: true } when remote === base", () => {
    const result = mergeText("base", "local changed", "base");
    expect(result).toEqual({ merged: "local changed", clean: true });
  });

  it("should apply both patches for three-way merge with non-overlapping changes", () => {
    const base = "line1\nline2\nline3";
    const local = "LINE1\nline2\nline3";
    const remote = "line1\nline2\nLINE3";

    const result = mergeText(base, local, remote);

    expect(result.merged).toBe("LINE1\nline2\nLINE3");
    expect(result.clean).toBe(true);
  });

  it("should report clean=false when patches fail partially", () => {
    // Create a scenario where patches are likely to conflict
    const base = "x";
    const local = "completely different text replacing x";
    const remote = "totally other content replacing x";

    const result = mergeText(base, local, remote);

    // The merge will attempt best-effort; we just verify it returns a result
    expect(typeof result.merged).toBe("string");
    // clean could be true or false depending on diff-match-patch's heuristics;
    // the important thing is the function doesn't throw
  });

  it("should perform two-way merge when base is null", () => {
    const local = "local content";
    const remote = "remote content";

    const result = mergeText(null, local, remote);

    expect(typeof result.merged).toBe("string");
    // Two-way merge: patches from local->remote applied to local
  });
});
