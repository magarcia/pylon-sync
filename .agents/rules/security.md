---
paths:
  - "**/*.ts"
---

# Security Rules

- NEVER log, serialize, or include tokens in error messages
- NEVER store tokens in `data.json`, config files synced to cloud, or git-tracked files
- Plugin: SecretStorage + localStorage fallback. CLI: cross-keychain (OS keychain)
- Path traversal: `NodeFileSystem.safePath()` validates all paths stay within rootDir
- Path traversal: `VaultFileSystem.validatePath()` rejects `..`, `/`, null bytes
- Path traversal: `isValidSyncPath()` in provider rejects `..`, absolute paths, null bytes
- Symlink protection: `NodeFileSystem.assertNotSymlink()` checks before writes
- ZIP extraction: 500MB decompressed size limit prevents zip bombs
- File size: scanner skips files > 100MB (GitHub API limit)
- Bulk delete safety: sync engine refuses to delete > 50% of snapshot entries
- API response shapes are cast with `as` — no runtime validation (accepted risk, documented)
- Sanitize error messages in user-facing notices — strip API URLs and endpoint paths
- Owner/repo/branch validated with regex in GitHubProvider constructor
