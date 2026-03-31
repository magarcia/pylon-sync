# Extensibility

## Plugin model: the `git-*` / `gh-*` pattern

Any executable on `$PATH` named `mycli-<name>` becomes a subcommand:

```bash
# User creates ~/bin/mycli-dashboard (any language, just needs to be executable)
$ mycli dashboard   # runs mycli-dashboard
```

This pattern has major advantages:

- Plugins can be written in any language
- Require no SDK for basic functionality
- Discovered automatically via PATH
- Users already understand the pattern from git and gh

## Extension lifecycle

Provide built-in extension management:

```bash
mycli extension install owner/mycli-dashboard    # Install from repo
mycli extension list                              # Show installed
mycli extension upgrade mycli-dashboard           # Update one
mycli extension upgrade --all                     # Update all
mycli extension remove mycli-dashboard            # Uninstall
mycli extension create my-ext                     # Scaffold new extension
```

## Extension discovery

- Extensions are GitHub repositories prefixed with `mycli-`
- The repo contains an executable with the same name
- Support precompiled binaries attached to releases (per platform/arch)
- Provide `mycli extension search` for discovery

## Extension API

For deeper integration, publish a library that gives extensions access to:

- Authenticated HTTP client (reusing stored credentials)
- Config reading
- Output formatting utilities (colors, tables, JSON)
- Host resolution and context (current project, current user)

GitHub CLI's `go-gh` library is the canonical example of this pattern.

## Aliases

User-defined aliases as a lightweight alternative to full extensions:

```bash
mycli alias set bugs "issue list --label bug --state open"
mycli bugs   # -> mycli issue list --label bug --state open

mycli alias set review 'pr list --reviewer @me --state open'
mycli review
```

Store aliases in the user config file.
