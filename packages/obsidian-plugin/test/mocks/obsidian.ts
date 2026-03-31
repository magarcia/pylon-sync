// Mock for the "obsidian" module
// Verified against Obsidian API type definitions (obsidian.d.ts)

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

export class Vault {
  private files = new Map<string, { content: string | ArrayBuffer; mtime: number }>();
  private eventListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  adapter: DataAdapter;

  constructor() {
    this.adapter = new DataAdapter();
  }

  async read(file: TFile): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    if (typeof entry.content !== "string") {
      return new TextDecoder().decode(entry.content as ArrayBuffer);
    }
    return entry.content;
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    if (typeof entry.content === "string") {
      return new TextEncoder().encode(entry.content).buffer as ArrayBuffer;
    }
    return entry.content;
  }

  async create(path: string, data: string | ArrayBuffer): Promise<TFile> {
    if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
    const mtime = Date.now();
    const size = typeof data === "string" ? data.length : (data as ArrayBuffer).byteLength;
    this.files.set(path, { content: data, mtime });
    const file = new TFile(path, mtime, size);
    this._emit("create", file);
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
    file.stat.size = data.length;
    this._emit("modify", file);
  }

  async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
    if (!this.files.has(file.path)) throw new Error(`File not found: ${file.path}`);
    const mtime = Date.now();
    this.files.set(file.path, { content: data, mtime });
    file.stat.mtime = mtime;
    file.stat.size = data.byteLength;
    this._emit("modify", file);
  }

  async delete(file: TFile): Promise<void> {
    this.files.delete(file.path);
    this._emit("delete", file);
  }

  async trash(file: TFile, _systemTrash?: boolean): Promise<void> {
    await this.delete(file);
  }

  getFiles(): TFile[] {
    return [...this.files.entries()].map(
      ([path, entry]) => new TFile(
        path,
        entry.mtime,
        typeof entry.content === "string" ? entry.content.length : (entry.content as ArrayBuffer).byteLength
      )
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

  on(event: string, callback: (...args: unknown[]) => void): EventRef {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
    this.eventListeners.get(event)!.push(callback);
    return {
      event,
      callback,
    };
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    const cbs = this.eventListeners.get(event);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx >= 0) cbs.splice(idx, 1);
    }
  }

  private _emit(event: string, ...args: unknown[]) {
    for (const cb of this.eventListeners.get(event) ?? []) {
      cb(...args);
    }
  }

  _seed(files: Record<string, string | ArrayBuffer>, mtime = Date.now()) {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, { content, mtime });
    }
  }

  _clear() {
    this.files.clear();
    this.eventListeners.clear();
  }

  _getContent(path: string): string | ArrayBuffer | undefined {
    return this.files.get(path)?.content;
  }
}

export interface EventRef {
  event: string;
  callback: (...args: unknown[]) => void;
}

export class DataAdapter {
  private data = new Map<string, string | ArrayBuffer>();

  async exists(path: string): Promise<boolean> {
    return this.data.has(path);
  }

  async read(path: string): Promise<string> {
    const content = this.data.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return typeof content === "string" ? content : new TextDecoder().decode(content as ArrayBuffer);
  }

  async write(path: string, content: string): Promise<void> {
    this.data.set(path, content);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const content = this.data.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    if (typeof content === "string") {
      return new TextEncoder().encode(content).buffer as ArrayBuffer;
    }
    return content;
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.data.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.data.delete(path);
  }

  async list(folder: string): Promise<{ files: string[]; folders: string[] }> {
    const files: string[] = [];
    const folders = new Set<string>();
    const prefix = folder === "/" || folder === "" ? "" : folder + "/";
    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) {
        files.push(key);
        const parts = key.slice(prefix.length).split("/");
        if (parts.length > 1) {
          folders.add(prefix + parts[0]);
        }
      }
    }
    return { files, folders: [...folders] };
  }

  async stat(path: string): Promise<{ type: "file" | "folder"; ctime: number; mtime: number; size: number } | null> {
    const content = this.data.get(path);
    if (content === undefined) return null;
    return {
      type: "file",
      ctime: Date.now(),
      mtime: Date.now(),
      size: typeof content === "string" ? content.length : content.byteLength,
    };
  }

  _seed(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      this.data.set(path, content);
    }
  }

  _clear() {
    this.data.clear();
  }
}

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
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
}

export async function requestUrl(_params: RequestUrlParam): Promise<RequestUrlResponse> {
  throw new Error("requestUrl must be mocked in tests");
}

export class Notice {
  message: string;
  constructor(message: string | DocumentFragment, _timeout?: number) {
    this.message = typeof message === "string" ? message : "fragment";
  }
  hide() {}
}

export class Modal {
  app: unknown;
  contentEl = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement);
  constructor(app: unknown) {
    this.app = app;
  }
  open() {
    this.onOpen();
  }
  close() {
    this.onClose();
  }
  onOpen() {}
  onClose() {}
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement);
  constructor(app: unknown, plugin: unknown) {
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
  addText(_cb: (text: TextComponent) => unknown) { return this; }
  addToggle(_cb: (toggle: ToggleComponent) => unknown) { return this; }
  addDropdown(_cb: (dropdown: DropdownComponent) => unknown) { return this; }
  addButton(_cb: (button: ButtonComponent) => unknown) { return this; }
  addTextArea(_cb: (textarea: TextAreaComponent) => unknown) { return this; }
}

export class TextComponent {
  value = "";
  setPlaceholder(_placeholder: string) { return this; }
  setValue(value: string) { this.value = value; return this; }
  onChange(_cb: (value: string) => void) { return this; }
  inputEl = typeof document !== "undefined" ? document.createElement("input") : ({} as HTMLInputElement);
}

export class ToggleComponent {
  value = false;
  setValue(value: boolean) { this.value = value; return this; }
  onChange(_cb: (value: boolean) => void) { return this; }
}

export class DropdownComponent {
  value = "";
  addOption(_value: string, _display: string) { return this; }
  setValue(value: string) { this.value = value; return this; }
  onChange(_cb: (value: string) => void) { return this; }
}

export class ButtonComponent {
  setButtonText(_text: string) { return this; }
  setCta() { return this; }
  onClick(_cb: () => void) { return this; }
}

export class TextAreaComponent {
  value = "";
  setPlaceholder(_placeholder: string) { return this; }
  setValue(value: string) { this.value = value; return this; }
  onChange(_cb: (value: string) => void) { return this; }
  inputEl = typeof document !== "undefined" ? document.createElement("textarea") : ({} as HTMLTextAreaElement);
}

export class Plugin {
  app: unknown;
  manifest: { id: string; name: string; version: string };

  constructor(app: unknown, manifest: { id: string; name: string; version: string }) {
    this.app = app;
    this.manifest = manifest;
  }

  async onload(): Promise<void> {}
  onunload(): void {}

  addCommand(_command: {
    id: string;
    name: string;
    callback?: () => void;
    checkCallback?: (checking: boolean) => boolean | void;
  }): void {}

  addRibbonIcon(_icon: string, _title: string, _callback: () => void): HTMLElement {
    return typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement);
  }

  addStatusBarItem(): HTMLElement {
    return typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement);
  }

  addSettingTab(_tab: PluginSettingTab): void {}

  registerEvent(_ref: EventRef): void {}
  registerInterval(_id: number): number { return _id; }

  async loadData(): Promise<unknown> { return null; }
  async saveData(_data: unknown): Promise<void> {}
}

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
