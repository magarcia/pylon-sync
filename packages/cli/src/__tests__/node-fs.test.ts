import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "../node-fs";

let tempDir: string;
let fs: NodeFileSystem;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "node-fs-test-"));
  fs = new NodeFileSystem(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("NodeFileSystem", () => {
  describe("list", () => {
    it("returns all files recursively", async () => {
      await mkdir(join(tempDir, "sub"), { recursive: true });
      await writeFile(join(tempDir, "root.txt"), "hello");
      await writeFile(join(tempDir, "sub", "nested.txt"), "world");

      const entries = await fs.list();
      const paths = entries.map((e) => e.path).sort();

      expect(paths).toEqual(["root.txt", "sub/nested.txt"]);
    });

    it("skips .git and .pylon directories but includes other dotfiles", async () => {
      await mkdir(join(tempDir, ".git"), { recursive: true });
      await mkdir(join(tempDir, ".pylon"), { recursive: true });
      await mkdir(join(tempDir, ".obsidian"), { recursive: true });
      await writeFile(join(tempDir, ".git", "config"), "git stuff");
      await writeFile(join(tempDir, ".pylon", "data.json"), "{}");
      await writeFile(join(tempDir, ".obsidian", "app.json"), "{}");
      await writeFile(join(tempDir, "visible.txt"), "yes");

      const entries = await fs.list();
      const paths = entries.map((e) => e.path).sort();

      expect(paths).toEqual([".obsidian/app.json", "visible.txt"]);
    });

    it("returns mtime and size for each entry", async () => {
      await writeFile(join(tempDir, "file.txt"), "12345");

      const entries = await fs.list();

      expect(entries).toHaveLength(1);
      expect(entries[0]!.path).toBe("file.txt");
      expect(entries[0]!.size).toBe(5);
      expect(entries[0]!.mtime).toBeGreaterThan(0);
    });
  });

  describe("readText", () => {
    it("reads file content as utf-8 string", async () => {
      await writeFile(join(tempDir, "hello.txt"), "hello world", "utf-8");

      const content = await fs.readText("hello.txt");

      expect(content).toBe("hello world");
    });
  });

  describe("readBinary", () => {
    it("returns an ArrayBuffer with correct content", async () => {
      const data = Buffer.from([0x00, 0x01, 0x02, 0xff]);
      await writeFile(join(tempDir, "binary.bin"), data);

      const result = await fs.readBinary("binary.bin");

      expect(result).toBeInstanceOf(ArrayBuffer);
      const view = new Uint8Array(result);
      expect(view).toEqual(new Uint8Array([0x00, 0x01, 0x02, 0xff]));
    });
  });

  describe("writeText", () => {
    it("creates file with parent directories", async () => {
      await fs.writeText("deep/nested/file.txt", "content");

      const content = await fs.readText("deep/nested/file.txt");
      expect(content).toBe("content");
    });
  });

  describe("writeBinary", () => {
    it("writes binary content correctly", async () => {
      const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;
      await fs.writeBinary("output.bin", data);

      const result = await fs.readBinary("output.bin");
      expect(new Uint8Array(result)).toEqual(
        new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      );
    });
  });

  describe("delete", () => {
    it("removes a file", async () => {
      await writeFile(join(tempDir, "doomed.txt"), "bye");

      await fs.delete("doomed.txt");

      const exists = await fs.exists("doomed.txt");
      expect(exists).toBe(false);
    });
  });

  describe("exists", () => {
    it("returns true for existing files", async () => {
      await writeFile(join(tempDir, "here.txt"), "yes");

      expect(await fs.exists("here.txt")).toBe(true);
    });

    it("returns false for missing files", async () => {
      expect(await fs.exists("nope.txt")).toBe(false);
    });
  });

  describe("path traversal protection", () => {
    it("should block path traversal in readText", async () => {
      await expect(fs.readText("../../../etc/passwd")).rejects.toThrow(
        "Path traversal",
      );
    });

    it("should block path traversal in writeText", async () => {
      await expect(
        fs.writeText("../../../etc/evil", "bad"),
      ).rejects.toThrow("Path traversal");
    });

    it("should block path traversal in readBinary", async () => {
      await expect(fs.readBinary("../../../etc/passwd")).rejects.toThrow(
        "Path traversal",
      );
    });

    it("should block path traversal in writeBinary", async () => {
      await expect(
        fs.writeBinary("../../../etc/evil", new ArrayBuffer(0)),
      ).rejects.toThrow("Path traversal");
    });

    it("should block path traversal in delete", async () => {
      await expect(fs.delete("../../../etc/evil")).rejects.toThrow(
        "Path traversal",
      );
    });

    it("should block path traversal in exists", async () => {
      await expect(fs.exists("../../../etc/passwd")).rejects.toThrow(
        "Path traversal",
      );
    });
  });

  describe("symlink protection", () => {
    it("should refuse to writeText to a symlink", async () => {
      await writeFile(join(tempDir, "real.txt"), "original");
      await symlink(
        join(tempDir, "real.txt"),
        join(tempDir, "link.txt"),
      );

      await expect(fs.writeText("link.txt", "evil")).rejects.toThrow(
        "Refusing to write to symlink",
      );
    });

    it("should refuse to writeBinary to a symlink", async () => {
      await writeFile(join(tempDir, "real.bin"), "original");
      await symlink(
        join(tempDir, "real.bin"),
        join(tempDir, "link.bin"),
      );

      await expect(
        fs.writeBinary("link.bin", new ArrayBuffer(0)),
      ).rejects.toThrow("Refusing to write to symlink");
    });
  });
});
