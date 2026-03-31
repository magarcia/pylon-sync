# Community Plugin Submission

## Prerequisites

1. **Public GitHub repo** with source code
2. **GitHub Release** with `main.js` + `manifest.json` (+ `styles.css` if used)
3. **License file** in repo root (MIT, Apache 2.0, GPL, etc.)
4. **README.md** explaining what the plugin does

## Submission Process

1. Fork [obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
2. Edit `community-plugins.json` — add entry at the end:

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "author": "Your Name",
  "description": "What your plugin does in one sentence.",
  "repo": "github-username/repo-name"
}
```

3. Submit a Pull Request to `obsidian-releases`
4. Wait for review (typically 1-4 weeks)

## Review Criteria

The Obsidian team reviews for:

### Security
- No `eval()`, `new Function()`, or dynamic code execution
- No loading remote code at runtime
- No obfuscated or minified source (build output is fine, but source must be readable)
- No data collection without explicit user consent and disclosure
- Tokens/secrets stored via `plugin.saveData()`, never hardcoded

### Quality
- Plugin actually works as described
- No console errors on load/unload
- Clean enable/disable cycle (no leaked listeners, DOM elements, or intervals)
- Reasonable performance (doesn't freeze UI on load)
- Works on both desktop and mobile (or `isDesktopOnly: true` with justification)

### Metadata
- `id` in manifest matches the `id` in community-plugins.json
- `id` is unique, descriptive, kebab-case
- `name` is clear and not misleading
- `description` accurately describes functionality
- `minAppVersion` is appropriate (not higher than necessary)
- `version` follows semver
- `author` matches GitHub account

### Common Rejection Reasons

1. **Missing license** — every plugin needs a license file
2. **manifest.json mismatch** — id/version don't match between files
3. **No release** — GitHub Release must exist with correct artifacts
4. **Console errors** — plugin throws errors on load or unload
5. **Leaks on disable** — DOM elements or listeners not cleaned up
6. **Uses eval** — any form of dynamic code execution is rejected
7. **Misleading name** — name suggests official Obsidian functionality
8. **Duplicate functionality** — too similar to existing plugin without differentiation

## After Submission

### Updates
Once accepted, push new releases to your repo. Obsidian checks for updates automatically. No need to update `community-plugins.json` for new versions.

### Version Updates
Only update `obsidian-releases` if you need to change the plugin's `id`, `name`, `author`, or `description`.

## Developer Policies

Key policies from [Obsidian Developer Policies](https://docs.obsidian.md/Developer+policies):

- Do not include ads, tracking, or analytics
- Do not gate core functionality behind paywalls (optional premium features are OK)
- Do not make network requests without clear user consent
- Do not modify files outside the current vault without consent
- Respect user privacy — don't collect or transmit personal data
- Credit dependencies and respect their licenses
