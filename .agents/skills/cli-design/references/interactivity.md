# Interactivity

## Progressive disclosure

If a command requires arguments the user didn't provide, prompt interactively -- but only when stdin is a TTY:

```
$ mycli issue create
? Title: Fix login redirect
? Labels: bug, auth
? Assignee: (press Enter to skip) martin
? Body: [(e) to open editor, Enter to skip]

Creating issue... done
Created issue #42
View it: mycli issue view 42
```

Never require prompts -- always provide flag alternatives for every prompted value.

## `--no-input` for scripts

When `--no-input` is set (or stdin is not a TTY), never prompt. Fail with a clear error listing the missing required flags:

```
$ mycli issue create --no-input
Error [CLI-002]: Missing required flags: --title

Usage: mycli issue create --title <string> [--body <string>] [--label <string>...]
```

## Confirmations for destructive actions

Always confirm before destructive actions. Scale confirmation difficulty to risk:

| Risk level | Example | Confirmation |
|---|---|---|
| Mild | Delete a single file | `--yes` bypasses, simple y/N prompt |
| Moderate | Delete directory, bulk changes | Prompt with details of what will be deleted |
| Severe | Delete entire application, irreversible data loss | Require typing the resource name |

```bash
# Mild: simple confirmation
$ mycli project delete my-project
! This will permanently delete project "my-project" and all its issues.
? Are you sure? (y/N)

# Severe: type to confirm
$ mycli org delete my-org
! This will permanently delete organization "my-org", all projects, and all data.
? Type "my-org" to confirm:

# Script-friendly: bypass with --yes
$ mycli project delete my-project --yes
```

Non-obvious destruction is severe: changing a config value from 10 to 1 that implicitly deletes 9 items.

## Spinners and progress

- Show a spinner for indeterminate waits (network requests, processing)
- Show a progress bar for determinate operations (uploading files, processing N items)
- Send all progress/spinner output to **stderr**
- Disable all animations when not on a TTY or when `--no-color` / `--quiet` is set
- For parallel operations, use multi-progress bars (like `docker pull`)
- When errors occur during progress, surface the logs (don't hide behind the progress bar)

## Editor integration

For multi-line input (issue bodies, commit messages), open the user's `$EDITOR`:

```bash
# Respect EDITOR env var, fall back to sensible default
$ mycli issue create --title "Fix login"
# Opens $EDITOR for the body
```

## Escape routes

- Ctrl+C must always work, even during network I/O
- For tools that wrap other processes (SSH, tmux), document escape sequences
- If cleanup is needed on exit, add a timeout so it can't hang forever
- On repeated Ctrl+C during cleanup, skip remaining cleanup:

```
Gracefully stopping... (press Ctrl+C again to force)
```

## Password input

Turn off echo when prompting for passwords (hide typed characters). Every language has a utility for this.
