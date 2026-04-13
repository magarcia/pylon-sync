# Pylon Sync

> **Early Alpha (v0.0.1)** -- This project is in early alpha and under active development. It has **not** been publicly released or reviewed. Use it only on a **test vault with no real data**. Sync, merge, and conflict resolution have known edge cases that may cause data loss. **Always keep a separate backup of any vault you test with.** Expect breaking changes between versions.

Sync files to remote storage using provider APIs directly -- no git binary needed. Available as an Obsidian plugin (desktop and mobile) and a standalone CLI. Supports GitHub and S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2).

## Features

- **Sign in with GitHub** -- one-click OAuth via the Pylon Sync GitHub App; no tokens to manage, per-repo permissions, auto-refreshing credentials
- **API-only transport** -- uses provider REST APIs directly (GitHub, S3-compatible), no native dependencies
- **Cross-platform** -- Obsidian plugin works identically on Desktop (Electron), iOS, and Android
- **Three-way text merge** -- concurrent edits to the same file are merged automatically using diff-match-patch
- **Incremental sync** -- mtime pre-filtering and snapshot-based change detection keep syncs fast
- **Binary file support** -- images and attachments sync with configurable conflict resolution (newest, local, or remote wins)
- **Automatic sync** -- debounced vault events trigger sync; polling on desktop, visibility events on mobile
- **Configurable ignore patterns** -- glob-based rules to exclude files from sync
- **GitHub Enterprise Server** -- supports custom hosts via PAT; device flow available with a self-registered GitHub App

## Packages

> The project codename is "Pylon Sync". The Obsidian plugin appears as "Pylon Sync" in the community plugins list. The npm scope is `@pylon-sync`.

This is a monorepo with six packages:

| Package | Description |
|---------|-------------|
| `@pylon-sync/core` | Platform-agnostic sync engine, reconciler, scanner, types |
| `@pylon-sync/auth-github` | GitHub App OAuth device flow, token refresh, host resolution |
| `@pylon-sync/provider-github` | GitHub provider using git-tree comparison (no metadata files in repo) |
| `@pylon-sync/provider-s3` | S3-compatible storage provider (AWS S3, Cloudflare R2, MinIO, Backblaze B2) |
| `@pylon-sync/cli` | CLI companion -- sync directories from the terminal |
| `pylon-sync` | Obsidian plugin with vault integration and settings UI |

## CLI

The CLI companion syncs any directory to GitHub using the same engine as the Obsidian plugin.

### Install

The CLI is not yet published to npm. To use it, clone the repository and run directly:

```sh
cd packages/cli && npx tsx src/main.ts init --repo owner/repo --token ghp_... [--branch main]
```

### Commands

| Command | Description |
|---------|-------------|
| `pylon init --repo owner/repo --token TOKEN [--branch main]` | Initialize sync in current directory |
| `pylon sync [--full-scan]` | Run one sync cycle |
| `pylon status` | Show local changes since last sync |

The token can also be set via `GITHUB_TOKEN` environment variable.

## Obsidian Plugin

### Installation

#### BRAT (recommended for beta testing)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian community plugins
2. Open BRAT settings and click "Add Beta Plugin"
3. Enter `magarcia/pylon-sync`
4. BRAT will install the plugin and keep it updated automatically

#### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/magarcia/pylon-sync/releases/latest)
2. Create the plugin directory: `<your-vault>/.obsidian/plugins/pylon-sync/`
3. Copy the three files into that directory
4. Open Obsidian Settings > Community Plugins > enable "Pylon Sync"

### Setup

There are two ways to authenticate with GitHub. **Sign in with GitHub** is the recommended default.

#### Option A: Sign in with GitHub (recommended)

