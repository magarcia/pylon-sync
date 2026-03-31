---
name: obsidian-plugin-debug
description: >
  Obsidian plugin debugging and troubleshooting guide. TRIGGER when: diagnosing
  plugin errors, investigating unexpected behavior, fixing runtime issues, analyzing
  console errors from Obsidian, or when the user mentions DevTools, console errors,
  plugin crashes, or mobile debugging. Also triggers on performance profiling and
  memory leak investigation in Obsidian plugins.
user-invocable: false
allowed-tools:
  - Read
  - Edit
  - Grep
  - Glob
  - Bash
  - Agent
---

# Obsidian Plugin Debugging

## DevTools Access

| Platform | How to Open |
|----------|-------------|
| Desktop (Mac) | `Cmd+Option+I` or View → Toggle Developer Tools |
| Desktop (Win/Linux) | `Ctrl+Shift+I` |
| Mobile | Not directly available — use `console.log` + desktop Vault copy |

## Common Error Patterns

### 1. Plugin Fails to Load

**Symptoms:** Plugin doesn't appear, "Failed to load plugin" notice.

```
Check:
1. manifest.json — valid JSON? id matches directory name?
2. main.js — exists and is valid JS? (build may have failed)
3. minAppVersion — is user's Obsidian version >= this?
4. Default export — does main.ts `export default class ... extends Plugin`?
5. onload() — any synchronous throw before first await?
```

### 2. "Cannot read properties of undefined"

Almost always: accessing something before it's initialized or after it's destroyed.

```typescript
// BAD: accessing workspace before layout ready
async onload() {
  const leaf = this.app.workspace.activeLeaf; // may be null during startup
}

// GOOD: wait for layout
async onload() {
  this.app.workspace.onLayoutReady(() => {
    const leaf = this.app.workspace.activeLeaf;
  });
}
```

### 3. Mobile-Only Failures

See [mobile-debugging.md](references/mobile-debugging.md) for:
- Common mobile-specific failures
- Debugging without DevTools
- iOS/Android platform differences
- `requestUrl` HTTPS requirement on iOS

### 4. Memory Leaks

```typescript
// BAD: event listener not cleaned up
onload() {
  document.addEventListener("click", this.handler);
}

// GOOD: use registerDomEvent for auto-cleanup
onload() {
  this.registerDomEvent(document, "click", this.handler);
}
```

Always use `this.register*()` methods. Manual listeners leak on plugin disable/enable cycles.

### 5. Race Conditions in Sync/Async

```typescript
// BAD: concurrent syncs corrupt state
async triggerSync() {
  const data = await this.loadData();
  // ... another sync starts here, reads stale data
  await this.saveData(data);
}

// GOOD: serialize with a lock
private syncing = false;
async triggerSync() {
  if (this.syncing) return;
  this.syncing = true;
  try {
    // ... safe to read/write
  } finally {
    this.syncing = false;
  }
}
```

### 6. File Operation Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "File already exists" | `vault.create()` on existing file | Use `vault.modify()` or check with `vault.getFileByPath()` first |
| "File not found" | `vault.modify()` on non-existent file | Use `vault.create()` or check existence first |
| "Cannot delete" | File is open in editor | Close leaf first or use `vault.trash()` |
| Empty file after write | Writing empty string | Check content is not undefined/null |

### 7. API Deprecation Warnings

Check console for deprecation warnings. Common ones:

| Deprecated | Use Instead |
|-----------|-------------|
| `vault.adapter.exists()` | `vault.getFileByPath()` returns `null` if missing |
| `Vault.recurseChildren()` | `vault.getFiles()` + filter |
| `workspace.activeLeaf` | `workspace.getActiveViewOfType()` |
| `FileSystemAdapter` direct use | `vault.adapter` with type narrowing |

## Debugging Workflow

1. **Reproduce** — get exact steps, note if mobile-only or desktop-only
2. **Console first** — check DevTools console for errors and stack traces
3. **Isolate** — disable other plugins to rule out conflicts (`Safe Mode`)
4. **Narrow** — add `console.log` at key points (onload, event handlers, API calls)
5. **Check API version** — is `minAppVersion` correct for APIs used?
6. **Test both platforms** — desktop works != mobile works

## Performance Debugging

```typescript
// Time operations
console.time("scan");
const files = this.app.vault.getFiles();
console.timeEnd("scan");

// Profile in DevTools
// Performance tab → Record → trigger action → Stop → analyze flame chart

// Watch for:
// - getFiles() iterating entire vault on every event
// - Reading file contents unnecessarily (use mtime pre-filter)
// - Synchronous operations blocking the UI thread
// - Large JSON.parse/stringify on plugin data
```

## Useful DevTools Commands

```javascript
// In Obsidian's DevTools console:
app.vault.getFiles().length                    // Total file count
app.plugins.plugins["your-plugin-id"]          // Access plugin instance
app.plugins.plugins["your-plugin-id"].settings // Inspect settings
app.workspace.activeLeaf?.view                 // Current view
app.vault.adapter                              // FileSystem adapter
```
