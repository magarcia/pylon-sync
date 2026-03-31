import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  saveConfig,
  loadData,
  saveData,
  type CliConfig,
} from "../config";
import type { PluginData } from "@pylon-sync/core";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "config-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("config", () => {
  describe("saveConfig + loadConfig", () => {
    it("roundtrips config correctly", async () => {
      const config: CliConfig = {
        provider: "github",
        repo: "owner/repo",
        branch: "main",
      };

      await saveConfig(tempDir, config);
      const loaded = await loadConfig(tempDir);

      expect(loaded).toEqual(config);
    });

    it("throws a helpful error when not initialized", async () => {
      await expect(loadConfig(tempDir)).rejects.toThrow(
        "Not initialized",
      );
    });
  });

  describe("loadData", () => {
    it("returns defaults when no data file exists", async () => {
      const data = await loadData(tempDir);

      expect(data).toEqual({
        snapshot: {},
        lastSyncTime: 0,
        syncCount: 0,
        cursor: null,
      });
    });
  });

  describe("saveData + loadData", () => {
    it("roundtrips plugin data correctly", async () => {
      const data: PluginData = {
        snapshot: {
          "notes/test.md": { hash: "abc123", mtime: 1000 },
        },
        lastSyncTime: 1700000000000,
        syncCount: 5,
        cursor: { commitSha: "deadbeef", treeSha: "cafebabe" },
      };

      await saveData(tempDir, data);
      const loaded = await loadData(tempDir);

      expect(loaded).toEqual(data);
    });
  });
});