This uses the [Pylon Sync GitHub App](https://github.com/apps/pylon-sync) with OAuth device flow. The app only requests **Contents: Read and write** permission, scoped to the repositories you choose during installation.

1. Open Obsidian Settings > Pylon Sync
2. Make sure **Authentication** is set to **Sign in with GitHub**
3. Click **Sign in with GitHub**
4. A modal appears with a one-time code. Click **Copy code**, then click **Open GitHub**
5. Paste the code on the GitHub page and authorize the app
6. The modal closes automatically once authorized
7. If you haven't already, click **Install Pylon Sync** to install the GitHub App on the repository you want to sync with (or go to [github.com/apps/pylon-sync/installations/new](https://github.com/apps/pylon-sync/installations/new))
8. Click **Refresh** to load your installations, then pick a repository from the dropdown
9. Set the branch (default: `main`) and enable "Auto sync"

The repository dropdown only shows repos you explicitly granted the app access to, so there is no risk of accidentally syncing to the wrong repo. The access token refreshes automatically (8-hour tokens with a 6-month refresh token). If the refresh token expires, the plugin prompts you to sign in again.

#### Option B: Personal Access Token

Use this if you prefer managing tokens yourself, or if you use GitHub Enterprise Server where the Pylon Sync App is not available.

1. Go to [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta) (fine-grained tokens)
2. Click "Generate new token"
3. Name it something like "Obsidian Vault Sync"
4. Set the expiration as needed
5. Under **Repository access**, select the specific repository you want to sync to
6. Under **Permissions > Repository permissions**, set **Contents** to **Read and write**
7. Click "Generate token" and copy it
8. Open Obsidian Settings > Pylon Sync
9. Set **Authentication** to **Personal access token**
10. Paste your token into the **GitHub Token** field
11. Enter your repository in `owner/repo` format (e.g., `magarcia/my-vault`)
12. Set the branch (default: `main`)
13. Enable "Auto sync" if you want automatic syncing

The settings tab includes a **Verify** button to test your token, a **Browse** dropdown to select from your repositories, and a **Load branches** dropdown to pick a branch.

#### First sync

If the repository does not exist yet, the plugin auto-creates it as a private repo on first sync. The plugin syncs immediately on first setup, pushing your vault to the repo (or pulling from it if the repo already has content). The first sync uses a ZIP archive download for fast bulk retrieval of existing files.

## How It Works

The sync engine uses a snapshot-based model with provider-specific remote change detection. The engine communicates with remote storage through a pluggable `Provider` interface, decoupling it from any specific backend. The GitHub provider uses git tree comparison via the Git Data API; the S3 provider uses object listing with ETag comparison. Each sync cycle:

1. **Scan** -- detect local changes by comparing file hashes against the last-known snapshot
2. **Fetch** -- detect remote changes by comparing git trees between the last-synced commit and current HEAD. If HEAD hasn't moved, there are no remote changes. Otherwise the engine fetches both trees and diffs them to find added, modified, and deleted files.
3. **Reconcile** -- produce a set of mutations by merging local and remote change sets. Text files use three-way merge (base content fetched on-demand from git); binary files use last-modified-wins
4. **Push** -- send file changes to GitHub via the Git Data API (blobs, trees, commits, refs)
5. **Apply** -- write remote changes to the local filesystem
6. **Update snapshot** -- persist the new snapshot and cursor for the next cycle

Because the GitHub provider compares git trees directly, external modifications to the repository are automatically detected. GitHub Actions, the web editor, pull requests, or any other tool that creates commits will be picked up on the next sync cycle. The S3 provider similarly detects external changes by comparing object ETags against its stored manifest.

All provider communication goes through a pluggable `HttpClient` abstraction. The Obsidian plugin uses `requestUrl` (which handles HTTPS on every platform and bypasses CORS); the CLI uses standard `fetch`.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Authentication | Sign in with GitHub | Choose between GitHub App OAuth or personal access token. |
| Repository | -- | Target repo in `owner/repo` format. With GitHub App auth, a dropdown shows only repos the app is installed on. |
| Branch | `main` | Branch to sync with. |
| Auto sync | On | Sync automatically on file changes. |
| Poll interval | 5m | How often to check for remote changes (desktop only). |
| Debounce delay | 30s | Wait time after last edit before syncing. |
| Sync .obsidian/ settings | Off | Include `.obsidian/` config files. Excludes `workspace.json`, `workspace-mobile.json`, and `cache/` regardless. |
| Ignore patterns | -- | Glob patterns, one per line. Matched files are excluded from sync. |
| Include hidden paths | -- | Dot-files or dot-folders (e.g. `.claude`, `.github`) to include in sync, one per line. |
| Binary conflict resolution | newest | How to resolve concurrent binary edits: `newest`, `local`, or `remote`. |
| Full scan interval | 50 | Run a full hash scan (ignoring mtime) every N syncs. Catches files with stale timestamps. |
| Commit message | `vault: sync` | Message used for commits pushed to GitHub. |

**Advanced settings** (collapsed by default):

| Setting | Default | Description |
|---------|---------|-------------|
| GitHub host | `github.com` | Override for GitHub Enterprise Server or data-residency instances. |
| Custom GitHub App client ID | -- | For users who register their own GitHub App on a GHES instance. Enables device flow on non-github.com hosts. |

## Platform Support

The Obsidian plugin works identically on all platforms Obsidian supports:

- **Desktop** (macOS, Windows, Linux) -- uses polling interval for periodic sync
- **iOS** -- syncs on app open and before backgrounding via visibility change events
- **Android** -- same as iOS

No platform-specific code or native dependencies.

## Security

All credentials are stored securely using Obsidian's SecretStorage API (OS keychain on desktop) with Obsidian's internal local storage as a fallback for older versions. Credentials are **never** written to `data.json` or any file in the vault.

**GitHub App OAuth (default):**

- OAuth tokens (access + refresh) are stored in SecretStorage, outside the vault filesystem
- Access tokens expire after 8 hours and refresh automatically
- Refresh tokens expire after 6 months; the plugin prompts you to sign in again when this happens
- The Pylon Sync GitHub App only requests **Contents: Read and write** permission
- You control which repositories the app can access via GitHub's installation settings
- The app's public `client_id` is embedded in the plugin source; no client secret is needed for device flow (by design)
- Device flow uses the standard [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628) protocol

**Personal Access Token:**

- Token is stored outside the vault filesystem; cloud sync (iCloud, Dropbox) cannot access it
- Obsidian Sync does not sync the token
- Git-based tools cannot commit the token
- Use a **fine-grained** token scoped to a single repository with only Contents read/write permission
- Set an **expiration date** on your token

The CLI stores the token in the OS keychain via [cross-keychain](https://www.npmjs.com/package/cross-keychain) (macOS Keychain, Windows Credential Manager, Linux libsecret). The token is never written to the config file.

## Rate Limits

A typical sync cycle uses ~7 GitHub API requests (for text-only changes). With the default 5-minute poll interval, that is roughly 84 requests per hour -- well under the 5,000 requests/hour limit for authenticated users.

If you hit a rate limit, the plugin displays a notice with the reset time and backs off automatically.

## Obsidian Commands

| Command | Description |
|---------|-------------|
| **Sync with GitHub** | Trigger an immediate sync |
| **Force full scan** | Sync with a full hash scan, ignoring mtime pre-filtering |
| **Reset sync data** | Clear snapshot and cursor to start fresh |

All three are available from the Command Palette. The ribbon icon (refresh arrow) triggers an immediate sync -- it animates while a sync is in progress. During sync, a progress notice shows the current step (scanning, fetching, reconciling, etc.). The status bar displays per-file sync indicators: checkmark for synced, dot for modified, plus for new.

## Development

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Setup

```sh
pnpm install
```

### Scripts

```sh
# Run all tests
pnpm -r test

# Type check all packages
pnpm -r run typecheck

# Build Obsidian plugin
cd packages/obsidian-plugin && npm run build

# Run specific package tests
cd packages/core && npx vitest run
cd packages/provider-github && npx vitest run
cd packages/provider-s3 && npx vitest run
cd packages/cli && npx vitest run
```

### Plugin Development

To test changes in Obsidian:

1. Build the plugin in watch mode:
   ```sh
   cd packages/obsidian-plugin && npm run dev
   ```

2. Create a symlink from your vault to the build output:
   ```sh
   ln -s /path/to/pylon-sync/packages/obsidian-plugin /path/to/vault/.obsidian/plugins/pylon-sync
   ```

3. In Obsidian, enable the plugin and open the Developer Console (Ctrl+Shift+I) for logs.

4. Changes to any package are picked up automatically by esbuild's watch mode.

## License

MIT
