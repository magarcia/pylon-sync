---
paths:
  - "packages/obsidian-plugin/**/*.ts"
---

# Obsidian Plugin Rules

- `vault.getFiles()` excludes dotfiles — use `vault.adapter.list()` for `.obsidian/` files
- `requestUrl` is the ONLY way to make HTTP requests (no `fetch`, no `XMLHttpRequest`)
- `requestUrl` response `.json` auto-parses — wrap in try/catch for non-JSON responses
- Token stored via `app.secretStorage` (v1.11.4+) with `app.loadLocalStorage` fallback — NEVER in `data.json`
- `registerEvent()` for vault events — auto-cleaned on plugin unload
- `registerInterval()` for timers — but also track the ID for manual cleanup in `teardownSync()`
- `document.addEventListener` must be manually removed in `onunload()` — store the handler reference
- Settings tab `onChange` fires on every keystroke — only call `initSync()` when credentials actually change
- Event suppression: populate `applyingPaths` Set before `applyMutations`, check in event handlers, clear in `finally`
- Plugin build: esbuild with CJS output, `obsidian` external. Cannot use Vite/Rollup.
- The mock at `test/mocks/obsidian.ts` provides Vault, TFile, TFolder, DataAdapter, Notice, Setting, Platform
