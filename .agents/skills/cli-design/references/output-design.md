# Output Design

## Detect TTY

The single most important heuristic: **is stdout a terminal?**

| stdout is TTY | Behavior |
|---|---|
| Yes | Human-readable, colored, adaptive width, headers, spinners |
| No (piped) | Plain text, no color, no spinners, stable columns |

Check with: `process.stdout.isTTY` (Node), `atty::is(Stream::Stdout)` (Rust), `os.Isatty()` (Go), `sys.stdout.isatty()` (Python).

## stdout vs stderr

This is non-negotiable:

- **stdout** -- primary data output. This is what gets piped.
- **stderr** -- messages, progress, logs, errors. Everything that isn't data.

```bash
# Data goes to stdout (captured by pipe)
mycli issue list | jq '.[] | .title'

# Progress goes to stderr (visible to user, not captured)
Fetching issues... done          # this appears on terminal
```

## Human-readable output (default when TTY)

- Use color to improve scannability: green for success, red for errors, yellow for warnings, cyan for emphasis
- Adapt table widths to terminal columns; truncate long fields with `...`
- Confirm every action: `Created issue #42`, `Deployed to production`
- Break multi-step processes into visible stages
- Use ASCII art sparingly for scannable dense information (like `ls -l` permissions)

## Machine-readable: JSON (`--output json`)

```bash
$ mycli issue list -o json
[
  {
    "id": 42,
    "title": "Fix login redirect",
    "state": "open",
    "assignee": "martin",
    "labels": ["bug", "auth"],
    "url": "https://app.example.com/issues/42"
  }
]
```

Rules:

- Stable schema -- additions are non-breaking, removals are breaking
- Always output valid JSON. Arrays for lists, objects for single resources.
- Include metadata fields (`id`, `url`, `createdAt`) even if not shown in text mode
- Document the JSON schema
- Errors in JSON mode are also JSON: `{"error": {"code": "AUTH-003", "message": "..."}}`

## Machine-readable: Plain/TSV (piped output)

When stdout is not a TTY and no explicit format is requested:

```bash
$ mycli issue list | head -3
42    open    Fix login redirect           martin    bug,auth
43    open    Dark mode contrast issue     sara      design
44    closed  Update dependencies           bot       maintenance
```

- Tab-separated values, one record per line, no decorations
- Stable column order
- Easy to consume with `cut`, `awk`, `grep`, `sort`

## LLM-friendly output (`--output llm`)

Optimized for language model consumption:

```bash
$ mycli issue view 42 -o llm
# Issue #42: Fix login redirect

- State: open
- Priority: high
- Assignee: Martin Garcia (martin)
- Labels: bug, auth
- Created: 2025-03-01T10:00:00Z
- URL: https://app.example.com/issues/42

## Description
After OAuth callback, users are redirected to the homepage instead of
their original destination. This affects all OAuth providers.
```

- Structured but readable: labeled key-value pairs or markdown-like formatting
- Include full context: names, descriptions, URLs
- No color codes, box-drawing characters, or decorative elements
- Information-dense but unambiguous

## Color

Use color intentionally, not decoratively. Disable when:

- stdout/stderr is not a TTY
- `NO_COLOR` env var is set (non-empty) -- respect [no-color.org](https://no-color.org)
- `TERM=dumb`
- `--no-color` flag is passed
- Tool-specific `MYCLI_NO_COLOR` env var is set

## Progress and animations

- Show a spinner for indeterminate waits (network requests)
- Show a progress bar for determinate operations (uploading N files)
- Send all progress output to **stderr** (not stdout)
- Disable all animations when not on a TTY or when `--quiet` is set
- For parallel operations, use multi-progress display (like `docker pull`)

## Paging large output

- Use a pager (`less -FIRX`) for extensive text output
- Only page when stdin and stdout are TTY
- Respect `$PAGER` env var
- `less -FIRX` flags: don't page single screen, ignore case, preserve colors, no blank on quit

## Symbols and emoji

- Use to add structure and catch attention, not for decoration
- Avoid a "toy" appearance
- Common: `checkmark` for success, `x` for failure, `!` for warnings, `>` for progress
