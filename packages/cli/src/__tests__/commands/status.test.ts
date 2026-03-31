vi.mock("@pylon-sync/core", async () => {
  const actual = await vi.importActual("@pylon-sync/core");
  return { ...actual, scan: vi.fn() };
});

vi.mock("../../node-fs", () => ({
  NodeFileSystem: vi.fn(),
}));

vi.mock("../../config", async () => {
  const actual = await vi.importActual("../../config");
  return {
    ...actual,
    loadConfig: vi
      .fn()
      .mockResolvedValue({ provider: "github", repo: "owner/repo", branch: "main" }),
    loadData: vi.fn().mockResolvedValue({
      snapshot: {},
      lastSyncTime: 0,
      syncCount: 0,
      cursor: null,
    }),
  };
});

import { scan } from "@pylon-sync/core";
import { statusCommand } from "../../commands/status";
import { loadData } from "../../config";

beforeEach(() => {
  vi.clearAllMocks();
});

function emptyChangeSet() {
  return { added: new Map(), modified: new Map(), deleted: [] as string[] };
}

describe("statusCommand", () => {
  it("should print 'No local changes' when scan returns empty changeset", async () => {
    vi.mocked(scan).mockResolvedValueOnce(emptyChangeSet());

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand("/tmp/test");

    expect(logSpy).toHaveBeenCalledWith("No local changes");
    logSpy.mockRestore();
  });

  it("should list added files with '+' prefix", async () => {
    const changes = emptyChangeSet();
    changes.added.set("notes/new.md", { hash: "abc", mtime: 1000 });
    vi.mocked(scan).mockResolvedValueOnce(changes);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand("/tmp/test");

    expect(logSpy).toHaveBeenCalledWith("  + notes/new.md");
    logSpy.mockRestore();
  });

  it("should list modified files with '~' prefix", async () => {
    const changes = emptyChangeSet();
    changes.modified.set("notes/changed.md", { hash: "def", mtime: 2000 });
    vi.mocked(scan).mockResolvedValueOnce(changes);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand("/tmp/test");

    expect(logSpy).toHaveBeenCalledWith("  ~ notes/changed.md");
    logSpy.mockRestore();
  });

  it("should list deleted files with '-' prefix", async () => {
    const changes = emptyChangeSet();
    changes.deleted.push("notes/removed.md");
    vi.mocked(scan).mockResolvedValueOnce(changes);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand("/tmp/test");

    expect(logSpy).toHaveBeenCalledWith("  - notes/removed.md");
    logSpy.mockRestore();
  });

  it("should show total count of changed files", async () => {
    const changes = emptyChangeSet();
    changes.added.set("a.md", { hash: "a", mtime: 1 });
    changes.modified.set("b.md", { hash: "b", mtime: 2 });
    changes.deleted.push("c.md");
    vi.mocked(scan).mockResolvedValueOnce(changes);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand("/tmp/test");

    expect(logSpy).toHaveBeenCalledWith("3 file(s) changed since last sync");
    logSpy.mockRestore();
  });

  it("should show last sync time as 'never' when lastSyncTime is 0", async () => {
    vi.mocked(scan).mockResolvedValueOnce(emptyChangeSet());

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand("/tmp/test");

    expect(logSpy).toHaveBeenCalledWith("Last sync: never");
    logSpy.mockRestore();
  });

  it("should show formatted last sync time when available", async () => {
    vi.mocked(scan).mockResolvedValueOnce(emptyChangeSet());
    vi.mocked(loadData).mockResolvedValueOnce({
      snapshot: {},
      lastSyncTime: 1700000000000,
      syncCount: 5,
      cursor: null,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand("/tmp/test");

    const lastSyncCall = logSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].startsWith("Last sync:"),
    );
    expect(lastSyncCall).toBeDefined();
    expect(lastSyncCall![0]).not.toContain("never");
    logSpy.mockRestore();
  });

  it("should output JSON when outputJson is true", async () => {
    const changes = emptyChangeSet();
    changes.added.set("a.md", { hash: "a", mtime: 1 });
    changes.modified.set("b.md", { hash: "b", mtime: 2 });
    changes.deleted.push("c.md");
    vi.mocked(scan).mockResolvedValueOnce(changes);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand("/tmp/test", { outputJson: true });

    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.total).toBe(3);
    expect(output.added).toEqual(["a.md"]);
    expect(output.modified).toEqual(["b.md"]);
    expect(output.deleted).toEqual(["c.md"]);
    expect(output.lastSyncTime).toBeNull();
    logSpy.mockRestore();
  });

  it("should output JSON with no changes", async () => {
    vi.mocked(scan).mockResolvedValueOnce(emptyChangeSet());

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand("/tmp/test", { outputJson: true });

    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.total).toBe(0);
    expect(output.added).toEqual([]);
    expect(output.modified).toEqual([]);
    expect(output.deleted).toEqual([]);
    logSpy.mockRestore();
  });
});
