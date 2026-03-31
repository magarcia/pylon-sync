# Configuration

## XDG Base Directory Specification

Use `~/.config` on all platforms (Linux, macOS, Windows WSL). This is the standard for CLI tools, followed by `gh`, `git`, `docker`, `kubectl`, `terraform`.

**Do not** use `~/Library/Application Support` on macOS for CLI tools -- that's for GUI apps.

```
Config:  $XDG_CONFIG_HOME/mycli/   -> defaults to ~/.config/mycli/
Data:    $XDG_DATA_HOME/mycli/     -> defaults to ~/.local/share/mycli/
Cache:   $XDG_CACHE_HOME/mycli/    -> defaults to ~/.cache/mycli/
State:   $XDG_STATE_HOME/mycli/    -> defaults to ~/.local/state/mycli/
```

Always respect the env vars if set. Fall back to defaults if not.

| Directory | Contents | Backup? |
|---|---|---|
| Config | User preferences, aliases, host configs | Yes |
| Data | Extensions, plugins, downloaded schemas | Yes |
| Cache | HTTP cache, compiled assets | No (safe to delete) |
| State | Logs, command history, session state | Optional |

## Config precedence

Highest to lowest:

1. Command-line flags
2. Environment variables (`MYCLI_*`)
3. Project-local config (`.mycli.yml` in repo root)
4. User config (`~/.config/mycli/config.yml`)
5. System config (`/etc/mycli/config.yml`)
6. Built-in defaults

## Config file format

Use YAML or TOML. Support comments. Keep the schema simple.

```yaml
# ~/.config/mycli/config.yml
defaults:
  output: text
  editor: vim
  pager: less -R

aliases:
  bugs: "issue list --label bug --state open"
  mine: "issue list --assignee @me"

hosts:
  api.example.com:
    user: martin
```

Store credentials in a separate file (`credentials.yml`), not in the main config.

## Config commands

```bash
mycli config list                     # Show all active config
mycli config get defaults.output      # Get specific value
mycli config set defaults.output json # Set value
```

## Environment variables

Document all supported env vars in `mycli help environment`:

| Variable | Purpose | Default |
|---|---|---|
| `MYCLI_TOKEN` | Auth token | -- |
| `MYCLI_CONFIG_DIR` | Override config directory | `~/.config/mycli` |
| `MYCLI_NO_COLOR` | Disable color | `false` |
| `MYCLI_PAGER` | Pager command | `$PAGER` or `less` |
| `MYCLI_FORCE_TTY` | Force TTY behavior in pipes | `false` |
| `MYCLI_DEBUG` | Enable debug logging | `false` |
| `NO_COLOR` | Respect no-color.org standard | -- |

Standard env vars to check and respect:

| Variable | Purpose |
|---|---|
| `NO_COLOR` / `FORCE_COLOR` | Color control |
| `DEBUG` | Debug output |
| `EDITOR` | User's preferred editor |
| `HTTP_PROXY`, `HTTPS_PROXY` | Network proxy |
| `SHELL` | Interactive shell |
| `TERM` / `TERMINFO` | Terminal capabilities |
| `TMPDIR` | Temp file location |
| `HOME` | Home directory |
| `PAGER` | Output paging |
| `LINES`, `COLUMNS` | Terminal dimensions |

## `.env` file support

Read from local `.env` for project-specific config that doesn't change across runs:

- Useful for project-specific settings without repeated flags
- Don't version control `.env` files (add to `.gitignore`)
- Don't store secrets in `.env` -- too prone to leakage

## Secrets

Never store secrets in:

- Command-line flags (visible in `ps`, shell history)
- Environment variables (exported to all child processes, visible in `/proc`)
- `.env` files (unencrypted, often accidentally committed)

Instead, accept secrets via:

- Credential files with restrictive permissions
- Pipes / stdin
- System keychain
- Secret management services (Vault, 1Password CLI)
- AF_UNIX sockets or other IPC

## Modifying external config

If your tool needs to modify config it doesn't own:

- Request explicit consent
- Prefer creating new files (e.g., `/etc/cron.d/myapp`) over appending existing ones
- Use dated comments to mark your additions
