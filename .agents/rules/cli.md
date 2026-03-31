---
paths:
  - "packages/cli/**/*.ts"
---

# CLI Rules

- Entry point: `src/main.ts` with manual flag parsing (`getFlag` helper)
- Commands: `init`, `sync`, `status`, `--help`, `--version`
- Token: stored in OS keychain via `cross-keychain`, NOT in config file
- Token fallback: `GITHUB_TOKEN` env var → keychain → error
- Config: `.pylon/config.json` stores repo + branch only (no token)
- Data: `.pylon/data.json` stores snapshot + cursor
- `.pylon/` auto-added to `.gitignore` on init
- `NodeFileSystem.safePath()` prevents path traversal on all read/write/delete
- `NodeFileSystem.assertNotSymlink()` prevents symlink attacks on writes
- `NodeFileSystem.walk()` skips `.pylon` and `.git` dirs only — other dotfiles pass through to `isTrackedPath`
- Error messages should be user-friendly — `loadConfig` throws "Not initialized" instead of raw ENOENT
