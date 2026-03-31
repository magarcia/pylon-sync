# Vault API Reference

The `Vault` class is the primary interface for file operations. Access via `this.app.vault`.

## Reading Files

```typescript
// Text content
const content: string = await vault.read(file);

// Binary content
const buffer: ArrayBuffer = await vault.readBinary(file);

// Cached read (returns last-known content, may be stale)
const cached: string = await vault.cachedRead(file);
```

## Writing Files

```typescript
// Modify existing text file
await vault.modify(file, "new content");

// Modify existing binary file
await vault.modifyBinary(file, arrayBuffer);

// Create new text file (parent dirs created automatically)
const newFile: TFile = await vault.create("path/to/new.md", "content");

// Create new binary file
const newFile: TFile = await vault.createBinary("path/to/image.png", arrayBuffer);

// Append to file
await vault.append(file, "\nappended text");

// Process file (read-modify-write atomically)
await vault.process(file, (content) => {
  return content.replace("old", "new");
});
```

## Deleting Files

```typescript
// Move to Obsidian trash (.trash/ folder)
await vault.trash(file, false);

// Move to system trash
await vault.trash(file, true);

// Delete permanently (no trash)
await vault.delete(file);
```

## File Discovery

```typescript
// All files in vault (TFile[]) — excludes dot-directories
const allFiles: TFile[] = vault.getFiles();

// All markdown files
const mdFiles: TFile[] = vault.getMarkdownFiles();

// Get specific file by path (returns null if not found)
const file: TFile | null = vault.getFileByPath("notes/hello.md");

// Get folder
const folder: TFolder | null = vault.getFolderByPath("notes");

// Get abstract file (TFile or TFolder)
const abstract: TAbstractFile | null = vault.getAbstractFileByPath("notes");
```

## File Metadata

```typescript
// TFile properties (from cached metadata — no disk read)
file.path      // "notes/hello.md"
file.name      // "hello.md"
file.basename  // "hello"
file.extension // "md"
file.parent    // TFolder | null
file.stat.mtime // Last modified timestamp (ms)
file.stat.ctime // Created timestamp (ms)
file.stat.size  // File size (bytes)
```

## Folder Operations

```typescript
// Create folder
await vault.createFolder("new-folder/subfolder");

// Rename/move file or folder
await vault.rename(file, "new/path/file.md");

// Copy file
await vault.copy(file, "destination/copy.md");
```

## Adapter (Low-Level Access)

The adapter provides direct filesystem access, including dot-directories that `vault.getFiles()` skips:

```typescript
const adapter = vault.adapter;

// Check existence
const exists: boolean = await adapter.exists("path");

// Read/write outside vault tracking
const content: string = await adapter.read("path");
await adapter.write("path", "content");

// Binary
const buffer: ArrayBuffer = await adapter.readBinary("path");
await adapter.writeBinary("path", buffer);

// List directory
const listing = await adapter.list("folder");
// { files: string[], folders: string[] }

// Delete
await adapter.remove("path");

// Stat
const stat = await adapter.stat("path");
// { type: "file"|"folder", ctime: number, mtime: number, size: number } | null
```

**When to use adapter vs vault:**
- Use `vault.*` for user-visible files (markdown, attachments)
- Use `adapter.*` for plugin metadata, hidden files, dot-directories
- `vault.getFiles()` does NOT include `.obsidian/` — use adapter for those

## Plugin Data Storage

```typescript
// Save plugin data to .obsidian/plugins/{plugin-id}/data.json
await plugin.saveData(data);

// Load plugin data
const data = await plugin.loadData();
// Returns null on first load (no data.json yet)

// Pattern: typed settings with defaults
interface Settings { token: string; interval: number; }
const DEFAULTS: Settings = { token: "", interval: 30000 };

async loadSettings(): Promise<Settings> {
  return Object.assign({}, DEFAULTS, await this.loadData());
}
```

## Vault Events

```typescript
// File modified
this.registerEvent(vault.on("modify", (file: TFile) => {}));

// File created
this.registerEvent(vault.on("create", (file: TAbstractFile) => {}));

// File deleted
this.registerEvent(vault.on("delete", (file: TAbstractFile) => {}));

// File renamed/moved
this.registerEvent(vault.on("rename", (file: TAbstractFile, oldPath: string) => {}));
```

All events fire on both desktop and mobile platforms.
