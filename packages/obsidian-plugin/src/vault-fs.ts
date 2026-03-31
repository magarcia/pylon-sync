import type { Vault, TFile } from "obsidian";
import type { FileSystem, FileEntry } from "@pylon-sync/core";

export class VaultFileSystem implements FileSystem {
  constructor(private vault: Vault, private syncObsidianSettings: boolean = false) {}

  private validatePath(path: string): void {
    if (path.includes("..") || path.startsWith("/") || path.includes("\0")) {
      throw new Error(`Invalid path: ${path}`);
    }
  }

  async list(): Promise<FileEntry[]> {
    // vault.getFiles() excludes dot-directories (.obsidian/, etc.)
    const files = this.vault.getFiles();
    const entries: FileEntry[] = files.map((f: TFile) => ({
      path: f.path,
      mtime: f.stat.mtime,
      size: f.stat.size,
    }));

    // If syncObsidianSettings is enabled, also list .obsidian/ files via adapter
    if (this.syncObsidianSettings) {
      try {
        const obsidianFiles = await this.walkAdapter(".obsidian");
        entries.push(...obsidianFiles);
      } catch {
        // .obsidian/ directory may not exist or be accessible
      }
    }

    return entries;
  }

  private async walkAdapter(dir: string): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    const listing = await this.vault.adapter.list(dir);

    for (const filePath of listing.files) {
      const stat = await this.vault.adapter.stat(filePath);
      if (stat && stat.type === "file") {
        entries.push({ path: filePath, mtime: stat.mtime, size: stat.size });
      }
    }

    for (const folderPath of listing.folders) {
      const subEntries = await this.walkAdapter(folderPath);
      entries.push(...subEntries);
    }

    return entries;
  }

  async readText(path: string): Promise<string> {
    // Try vault API first (works for non-dot files)
    const file = this.vault.getFileByPath(path);
    if (file) return this.vault.read(file);
    // Fallback to adapter for dot-directory files (.obsidian/)
    return this.vault.adapter.read(path);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.vault.getFileByPath(path);
    if (file) return this.vault.readBinary(file);
    return this.vault.adapter.readBinary(path);
  }

  async writeText(path: string, content: string): Promise<void> {
    this.validatePath(path);
    const existing = this.vault.getFileByPath(path);
    if (existing) {
      await this.vault.modify(existing, content);
    } else if (path.startsWith(".")) {
      // Dot-directory files must use adapter
      await this.vault.adapter.write(path, content);
    } else {
      await this.vault.create(path, content);
    }
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.validatePath(path);
    const existing = this.vault.getFileByPath(path);
    if (existing) {
      await this.vault.modifyBinary(existing, content);
    } else if (path.startsWith(".")) {
      await this.vault.adapter.writeBinary(path, content);
    } else {
      await this.vault.createBinary(path, content);
    }
  }

  async delete(path: string): Promise<void> {
    this.validatePath(path);
    const file = this.vault.getFileByPath(path);
    if (file) {
      await this.vault.delete(file);
    } else {
      // Dot-directory files — use adapter
      try {
        await this.vault.adapter.remove(path);
      } catch { /* file may not exist */ }
    }
  }

  async exists(path: string): Promise<boolean> {
    if (this.vault.getFileByPath(path)) return true;
    return this.vault.adapter.exists(path);
  }
}
