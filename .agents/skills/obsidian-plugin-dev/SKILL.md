---
name: obsidian-plugin-dev
description: >
  Obsidian plugin development guide — architecture, API patterns, and conventions.
  TRIGGER when: writing or editing Obsidian plugin source code (TypeScript files importing
  from "obsidian"), creating plugin components (settings tabs, modals, views, commands),
  working with the Vault API, or scaffolding new plugin features.
  DO NOT TRIGGER when: general TypeScript work unrelated to Obsidian, or when only
  debugging/testing/releasing (use sibling skills instead).
user-invocable: false
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
  - Agent
---

# Obsidian Plugin Development

## Plugin Anatomy

```
plugin-root/
├── src/
│   └── main.ts              # Entry point — extends Plugin
├── manifest.json             # Plugin metadata (id, name, version, minAppVersion)
├── package.json              # Node dependencies
├── tsconfig.json             # TypeScript config (target ES2018, module ESNext)
├── esbuild.config.mjs        # Build script
├── styles.css                # Optional plugin styles
└── versions.json             # Maps plugin version → minimum Obsidian version
```

## Entry Point Pattern

```typescript
import { Plugin, PluginSettingTab, Setting, Notice } from "obsidian";

interface MyPluginSettings {
  // Typed settings — never use `any`
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  // Every field has a default
};

export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  async onload() {
    await this.loadSettings();
    // Register everything here — commands, views, events, ribbons
    // Use this.addCommand(), this.registerView(), this.registerEvent()
    // Use this.addSettingTab() for settings UI
  }

  onunload() {
    // Clean up — but most cleanup is automatic via register*() methods
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

## Key API Classes

| Class | Purpose | Reference |
|-------|---------|-----------|
| `Plugin` | Base class — lifecycle, registration | [api-reference.md](references/api-reference.md) |
| `PluginSettingTab` | Settings UI in Obsidian preferences | [api-reference.md](references/api-reference.md) |
| `Modal` | Dialog/popup windows | [api-reference.md](references/api-reference.md) |
| `ItemView` | Custom sidebar/tab views | [api-reference.md](references/api-reference.md) |
| `Notice` | Toast notifications | [api-reference.md](references/api-reference.md) |
| `Vault` | File operations (read, write, create, delete) | [vault-api.md](references/vault-api.md) |
| `Workspace` | Layout, active leaf, events | [api-reference.md](references/api-reference.md) |
| `requestUrl` | HTTP requests (bypasses CORS, works on mobile) | [platform.md](references/platform.md) |

## Registration Pattern

Always use `this.register*()` or `this.addChild()` — Obsidian auto-cleans on unload:

```typescript
// Commands
this.addCommand({
  id: "my-command",
  name: "Do something",
  callback: () => { /* ... */ },
});

// Events — ALWAYS use registerEvent, never raw on()
this.registerEvent(
  this.app.vault.on("modify", (file) => { /* ... */ })
);

// Intervals — use registerInterval, not raw setInterval
this.registerInterval(
  window.setInterval(() => { /* ... */ }, 30000)
);

// DOM events
this.registerDomEvent(document, "click", (evt) => { /* ... */ });

// Ribbon icon
this.addRibbonIcon("sync", "Sync", () => { /* ... */ });

// Status bar
const statusBar = this.addStatusBarItem();
statusBar.setText("Synced");
```

## File Operations

See [vault-api.md](references/vault-api.md) for the complete Vault API reference including:
- Reading/writing text and binary files
- Creating and deleting files
- File metadata and stat access
- The `adapter` API for arbitrary path access
- `plugin.loadData()` / `plugin.saveData()` for plugin state

## Platform Considerations

See [platform.md](references/platform.md) for:
- Mobile compatibility (`Platform.isMobile`, `Platform.isDesktop`)
- `requestUrl` for HTTP (no `fetch` — CORS issues on desktop)
- Web Crypto API instead of Node `crypto`
- `visibilitychange` for mobile lifecycle
- Performance constraints on mobile

## Build System

Standard esbuild config (see [build-system.md](references/build-system.md)):
- Entry: `src/main.ts` → `main.js`
- Format: CommonJS (Obsidian requires it)
- External: `["obsidian", "electron", "@codemirror/*", "@lezer/*"]`
- Target: `es2018`
- Bundle everything except externals into single `main.js`

## Conventions

1. **One plugin class** — `export default class` extending `Plugin`
2. **Settings always typed** — interface + defaults + `Object.assign` merge
3. **Register everything** — never manage cleanup manually
4. **`requestUrl` over `fetch`** — works cross-platform, bypasses CORS
5. **`crypto.subtle` over Node crypto** — works in Obsidian's runtime
6. **No Node.js builtins** — no `fs`, `path`, `crypto`, `Buffer` (use `ArrayBuffer`)
7. **Vault API over adapter** — prefer `vault.read()` over `vault.adapter.read()` for tracked files
8. **Minimum version** — set `minAppVersion` in manifest.json to the oldest supported version
