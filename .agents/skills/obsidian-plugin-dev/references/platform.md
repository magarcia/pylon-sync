# Platform Considerations

## Platform Detection

```typescript
import { Platform } from "obsidian";

Platform.isMobile    // true on iOS and Android
Platform.isDesktop   // true on Mac, Windows, Linux (Electron)
Platform.isMacOS     // true on macOS desktop
Platform.isWin       // true on Windows
Platform.isLinux     // true on Linux
Platform.isIosApp    // true on iOS
Platform.isAndroidApp // true on Android
Platform.isMobileApp // alias for isMobile
Platform.isDesktopApp // alias for isDesktop
```

## HTTP Requests

**Always use `requestUrl`** — never raw `fetch()`:

```typescript
import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

const response: RequestUrlResponse = await requestUrl({
  url: "https://api.github.com/repos/owner/repo",
  method: "GET",
  headers: {
    Authorization: "token ghp_xxx",
    Accept: "application/vnd.github+json",
  },
  body: JSON.stringify(payload),  // For POST/PUT/PATCH
  throw: false,  // Don't throw on non-2xx (handle yourself)
});

// Response shape
response.status;    // HTTP status code
response.headers;   // Record<string, string>
response.json;      // Parsed JSON body
response.text;      // Raw text body
response.arrayBuffer; // Binary body
```

**Why not `fetch()`?**
- Desktop (Electron): CORS blocks cross-origin requests from `app://obsidian`
- Mobile: `requestUrl` uses native HTTP, more reliable than web `fetch`
- `requestUrl` works identically on all platforms

**Limitations:**
- No streaming responses (entire response buffered in memory)
- iOS requires HTTPS (HTTP fails silently on iOS 17+)
- No WebSocket support — use `requestUrl` polling instead

## Cryptography

Use Web Crypto API (available in all Obsidian runtimes):

```typescript
async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Text(text: string): Promise<string> {
  const encoder = new TextEncoder();
  return sha256(encoder.encode(text).buffer);
}
```

**Do NOT use:**
- `require("crypto")` — Node.js only, fails on mobile
- `Buffer` — Node.js only; use `ArrayBuffer` + `Uint8Array` + `TextEncoder`/`TextDecoder`

## Mobile Lifecycle

iOS kills background processes aggressively (5-30 seconds of background time):

```typescript
// Detect app going to background / returning
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    // App backgrounding — fire last-chance sync
    this.triggerSync();
  }
  if (document.visibilityState === "visible") {
    // App returning — sync to catch up
    this.triggerSync();
  }
});
```

**Mobile sync strategy:**
- No continuous polling (wastes battery, gets killed)
- Sync on: vault events (debounced), app open, app background, manual trigger
- Desktop: can add periodic polling (`registerInterval`)

## Performance on Mobile

- `vault.getFiles()` — fast (cached metadata), ~1ms for 3000 files
- `vault.read()` — disk I/O, ~5-50ms per file on mobile
- `vault.readBinary()` — same, but returns ArrayBuffer
- `crypto.subtle.digest()` — ~1ms per hash on modern mobile
- `requestUrl` — limited by network, same as desktop

**Optimization:**
- Use `file.stat.mtime` for change detection (no disk read)
- Batch file reads, don't read entire vault
- Keep `data.json` small (large JSON.parse is slow on mobile)

## ArrayBuffer Patterns

Since `Buffer` is unavailable:

```typescript
// String → ArrayBuffer
const encoder = new TextEncoder();
const bytes: Uint8Array = encoder.encode("hello");
const buffer: ArrayBuffer = bytes.buffer;

// ArrayBuffer → String
const decoder = new TextDecoder();
const text: string = decoder.decode(buffer);

// Base64 encode (for GitHub API blob uploads)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// Base64 decode
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
```
