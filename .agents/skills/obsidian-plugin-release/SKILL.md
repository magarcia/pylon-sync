---
name: obsidian-plugin-release
description: >
  Obsidian plugin distribution, publishing, and release management. TRIGGER when:
  preparing a plugin release, publishing to the Obsidian community plugin list,
  setting up GitHub Actions for automated releases, creating manifest.json or
  versions.json, submitting a plugin for review, managing BRAT beta releases,
  or when the user asks about plugin distribution, versioning, or the review process.
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
  - Agent
---

# Obsidian Plugin Release & Distribution

## Release Artifacts

Every release needs exactly 3 files attached to a GitHub Release:

| File | Purpose |
|------|---------|
| `main.js` | Bundled plugin code (esbuild output) |
| `manifest.json` | Plugin metadata (copied from repo root) |
| `styles.css` | Plugin styles (optional — only if used) |

## manifest.json

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "What your plugin does",
  "author": "Your Name",
  "authorUrl": "https://github.com/you",
  "fundingUrl": "https://buymeacoffee.com/you",
  "isDesktopOnly": false
}
```

**Rules:**
- `id` must match the directory name in `.obsidian/plugins/`
- `id` must be lowercase, hyphens only, no spaces, **cannot contain "obsidian"**
- `version` must follow semver
- **Git tag must exactly match version** (e.g., `1.0.0`, NOT `v1.0.0`)
- `minAppVersion` — set to oldest Obsidian version that supports all APIs you use
- `isDesktopOnly` — set `true` only if plugin uses Electron/Node APIs

## versions.json

Maps each plugin version to the minimum Obsidian version it requires:

```json
{
  "1.0.0": "1.0.0",
  "1.1.0": "1.2.0",
  "2.0.0": "1.5.0"
}
```

Obsidian uses this to show the latest compatible version to users on older Obsidian.

## GitHub Actions Release Workflow

See [github-actions.md](references/github-actions.md) for the complete CI/CD setup including:
- Automated release on tag push
- Build verification on PRs
- The standard release workflow used by most Obsidian plugins

## Community Plugin Submission

See [community-submission.md](references/community-submission.md) for:
- The full submission checklist
- Review process and common rejection reasons
- Developer policies to follow
- How to update after initial submission

## Quick Submission Checklist

1. Plugin works on both desktop and mobile (or `isDesktopOnly: true`)
2. `manifest.json` has all required fields
3. `versions.json` exists and is correct
4. GitHub repo is public
5. Latest release has `main.js` + `manifest.json` attached
6. No `eval()`, `Function()`, or dynamic code execution
7. No obfuscated code
8. No data collection without user consent
9. License file present in repo
10. README explains what the plugin does

## BRAT Beta Testing

[BRAT](https://github.com/TfTHacker/obsidian42-brat) lets users install plugins directly from GitHub before community submission:

```
# User installs via BRAT:
1. Install BRAT from community plugins
2. BRAT → Add Beta Plugin → enter GitHub repo URL
3. BRAT pulls latest release artifacts automatically
```

**For developers:** just create a GitHub Release with the 3 required files. BRAT handles the rest. Use pre-release tags for unstable versions.

## Version Bump Workflow

```bash
# 1. Update version in manifest.json
# 2. Update versions.json with new entry
# 3. Update package.json version
# 4. Commit: "Release 1.2.0"
# 5. Tag: git tag 1.2.0
# 6. Push: git push && git push --tags
# 7. GitHub Actions creates release automatically (if configured)
```

See [github-actions.md](references/github-actions.md) for automating steps 1-6 with a single command.

## Release Checklist

- [ ] Version bumped in `manifest.json`, `package.json`, `versions.json`
- [ ] All versions are in sync across files
- [ ] `npm run build` produces clean `main.js`
- [ ] No console.log/debug statements left in production build
- [ ] Tested on desktop (Mac/Win/Linux)
- [ ] Tested on mobile (iOS/Android) — or `isDesktopOnly: true`
- [ ] CHANGELOG or release notes written
- [ ] Git tag matches manifest version
