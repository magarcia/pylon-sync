import {
  readFile,
  writeFile,
  unlink,
  readdir,
  stat,
  lstat,
  mkdir,
  access,
} from "node:fs/promises";
import { join, relative, dirname, resolve, sep } from "node:path";
import type { FileSystem, FileEntry } from "@pylon-sync/core";

export class NodeFileSystem implements FileSystem {
  constructor(private rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  private safePath(filePath: string): string {
    const full = resolve(this.rootDir, filePath);
    if (!full.startsWith(this.rootDir + sep) && full !== this.rootDir) {
      throw new Error(`Path traversal blocked: ${filePath}`);
    }
    return full;
  }

  private async assertNotSymlink(
    fullPath: string,
    filePath: string,
  ): Promise<void> {
    try {
      const s = await lstat(fullPath);
      if (s.isSymbolicLink()) {
        throw new Error(`Refusing to write to symlink: ${filePath}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async list(): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    await this.walk(this.rootDir, entries);
    return entries;
  }

  async readText(path: string): Promise<string> {
    return readFile(this.safePath(path), "utf-8");
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const buffer = await readFile(this.safePath(path));
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  }

  async writeText(path: string, content: string): Promise<void> {
    const fullPath = this.safePath(path);
    await this.assertNotSymlink(fullPath, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    const fullPath = this.safePath(path);
    await this.assertNotSymlink(fullPath, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, Buffer.from(content));
  }

  async delete(path: string): Promise<void> {
    await unlink(this.safePath(path));
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = this.safePath(path);
    try {
      await access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  private async walk(dir: string, entries: FileEntry[]): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name === ".pylon" || item.name === ".git") continue;

      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        await this.walk(fullPath, entries);
      } else if (item.isFile()) {
        const fileStat = await stat(fullPath);
        entries.push({
          path: relative(this.rootDir, fullPath),
          mtime: fileStat.mtimeMs,
          size: fileStat.size,
        });
      }
    }
  }
}
