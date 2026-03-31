# Distribution

## Installation methods

Support as many as feasible, in priority order:

| Method | Platforms | Example |
|---|---|---|
| Homebrew | macOS, Linux | `brew install mycli` |
| Shell installer | macOS, Linux | `curl -fsSL https://mycli.dev/install.sh \| sh` |
| npm / npx | All (if Node CLI) | `npm install -g mycli` |
| cargo install | All (if Rust CLI) | `cargo install mycli` |
| go install | All (if Go CLI) | `go install example.com/mycli@latest` |
| apt / deb | Debian/Ubuntu | `apt install mycli` |
| GitHub Releases | All | Precompiled binaries per platform |
| Docker | All | `docker run --rm mycli/mycli` |

## Binary distribution

- Build for all major targets: `linux-amd64`, `linux-arm64`, `darwin-amd64`, `darwin-arm64`, `windows-amd64`
- Single static binary with no runtime dependencies (ideal)
- Include checksums (SHA-256) and sign releases (GPG or Sigstore)
- Use CI to automate release builds
- Make uninstallation equally easy

## Version management

- Embed version info at build time: version, commit hash, build date
- `mycli --version` prints: `mycli 1.2.3 (commit abc1234, built 2025-03-01)`
- Support `mycli update` or `mycli self-update` (with user confirmation)
- Periodically check for updates (at most once per day) and notify via stderr:
  ```
  A new version of mycli is available: 1.3.0. Run 'mycli update' to upgrade.
  ```

## Future-proofing

- **Keep changes additive** -- add new flags rather than modify existing ones
- **Deprecate before removing** -- warn when deprecated flag is used, provide migration path
- **Semantic versioning** -- only break interfaces in major versions
- **Human-readable output can evolve** -- encourage `--output json` for scripts so you can improve the human experience
- **No time bombs** -- don't depend on external services you don't maintain; 20 years from now, the command should still work

## Changelog

Follow [Keep a Changelog](https://keepachangelog.com):

- Group changes by type: Added, Changed, Deprecated, Removed, Fixed, Security
- Include migration guides for breaking changes
- Link each version to its diff
