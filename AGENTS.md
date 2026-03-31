# Pylon Sync — Agent Instructions

## Project

pnpm monorepo with 4 packages syncing files to GitHub via REST API. No git binary.

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@pylon-sync/core` | `packages/core/` | Platform-agnostic sync engine, reconciler, types |
| `@pylon-sync/provider-github` | `packages/provider-github/` | GitHub provider (git-tree comparison, opaque cursor) |
| `@pylon-sync/cli` | `packages/cli/` | CLI companion (Node.js fs + cross-keychain) |
| `pylon-sync` | `packages/obsidian-plugin/` | Obsidian plugin (Vault API + SecretStorage) |

## Commands

```sh
pnpm install                    # Install all dependencies
pnpm -r test                    # Run all tests (252 tests)
pnpm -r run typecheck           # Type check all packages
cd packages/obsidian-plugin && node esbuild.config.mjs production  # Build plugin
```

Single package:
```sh
cd packages/core && npx vitest run              # Core tests only
cd packages/provider-github && npx vitest run   # Provider tests only
cd packages/cli && npx vitest run               # CLI tests only
cd packages/obsidian-plugin && npx vitest run   # Plugin tests only
```

## Architecture

- **Provider interface** with opaque `SyncCursor` — core never inspects cursor contents
- **FileSystem interface** abstracts Vault API (plugin) and Node fs (CLI)
- **HttpClient interface** abstracts requestUrl (plugin) and fetch (CLI)
- No metadata files stored in the GitHub repo — uses git tree comparison
- Three-way text merge via diff-match-patch; binary conflicts via last-modified-wins
- ZIP archive download for first sync (single API call instead of per-file)

## Code Rules

- TypeScript strict mode with `noUncheckedIndexedAccess`
- No `any` — use `unknown` with type guards. `as any` only for untyped Obsidian internals (wrap in try/catch)
- No `as` casts on API responses — define named response types
- `readonly` on data interfaces (FileEntry, SnapshotEntry, SyncResult)
- Comments explain "why", never "what"
- Error classes: `ProviderError` + `PushConflictError` in core; `GitHubApiError` + `RateLimitError` in provider-github
- Shared defaults: import `DEFAULT_SYNC_SETTINGS` from `@pylon-sync/core`, don't duplicate

## Testing

- vitest with `globals: true` across all packages
- Test behavior, not implementation — no coupling to internal function signatures
- Mock at module boundaries (`vi.mock`), not individual functions
- Use `MockFileSystem` (core) or `Vault` mock (plugin) for filesystem tests
- Use `as any` for mock-only helpers (`_seed`, `_getContent`, `_clear`)
- Non-null assertions (`!`) are acceptable in test files for array/map access
- New features require tests before implementation (TDD)

## What Not To Do

- Don't import from `"obsidian"` in core or provider-github — those are platform-agnostic
- Don't store tokens in `data.json` — plugin uses SecretStorage, CLI uses cross-keychain
- Don't filter dotfiles in the provider — let core's `isTrackedPath` decide
- Don't use `unzipSync` — use async `unzip` to avoid blocking the main thread
- Don't call `initSync()` on every settings keystroke — check if credentials actually changed
- Don't delete files without the safety check (refuse bulk deletes > 50% of snapshot)
