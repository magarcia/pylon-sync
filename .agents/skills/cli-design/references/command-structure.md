# Command Structure

## Anatomy: `tool <noun> <verb> [flags] [args]`

Follow the noun-verb pattern for multi-resource CLIs:

```
mycli auth login
mycli auth status
mycli project list
mycli project create --name "Foo"
mycli issue view 42
mycli issue list --state open --assignee @me
```

For single-purpose CLIs, the root command is the verb (like `curl`, `jq`, `rg`).

## Subcommand hierarchy

Keep nesting to **2 levels max** (`tool noun verb`). Deeper nesting signals a design problem -- decompose into separate nouns instead.

Common verb patterns:

| Verb | Purpose | Example |
|---|---|---|
| `list` | List resources | `mycli project list` |
| `view` / `get` | Show single resource | `mycli issue view 42` |
| `create` | Create new | `mycli issue create` |
| `edit` / `update` | Modify existing | `mycli issue edit 42` |
| `delete` | Remove | `mycli project delete my-proj` |
| `status` | Show current state | `mycli auth status` |

**Avoid ambiguity** -- don't have similarly-named subcommands (`update` vs `upgrade`). Disambiguate with different terminology.

**No catch-all subcommands** -- don't let users omit the most-used subcommand for brevity. You can never add a subcommand with that name later.

**No arbitrary abbreviations** -- don't allow prefix matching (`mycli ins` for `install`). Use explicit aliases instead.

## Flags over positional args

Flags are self-documenting and order-independent:

```bash
# Bad: positional args require memorizing order
mycli deploy production jira

# Good: flags are self-documenting
mycli deploy --environment production --product jira

# Good: short flags for frequent use
mycli deploy -e production -p jira
```

Rules for flags:

- Every flag has a long form (`--output`). Common ones also get a short form (`-o`).
- Boolean flags default to `false`. Use `--no-<flag>` to explicitly disable.
- Support both `--output=json` and `--output json`.
- Make flag order independent where possible (users append flags via history recall).

When positional args are acceptable:

- Simple actions on multiple files: `rm file1.txt file2.txt` (enables globbing)
- A single primary identifier: `mycli issue view 42`
- Never use 2+ positional args for different things (use flags instead)

## Global flags

Every CLI must support:

```
-h, --help          Show help for any command
-v, --version       Print version and exit (or use --version only if -v means verbose)
    --verbose       Increase output verbosity (can stack: -vvv)
-o, --output <fmt>  Output format: text (default), json, llm
    --no-color      Disable colored output
    --no-input      Disable interactive prompts (fail instead)
-q, --quiet         Suppress non-essential output
    --yes / -y      Skip confirmation prompts
```

These must be consistent across all subcommands.

## Standard flag names

When your CLI needs these concepts, use these established names:

| Flag | Purpose |
|---|---|
| `-a, --all` | Include everything |
| `-d, --debug` | Show debugging output |
| `-f, --force` | Force without confirmation |
| `--json` | Shorthand for `--output json` |
| `-n, --dry-run` | Preview without executing |
| `-o, --output` | Output file or format |
| `-p, --port` | Port number |
| `-u, --user` | User specification |

## Secret handling

Never accept secrets via command-line flags -- they leak to `ps` output and shell history.

```bash
# Bad: visible in process list and history
mycli auth --token ghp_secret123

# Good: environment variable
export MYCLI_TOKEN=ghp_secret123

# Good: file-based
mycli auth --token-file ~/.mycli/token

# Good: stdin
echo "ghp_secret123" | mycli auth --token-stdin
```

## Naming

- Short, memorable, typeable name. Single word preferred (`gh`, `rg`, `fd`, `jq`).
- Check availability on Homebrew, npm, crates.io, and as a GitHub repo.
- Avoid names that conflict with common Unix utilities.
- Subcommand names should be familiar verbs/nouns: `list`, `create`, `view`, `delete`, `status`, `login`, `config`.
- Lowercase letters only, dashes if necessary.
