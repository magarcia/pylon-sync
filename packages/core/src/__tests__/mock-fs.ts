import type { FileSystem, FileEntry } from "../types";

export class MockFileSystem implements FileSystem {
  private files = new Map<string, { content: string | ArrayBuffer; mtime: number }>();

  async list(): Promise<FileEntry[]> {
    return [...this.files.entries()].map(([path, entry]) => ({
      path,
      mtime: entry.mtime,
      size: typeof entry.content === "string" ? entry.content.length : entry.content.byteLength,
    }));
  }

  async readText(path: string): Promise<string> {
    const entry = this.files.get(path);
    if (!entry) throw new Error(`File not found: ${path}`);
    if (typeof entry.content === "string") return entry.content;
    return new TextDecoder().decode(entry.content);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const entry = this.files.get(path);
    if (!entry) throw new Error(`File not found: ${path}`);
    if (typeof entry.content === "string") {
      return new TextEncoder().encode(entry.content).buffer as ArrayBuffer;
    }
    return entry.content;
  }

  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, { content, mtime: Date.now() });
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.files.set(path, { content, mtime: Date.now() });
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  seed(files: Record<string, string | ArrayBuffer>, mtime = Date.now()) {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, { content, mtime });
    }
  }

  getContent(path: string): string | ArrayBuffer | undefined {
    return this.files.get(path)?.content;
  }

  getFile(path: string): { content: string | ArrayBuffer; mtime: number } | undefined {
    return this.files.get(path);
  }

  clear() {
    this.files.clear();
  }
}
