# Obsidian API Mocks

Complete mock implementations for testing Obsidian plugins without the Obsidian runtime.

## Full Mock Module

```typescript
// test/mocks/obsidian.ts
// This file replaces the "obsidian" module in tests via vitest alias

// --- Types ---

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  parent: TFolder | null = null;
  stat: { mtime: number; ctime: number; size: number };

  constructor(path: string, mtime = Date.now(), size = 0) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    const dotIdx = this.name.lastIndexOf(".");
    this.basename = dotIdx > 0 ? this.name.slice(0, dotIdx) : this.name;
    this.extension = dotIdx > 0 ? this.name.slice(dotIdx + 1) : "";
    this.stat = { mtime, ctime: mtime, size };
  }
}

export class TFolder {
  path: string;
  name: string;
  children: (TFile | TFolder)[] = [];

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export type TAbstractFile = TFile | TFolder;

// --- Vault Mock ---

export class MockVault {
  private files = new Map<string, { content: string | ArrayBuffer; mtime: number }>();
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  // --- Read ---

  async read(file: TFile): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    return entry.content as string;
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    if (typeof entry.content === "string") {
      return new TextEncoder().encode(entry.content).buffer;
    }
    return entry.content;
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  // --- Write ---

  async create(path: string, data: string | ArrayBuffer): Promise<TFile> {
    if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
    const mtime = Date.now();
    this.files.set(path, { content: data, mtime });
    const file = new TFile(path, mtime);
    this.emit("create", file);
    return file;
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    return this.create(path, data);
  }

  async modify(file: TFile, data: string): Promise<void> {
    if (!this.files.has(file.path)) throw new Error(`File not found: ${file.path}`);
    const mtime = Date.now();
    this.files.set(file.path, { content: data, mtime });
    file.stat.mtime = mtime;
    this.emit("modify", file);
  }

  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    if (!this.files.has(file.path)) throw new Error(`File not found: ${file.path}`);
    const mtime = Date.now();
    this.files.set(file.path, { content: data, mtime });
    file.stat.mtime = mtime;
    this.emit("modify", file);
  }

  async append(file: TFile, data: string): Promise<void> {
    const content = await this.read(file);
    await this.modify(file, content + data);
  }

  async process(file: TFile, fn: (content: string) => string): Promise<void> {
    const content = await this.read(file);
    await this.modify(file, fn(content));
  }

  // --- Delete ---

  async delete(file: TFile): Promise<void> {
    this.files.delete(file.path);
    this.emit("delete", file);
  }

  async trash(file: TFile): Promise<void> {
    await this.delete(file);
  }

  // --- Query ---

  getFiles(): TFile[] {
    return [...this.files.entries()].map(
      ([path, entry]) => new TFile(path, entry.mtime, typeof entry.content === "string" ? entry.content.length : (entry.content as ArrayBuffer).byteLength)
    );
  }

  getMarkdownFiles(): TFile[] {
    return this.getFiles().filter((f) => f.extension === "md");
  }

  getFileByPath(path: string): TFile | null {
    const entry = this.files.get(path);
    return entry ? new TFile(path, entry.mtime) : null;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.getFileByPath(path);
  }

  // --- Rename/Copy ---

  async rename(file: TFile, newPath: string): Promise<void> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    const oldPath = file.path;
    this.files.delete(file.path);
    this.files.set(newPath, entry);
    file.path = newPath;
    this.emit("rename", file, oldPath);
  }

  async copy(file: TFile, newPath: string): Promise<TFile> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    return this.create(newPath, entry.content);
  }

  // --- Events ---

  on(event: string, callback: (...args: any[]) => void): { unload: () => void } {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(callback);
    return {
      unload: () => {
        const cbs = this.listeners.get(event);
        if (cbs) {
          const idx = cbs.indexOf(callback);
          if (idx >= 0) cbs.splice(idx, 1);
        }
      },
    };
  }

  private emit(event: string, ...args: any[]) {
    for (const cb of this.listeners.get(event) ?? []) {
      cb(...args);
    }
  }

  // --- Test Helpers ---

  seed(files: Record<string, string>, mtime = Date.now()) {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, { content, mtime });
    }
  }

  clear() {
    this.files.clear();
    this.listeners.clear();
  }
}

// --- requestUrl Mock ---

export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  json: any;
  text: string;
  arrayBuffer: ArrayBuffer;
}

// Default: returns 200 with empty JSON. Override with vi.mocked(requestUrl).mockResolvedValue(...)
export async function requestUrl(params: RequestUrlParam): Promise<RequestUrlResponse> {
  return {
    status: 200,
    headers: {},
    json: {},
    text: "{}",
    arrayBuffer: new ArrayBuffer(0),
  };
}

// --- UI Stubs ---

export class Notice {
  message: string;
  constructor(message: string | DocumentFragment, _timeout?: number) {
    this.message = typeof message === "string" ? message : "fragment";
  }
  hide() {}
}

export class Modal {
  app: any;
  contentEl = document.createElement("div");
  constructor(app: any) { this.app = app; }
  open() { this.onOpen(); }
  close() { this.onClose(); }
  onOpen() {}
  onClose() {}
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl = document.createElement("div");
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
  display() {}
  hide() {}
}

export class Setting {
  constructor(_containerEl: HTMLElement) {}
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
  addText(_cb: (text: any) => any) { return this; }
  addToggle(_cb: (toggle: any) => any) { return this; }
  addDropdown(_cb: (dropdown: any) => any) { return this; }
  addButton(_cb: (button: any) => any) { return this; }
  addTextArea(_cb: (textarea: any) => any) { return this; }
}

// --- Platform ---

export const Platform = {
  isMobile: false,
  isDesktop: true,
  isMacOS: true,
  isWin: false,
  isLinux: false,
  isIosApp: false,
  isAndroidApp: false,
  isMobileApp: false,
  isDesktopApp: true,
};

// --- Plugin Base ---

export class Plugin {
  app: any;
  manifest: any = {};

  async loadData(): Promise<any> { return null; }
  async saveData(_data: any): Promise<void> {}

  addCommand(_command: any) { return _command; }
  addRibbonIcon(_icon: string, _title: string, _cb: () => void) { return document.createElement("div"); }
  addStatusBarItem() { return document.createElement("div"); }
  addSettingTab(_tab: any) {}

  registerEvent(_event: any) {}
  registerInterval(_id: number) { return _id; }
  registerDomEvent(_el: any, _event: string, _cb: any) {}

  async onload() {}
  onunload() {}
}
```

## Usage in Tests

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockVault, requestUrl, TFile } from "../mocks/obsidian";

// To mock requestUrl responses:
vi.mock("obsidian", async () => {
  const actual = await vi.importActual("../mocks/obsidian");
  return {
    ...actual,
    requestUrl: vi.fn(),
  };
});
```
