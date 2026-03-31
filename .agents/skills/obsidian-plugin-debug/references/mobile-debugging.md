# Mobile Debugging

## The Challenge

Mobile Obsidian (iOS/Android) has no DevTools. Debugging requires indirect approaches.

## Strategies

### 1. Desktop-First Development

Most bugs reproduce on desktop. Always try desktop first:
- Desktop uses the same Vault API, same `requestUrl`, same plugin lifecycle
- Only mobile-specific issues need mobile testing

### 2. Console Logging with Notice

Use `Notice` as a visible console on mobile:

```typescript
function debugNotice(msg: string) {
  if (Platform.isMobile) {
    new Notice(`[DEBUG] ${msg}`, 10000);
  }
  console.log(`[DEBUG] ${msg}`);
}
```

### 3. File-Based Logging

Write debug logs to a file in the vault:

```typescript
class DebugLogger {
  private plugin: Plugin;
  private logPath = "debug-log.md";

  async log(msg: string) {
    const timestamp = new Date().toISOString();
    const line = `${timestamp}: ${msg}\n`;

    const file = this.plugin.app.vault.getFileByPath(this.logPath);
    if (file) {
      await this.plugin.app.vault.append(file, line);
    } else {
      await this.plugin.app.vault.create(this.logPath, `# Debug Log\n\n${line}`);
    }
  }
}
```

### 4. Remote Debugging (Android)

Android supports Chrome DevTools remote debugging:
1. Enable USB debugging on Android device
2. Connect via USB
3. Open `chrome://inspect` in Chrome on desktop
4. Obsidian's webview should appear (may require Obsidian debug mode)

iOS has no equivalent — use strategies 2-3 instead.

## Common Mobile-Only Failures

### requestUrl HTTPS Requirement

```typescript
// FAILS on iOS 17+ — HTTP blocked
await requestUrl({ url: "http://example.com/api" });

// WORKS — always use HTTPS
await requestUrl({ url: "https://example.com/api" });
```

### Large File Operations

Mobile has less RAM. Operations that work on desktop may OOM:

```typescript
// RISKY: reading a 50MB file into memory on mobile
const buffer = await vault.readBinary(largeFile);

// SAFER: check size first
if (file.stat.size > 50 * 1024 * 1024) {
  new Notice("File too large for mobile sync");
  return;
}
```

### Background Execution

```typescript
// BROKEN: long-running operation gets killed on mobile
async onload() {
  setInterval(() => this.heavySync(), 10000); // iOS kills this
}

// CORRECT: event-driven, short operations
async onload() {
  if (Platform.isMobile) {
    // No polling — sync on events only
    this.registerEvent(this.app.vault.on("modify", () => this.debouncedSync()));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.triggerSync();
    });
  }
}
```

### Missing Node.js APIs

```typescript
// FAILS on mobile:
import { readFileSync } from "fs";     // No fs module
import { createHash } from "crypto";    // No crypto module
Buffer.from("text");                    // No Buffer global

// WORKS on all platforms:
await vault.read(file);                           // Vault API
await crypto.subtle.digest("SHA-256", data);       // Web Crypto
new TextEncoder().encode("text");                  // Web API
```

### Platform-Specific Paths

```typescript
// File paths use forward slashes on ALL platforms in Obsidian
// Obsidian normalizes paths internally
const path = "notes/subfolder/file.md"; // Always forward slashes
```

## Testing on Mobile

1. Build plugin: `npm run build`
2. Copy `main.js`, `manifest.json`, `styles.css` to mobile vault
   - Via Obsidian Sync, iCloud, Google Drive, or manual transfer
   - Place in `.obsidian/plugins/your-plugin-id/`
3. Restart Obsidian mobile
4. Enable plugin in Settings → Community Plugins

**Faster workflow:** Use BRAT plugin for beta testing — create a GitHub Release, then install via BRAT on mobile.
