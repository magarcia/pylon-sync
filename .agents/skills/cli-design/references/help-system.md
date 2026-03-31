# Help System

## Concise help by default

When run with no arguments (and arguments are required), show a brief summary:

```
$ mycli
mycli - Manage widgets from the command line

Usage: mycli <command> [flags]

Common commands:
  auth       Authenticate with the API
  project    Manage projects
  issue      Manage issues
  config     Configure CLI settings

Run 'mycli <command> --help' for details on a command.
Run 'mycli help environment' for info on environment variables.
```

Prioritize common commands first. Rare commands go in a separate section or only appear in `--help`.

## Full help on `--help`

Triggered by `-h`, `--help`, or `help <command>`:

```
$ mycli issue list --help
List issues matching the given criteria

Usage: mycli issue list [flags]

Flags:
  -s, --state <string>      Filter by state: open, closed, all (default "open")
  -a, --assignee <string>   Filter by assignee. Use @me for yourself
  -l, --label <string>      Filter by label (repeatable)
  -L, --limit <int>         Maximum results (default 30)
  -o, --output <format>     Output: text, json, llm (default "text")

Examples:
  # List open bugs assigned to me
  $ mycli issue list --state open --label bug --assignee @me

  # Get all issues as JSON for scripting
  $ mycli issue list --state all --output json

  # Pipe to jq for custom filtering
  $ mycli issue list -o json | jq '.[] | select(.priority == "high")'

Learn more: https://mycli.dev/docs/issue-list
```

## Help principles

- `-h` / `--help` works on **every** command and subcommand, always
- Lead with examples -- users reach for examples before reading flag descriptions
- Group flags by frequency: most common first, rare flags later
- Show defaults in flag descriptions: `(default "open")`
- Link to web docs for deeper information
- If stdin is a TTY and the program expects piped input, display help and quit (don't hang)

## Suggestions and corrections

Suggest corrections on typos:

```
$ mycli isue
Did you mean 'issue'?

Run 'mycli --help' for a list of commands.
```

Suggest next steps after actions:

```
$ mycli issue create --title "Fix login"
Created issue #42

Next steps:
  View:   mycli issue view 42
  Assign: mycli issue edit 42 --assignee @me
  List:   mycli issue list
```

Ask permission rather than auto-executing corrections -- the user might be making a logical mistake, not a typo.

## Shell completions

Provide a `completion` subcommand:

```bash
mycli completion bash > /etc/bash_completion.d/mycli
mycli completion zsh > ~/.zfunc/_mycli
mycli completion fish > ~/.config/fish/completions/mycli.fish
mycli completion powershell > mycli.ps1
```

Completions should cover subcommands, flags, and flag values where feasible.

## Three documentation layers

1. **In-CLI help** (`--help`, `explain`) -- immediate, offline, version-synced
2. **Man pages** (optional) -- generated from the same source as `--help`, installable via package managers
3. **Web docs** -- searchable, linkable, richer content (screenshots, tutorials, interactive examples)

## Documentation content

- Command reference (auto-generated from help text)
- Getting started guide
- Authentication and configuration guide
- Scripting and automation recipes
- Extension development guide
- Error code reference (one page per domain, searchable)
- Changelog following [Keep a Changelog](https://keepachangelog.com) format
- Migration guides between major versions
