import { describe, it, expect, beforeEach } from "vitest";
import { Vault } from "obsidian";
import { VaultFileSystem } from "../vault-fs";

describe("VaultFileSystem", () => {
  let vault: Vault;
  let fs: VaultFileSystem;

  beforeEach(() => {
    vault = new Vault();
    fs = new VaultFileSystem(vault);
  });

  describe("list", () => {
    it("should return all files in the vault", async () => {
      (vault as any)._seed({ "notes/hello.md": "hi", "data.json": "{}" });

      const entries = await fs.list();

      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.path).sort()).toEqual([
        "data.json",
        "notes/hello.md",
      ]);
      for (const entry of entries) {
        expect(entry).toHaveProperty("mtime");
        expect(entry).toHaveProperty("size");
      }
    });

    it("with syncObsidianSettings=true should include .obsidian files", async () => {
      (vault as any)._seed({ "note.md": "content" });
      (vault.adapter as any)._seed({
        ".obsidian/app.json": '{"theme":"dark"}',
        ".obsidian/plugins/foo/main.js": "code",
      });

      const syncFs = new VaultFileSystem(vault, true);
      const entries = await syncFs.list();

      const paths = entries.map((e) => e.path);
      expect(paths).toContain("note.md");
      expect(paths).toContain(".obsidian/app.json");
      expect(paths).toContain(".obsidian/plugins/foo/main.js");
    });

    it("with syncObsidianSettings=false should NOT include .obsidian files", async () => {
      (vault as any)._seed({ "note.md": "content" });
      (vault.adapter as any)._seed({
        ".obsidian/app.json": '{"theme":"dark"}',
      });

      const entries = await fs.list();

      const paths = entries.map((e) => e.path);
      expect(paths).toEqual(["note.md"]);
    });
  });

  describe("readText", () => {
    it("should return file content as string", async () => {
      (vault as any)._seed({ "readme.md": "# Hello World" });

      const content = await fs.readText("readme.md");

      expect(content).toBe("# Hello World");
    });

    it("should read .obsidian files via adapter fallback", async () => {
      (vault.adapter as any)._seed({
        ".obsidian/config.json": '{"key":"value"}',
      });

      const content = await fs.readText(".obsidian/config.json");

      expect(content).toBe('{"key":"value"}');
    });
  });

  describe("readBinary", () => {
    it("should return file content as ArrayBuffer", async () => {
      const binary = new TextEncoder().encode("binary data").buffer as ArrayBuffer;
      (vault as any)._seed({ "image.png": binary });

      const result = await fs.readBinary("image.png");

      expect(result).toBeInstanceOf(ArrayBuffer);
      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe("binary data");
    });
  });

  describe("writeText", () => {
    it("should create new file when it doesn't exist", async () => {
      await fs.writeText("new-file.md", "new content");

      const content = (vault as any)._getContent("new-file.md");
      expect(content).toBe("new content");
    });

    it("should modify existing file", async () => {
      (vault as any)._seed({ "existing.md": "old content" });

      await fs.writeText("existing.md", "updated content");

      const content = (vault as any)._getContent("existing.md");
      expect(content).toBe("updated content");
    });

    it("should reject paths containing '..'", async () => {
      await expect(
        fs.writeText("../escape/file.md", "bad"),
      ).rejects.toThrow("Invalid path");
    });

    it("should reject paths with null bytes", async () => {
      await expect(
        fs.writeText("file\0.md", "bad"),
      ).rejects.toThrow("Invalid path");
    });
  });

  describe("writeBinary", () => {
    it("should create new binary file", async () => {
      const data = new TextEncoder().encode("bin").buffer as ArrayBuffer;

      await fs.writeBinary("file.bin", data);

      const content = (vault as any)._getContent("file.bin");
      expect(content).toBeInstanceOf(ArrayBuffer);
    });

    it("should reject paths containing '..'", async () => {
      const data = new ArrayBuffer(0);

      await expect(
        fs.writeBinary("../bad/file.bin", data),
      ).rejects.toThrow("Invalid path");
    });
  });

  describe("delete", () => {
    it("should remove file from vault", async () => {
      (vault as any)._seed({ "to-delete.md": "bye" });

      await fs.delete("to-delete.md");

      expect(await fs.exists("to-delete.md")).toBe(false);
    });

    it("should not throw for nonexistent file", async () => {
      await expect(fs.delete("nonexistent.md")).resolves.toBeUndefined();
    });

    it("should reject paths starting with '/'", async () => {
      await expect(fs.delete("/absolute/path.md")).rejects.toThrow(
        "Invalid path",
      );
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      (vault as any)._seed({ "exists.md": "here" });

      expect(await fs.exists("exists.md")).toBe(true);
    });

    it("should return false for nonexistent file", async () => {
      expect(await fs.exists("nope.md")).toBe(false);
    });
  });
});
