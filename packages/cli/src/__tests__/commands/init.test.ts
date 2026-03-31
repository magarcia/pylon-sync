import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("cross-keychain", () => ({
  getPassword: vi.fn().mockResolvedValue(null),
  setPassword: vi.fn().mockResolvedValue(undefined),
}));

import { initCommand } from "../../commands/init";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "init-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("initCommand", () => {
  const defaultOpts = {
    token: "ghp_test123",
    repo: "owner/repo",
    branch: "main",
  };

  it("should create .pylon/config.json with repo and branch", async () => {
    await initCommand(tempDir, defaultOpts);

    const config = JSON.parse(
      await readFile(join(tempDir, ".pylon", "config.json"), "utf-8"),
    );
    expect(config).toEqual({
      provider: "github",
      repo: "owner/repo",
      branch: "main",
    });
  });

  it("should create .pylon/ directory if it doesn't exist", async () => {
    await initCommand(tempDir, defaultOpts);

    const entries = await readdir(tempDir);
    expect(entries).toContain(".pylon");
  });

  it("should append .pylon/ to .gitignore", async () => {
    await writeFile(join(tempDir, ".gitignore"), "node_modules/\n");

    await initCommand(tempDir, defaultOpts);

    const gitignore = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".pylon/");
    expect(gitignore).toContain("node_modules/");
  });

  it("should create .gitignore with .pylon/ if no .gitignore exists", async () => {
    await initCommand(tempDir, defaultOpts);

    const gitignore = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(gitignore).toBe(".pylon/\n");
  });

  it("should not duplicate .pylon/ in .gitignore if already present", async () => {
    await writeFile(join(tempDir, ".gitignore"), ".pylon/\n");

    await initCommand(tempDir, defaultOpts);

    const gitignore = await readFile(join(tempDir, ".gitignore"), "utf-8");
    const occurrences = gitignore.split(".pylon/").length - 1;
    expect(occurrences).toBe(1);
  });

  it("should NOT store token in config file", async () => {
    await initCommand(tempDir, defaultOpts);

    const config = JSON.parse(
      await readFile(join(tempDir, ".pylon", "config.json"), "utf-8"),
    );
    expect(config).not.toHaveProperty("token");
  });

  it("should exit with code 1 if already initialized", async () => {
    await initCommand(tempDir, defaultOpts);

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as unknown as typeof process.exit);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await initCommand(tempDir, defaultOpts);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Already initialized"),
    );

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
