# Obsidian API Reference

## Plugin Lifecycle

```typescript
export default class MyPlugin extends Plugin {
  // Called when plugin is enabled
  async onload(): Promise<void>

  // Called when plugin is disabled — auto-cleans register*() items
  onunload(): void

  // One-time setup after first user installation (v1.7.2+)
  onUserEnable(): void

  // React to externally modified settings (v1.5.7+)
  onExternalSettingsChange(): void
}
```

### Secure Storage (for tokens/secrets)

```typescript
// Store securely (uses platform keychain on mobile)
await this.app.secretStorage.setPassword("github-token", token);

// Retrieve
const token = await this.app.secretStorage.getPassword("github-token");

// Remove
await this.app.secretStorage.removePassword("github-token");
```

## Plugin Class Methods

### Commands

```typescript
this.addCommand({
  id: "unique-command-id",        // Unique within plugin
  name: "Human-readable name",    // Shown in command palette
  callback: () => void,           // For commands without editor context
  editorCallback: (editor: Editor, view: MarkdownView) => void,  // For editor commands
  checkCallback: (checking: boolean) => boolean | void,  // Conditional availability
  hotkeys: [{ modifiers: ["Mod"], key: "s" }],  // Default hotkey (user can override)
});
```

### Views

```typescript
// Register a custom view type
this.registerView(VIEW_TYPE_ID, (leaf) => new MyView(leaf));

// Open the view
this.app.workspace.getLeaf("split").setViewState({
  type: VIEW_TYPE_ID,
  active: true,
});

// Custom view class
class MyView extends ItemView {
  getViewType(): string { return VIEW_TYPE_ID; }
  getDisplayText(): string { return "My View"; }
  getIcon(): string { return "file-text"; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl("h4", { text: "My View" });
  }

  async onClose(): Promise<void> {
    // Cleanup
  }
}
```

### Settings Tab

```typescript
class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Setting name")
      .setDesc("Description shown below")
      .addText((text) =>
        text
          .setPlaceholder("placeholder")
          .setValue(this.plugin.settings.myField)
          .onChange(async (value) => {
            this.plugin.settings.myField = value;
            await this.plugin.saveSettings();
          })
      );

    // Toggle
    new Setting(containerEl)
      .setName("Enable feature")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
        })
      );

    // Dropdown
    new Setting(containerEl)
      .setName("Choose option")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("a", "Option A")
          .addOption("b", "Option B")
          .setValue(this.plugin.settings.choice)
          .onChange(async (value) => {
            this.plugin.settings.choice = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

// Register in onload():
this.addSettingTab(new MySettingTab(this.app, this));
```

### Modal

```typescript
class MyModal extends Modal {
  result: string;
  onSubmit: (result: string) => void;

  constructor(app: App, onSubmit: (result: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Enter value" });

    new Setting(contentEl).setName("Name").addText((text) =>
      text.onChange((value) => { this.result = value; })
    );

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Submit").setCta().onClick(() => {
        this.close();
        this.onSubmit(this.result);
      })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Usage:
new MyModal(this.app, (result) => { /* handle result */ }).open();
```

## Notice (Toast)

```typescript
new Notice("Short message");                    // Auto-dismiss after ~4s
new Notice("Persistent message", 0);            // Stays until clicked
new Notice("Timed message", 10000);             // 10 seconds

// With fragment for rich content
const frag = document.createDocumentFragment();
frag.createEl("strong", { text: "Bold " });
frag.appendText("and normal");
new Notice(frag);
```

## Workspace

```typescript
// Get active file
const file = this.app.workspace.getActiveFile();

// Get active editor
const editor = this.app.workspace.activeEditor?.editor;

// Get active view of specific type
const view = this.app.workspace.getActiveViewOfType(MarkdownView);

// Open a file
const leaf = this.app.workspace.getLeaf(false); // false = reuse, true = new tab
await leaf.openFile(file);

// Layout ready (use in onload for workspace-dependent init)
this.app.workspace.onLayoutReady(() => { /* workspace is ready */ });

// Events
this.registerEvent(
  this.app.workspace.on("file-open", (file) => { /* file opened */ })
);
this.registerEvent(
  this.app.workspace.on("active-leaf-change", (leaf) => { /* leaf changed */ })
);
```

## Markdown Processing

```typescript
// Render markdown to HTML
await MarkdownRenderer.render(
  this.app,
  "# Hello **world**",
  containerEl,
  "",       // source path for link resolution
  this      // component for lifecycle management
);

// Read frontmatter (read-only, from cache)
const file = this.app.vault.getFileByPath("note.md");
if (file) {
  const cache = this.app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter;
}

// Modify frontmatter (atomic read-modify-write)
await this.app.fileManager.processFrontMatter(file, (fm) => {
  fm.synced = true;
  fm.lastSync = Date.now();
});
```

## FuzzySuggestModal

Searchable list for user selection:

```typescript
class FileSuggestModal extends FuzzySuggestModal<TFile> {
  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
    new Notice(`Selected: ${file.path}`);
  }
}

// Usage:
new FileSuggestModal(this.app).open();
```

## Events Reference

### Vault Events
- `create` — file/folder created
- `modify` — file content changed
- `delete` — file/folder deleted
- `rename` — file/folder renamed (receives old path)

### Workspace Events
- `file-open` — file opened in any leaf
- `active-leaf-change` — active leaf changed
- `layout-change` — layout structure changed
- `css-change` — theme/CSS changed

### MetadataCache Events
- `changed` — metadata cache for a file updated
- `resolve` — all metadata resolved after startup
