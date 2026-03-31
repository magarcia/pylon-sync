vi.mock("@pylon-sync/core", async () => {
  const actual = await vi.importActual("@pylon-sync/core");
  return {
    ...actual,
    SyncEngine: vi.fn().mockImplementation(() => ({
      sync: vi.fn().mockResolvedValue({ status: "success", mutations: [] }),
    })),
  };
});

vi.mock("@pylon-sync/provider-github", () => ({
  GitHubProvider: vi.fn(),
}));

vi.mock("../../node-fs", () => ({
  NodeFileSystem: vi.fn(),
}));

vi.mock("../../node-http", () => ({
  NodeHttpClient: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../../config", async () => {
  const actual = await vi.importActual("../../config");
  return {
    ...actual,
    loadConfig: vi
      .fn()
      .mockResolvedValue({ provider: "github", repo: "owner/repo", branch: "main" }),
    loadToken: vi.fn().mockResolvedValue("ghp_test"),
    loadData: vi
      .fn()
      .mockResolvedValue({ snapshot: {}, lastSyncTime: 0, syncCount: 0, cursor: null }),
    saveData: vi.fn(),
  };
});

import { execSync } from "node:child_process";
import { SyncEngine } from "@pylon-sync/core";
import { GitHubProvider } from "@pylon-sync/provider-github";
import { syncCommand } from "../../commands/sync";
import { loadConfig, loadToken } from "../../config";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GITHUB_TOKEN;
});

describe("syncCommand", () => {
  it("should call SyncEngine.sync() and print success message", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await syncCommand("/tmp/test", {});

    expect(SyncEngine).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Synced"));
    logSpy.mockRestore();
  });

  it("should print 'Already up to date' for no-changes result", async () => {
    vi.mocked(SyncEngine).mockImplementationOnce(
      () =>
        ({
          sync: vi.fn().mockResolvedValue({ status: "no-changes", mutations: [] }),
        }) as unknown as InstanceType<typeof SyncEngine>,
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await syncCommand("/tmp/test", {});

    expect(logSpy).toHaveBeenCalledWith("Already up to date");
    logSpy.mockRestore();
  });

  it("should exit with code 1 on error result", async () => {
    vi.mocked(SyncEngine).mockImplementationOnce(
      () =>
        ({
          sync: vi.fn().mockResolvedValue({
            status: "error",
            mutations: [],
            error: new Error("Network failure"),
          }),
        }) as unknown as InstanceType<typeof SyncEngine>,
    );

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(syncCommand("/tmp/test", {})).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Network failure"),
    );

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("should pass forceFullScan option by resetting syncCount to 0", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await syncCommand("/tmp/test", { forceFullScan: true });

    const constructorCall = vi.mocked(SyncEngine).mock.calls[0]!;
    const data = constructorCall[3] as { syncCount: number };
    expect(data.syncCount).toBe(0);

    logSpy.mockRestore();
  });

  it("should exit with code 3 when no token is available", async () => {
    vi.mocked(loadToken).mockResolvedValueOnce("");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(syncCommand("/tmp/test", {})).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(3);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("No token found"),
    );

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("should count only non-skip mutations in success message", async () => {
    vi.mocked(SyncEngine).mockImplementationOnce(
      () =>
        ({
          sync: vi.fn().mockResolvedValue({
            status: "success",
            mutations: [
              { path: "a.md", disk: "write", remote: "skip" },
              { path: "b.md", disk: "skip", remote: "skip" },
              { path: "c.md", disk: "skip", remote: "push" },
            ],
          }),
        }) as unknown as InstanceType<typeof SyncEngine>,
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await syncCommand("/tmp/test", {});

    expect(logSpy).toHaveBeenCalledWith("Synced: 2 change(s)");
    logSpy.mockRestore();
  });

  it("should output JSON when outputJson is true", async () => {
    vi.mocked(SyncEngine).mockImplementationOnce(
      () =>
        ({
          sync: vi.fn().mockResolvedValue({
            status: "success",
            mutations: [
              { path: "a.md", disk: "write", remote: "skip" },
            ],
          }),
        }) as unknown as InstanceType<typeof SyncEngine>,
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await syncCommand("/tmp/test", { outputJson: true });

    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.status).toBe("success");
    expect(output.changes).toBe(1);
    expect(output.mutations).toEqual([
      { path: "a.md", disk: "write", remote: "skip" },
    ]);
    logSpy.mockRestore();
  });

  it("should output JSON for no-changes when outputJson is true", async () => {
    vi.mocked(SyncEngine).mockImplementationOnce(
      () =>
        ({
          sync: vi.fn().mockResolvedValue({ status: "no-changes", mutations: [] }),
        }) as unknown as InstanceType<typeof SyncEngine>,
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await syncCommand("/tmp/test", { outputJson: true });

    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.status).toBe("no-changes");
    expect(output.changes).toBe(0);
    logSpy.mockRestore();
  });

  it("should output JSON for error when outputJson is true", async () => {
    vi.mocked(SyncEngine).mockImplementationOnce(
      () =>
        ({
          sync: vi.fn().mockResolvedValue({
            status: "error",
            mutations: [],
            error: new Error("Network failure"),
          }),
        }) as unknown as InstanceType<typeof SyncEngine>,
    );

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(syncCommand("/tmp/test", { outputJson: true })).rejects.toThrow(
      "process.exit",
    );

    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.status).toBe("error");
    expect(output.error).toBe("Network failure");

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("should use commitMessage from config when set", async () => {
    vi.mocked(loadConfig).mockResolvedValueOnce({
      provider: "github",
      repo: "owner/repo",
      branch: "main",
      commitMessage: "custom: sync {{date}}",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await syncCommand("/tmp/test", {});

    const providerCall = vi.mocked(GitHubProvider).mock.calls[0]![0];
    expect(providerCall.commitMessage).toBe("custom: sync {{date}}");
    logSpy.mockRestore();
  });

  it("should use commitMessageCommand output when set", async () => {
    vi.mocked(loadConfig).mockResolvedValueOnce({
      provider: "github",
      repo: "owner/repo",
      branch: "main",
      commitMessageCommand: "echo 'ai: generated message'",
    });
    vi.mocked(execSync).mockReturnValueOnce("ai: generated message\n");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await syncCommand("/tmp/test", {});

    expect(execSync).toHaveBeenCalledWith("echo 'ai: generated message'", {
      cwd: "/tmp/test",
      encoding: "utf-8",
      timeout: 10_000,
    });
    const providerCall = vi.mocked(GitHubProvider).mock.calls[0]![0];
    expect(providerCall.commitMessage).toBe("ai: generated message");
    logSpy.mockRestore();
  });

  it("should fall back to template when commitMessageCommand fails", async () => {
    vi.mocked(loadConfig).mockResolvedValueOnce({
      provider: "github",
      repo: "owner/repo",
      branch: "main",
      commitMessage: "fallback: sync",
      commitMessageCommand: "bad-command",
    });
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error("command not found");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await syncCommand("/tmp/test", {});

    const providerCall = vi.mocked(GitHubProvider).mock.calls[0]![0];
    expect(providerCall.commitMessage).toBe("fallback: sync");
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("commitMessageCommand failed"),
    );
    logSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
