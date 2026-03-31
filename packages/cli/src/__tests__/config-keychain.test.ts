import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("cross-keychain", () => ({
  getPassword: vi.fn().mockRejectedValue(new Error("not available")),
  setPassword: vi.fn().mockRejectedValue(new Error("not available")),
}));

import { loadToken, saveToken } from "../config";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "config-keychain-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("loadToken", () => {
  it("should return empty string when keychain is unavailable and no config fallback", async () => {
    const token = await loadToken(tempDir);
    expect(token).toBe("");
  });

  it("should fall back to token in config file when keychain is unavailable", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(tempDir, ".pylon"), { recursive: true });
    await writeFile(
      join(tempDir, ".pylon", "config.json"),
      JSON.stringify({ provider: "github", repo: "o/r", branch: "main", token: "fallback_token" }),
    );

    const token = await loadToken(tempDir);
    expect(token).toBe("fallback_token");
  });
});

describe("saveToken", () => {
  it("should not throw when keychain is unavailable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(saveToken("ghp_test")).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Could not save token to keychain"),
    );

    warnSpy.mockRestore();
  });
});
