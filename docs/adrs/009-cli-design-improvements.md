# ADR-001: CLI Design Improvements

## Status

Proposed

## Date

2026-03-31

## Context

The pylon CLI was reviewed against CLI design best practices (command structure, output design, error handling, configuration, security). The CLI currently works but has several gaps compared to modern CLI standards.

## Findings (by severity)

### CRITICAL violations

**Rule 34: Secrets via flags.** `pylon init --token ghp_...` accepts the token as a command-line flag. This exposes the token in:
- Shell history (`~/.bash_history`, `~/.zsh_history`)
- Process list (`ps aux` shows full command line)
- System logs on some platforms

The token IS stored securely after init (via cross-keychain), but the initial entry vector is insecure.

**Rule 8: No `--output json` support.** `sync` and `status` produce human-readable text only. There's no machine-readable output format. Other tools and scripts cannot reliably parse the output.

**Rule 6: No TTY detection.** Output is the same whether piped or in a terminal. Colors, progress indicators, and interactive prompts should adapt.

**Rule 16: Errors don't answer "what to do next".** Most errors print a message but don't guide the user. Example: `Sync failed: Rate limit exceeded for /repos/...` — should suggest "Try again after {time}" or "Use --verbose for details".

### HIGH violations

**Rule 7: stderr vs stdout mixing.** Error messages use `console.error` (correct), but `console.warn` in `saveToken` goes to stderr while `console.log` in init/sync/status goes to stdout. Status output (informational) should also go to stderr when piped, leaving stdout clean for data.

**Rule 11: No progress indicator for long operations.** `sync` can take 10-60 seconds on first run. No spinner, no progress bar, no feedback that it's working.

**Rule 17: No error codes.** All errors exit with code 1. No distinction between usage errors (exit 2), auth errors, network errors, or sync conflicts.

**Rule 18: Exit code mapping undefined.** Only 0 (success) and 1 (everything else) exist.

**Rule 29: `--version` lacks build metadata.** Shows `pylon 0.1.0` but no commit hash or build date, making it hard to diagnose issues.

**Rule 31: No signal handling.** SIGINT (Ctrl+C) during sync could leave state inconsistent. No graceful shutdown.

### MEDIUM violations

**Rule 4: Missing short flags.** `--repo` has no `-r`, `--branch` no `-b`, `--full-scan` no short form.

**Rule 10: No color support and no `NO_COLOR` respect.** Output is plain text with no color coding.

**Rule 14: No typo correction.** Running `pylon syn` shows generic help instead of "Did you mean 'sync'?"

**Rule 22: Config not in XDG directory.** Config is in `.pylon/` inside the synced directory, not in `~/.config/pylon/`. This mixes data with configuration.

## Options Considered

### Option A: Adopt a CLI framework (commander, citty, clipanion)
- Pros: Handles flag parsing, help generation, completion, validation automatically
- Cons: Adds a dependency, may be heavier than needed for 3 commands

### Option B: Incremental improvements to current hand-rolled parser
- Pros: No new dependencies, full control, lightweight
- Cons: Reimplementing flag parsing, help formatting, error codes manually

### Option C: Use `cac` (lightweight CLI framework, 3KB)
- Pros: Tiny, handles flags/commands/help/version, used by Vite internally
- Cons: Less feature-rich than commander

## Decision

**Option B for now, with specific targeted fixes.** The CLI has only 3 commands — a framework is overkill at this stage. Address the critical and high-impact issues directly:

### Phase 1 (security + correctness):
1. **Remove `--token` flag.** Accept token ONLY via `GITHUB_TOKEN` env var or interactive prompt (stdin). This eliminates the shell history leak.
2. **Add exit code mapping:** 0=success, 1=sync error, 2=usage error, 3=auth error, 4=network error.
3. **Add `--output json` to `sync` and `status`.**

### Phase 2 (UX):
4. **Add stderr progress indicator** for `sync` (simple dots or phase names).
5. **Add signal handling** (SIGINT → graceful shutdown with exit 130).
6. **Improve error messages** — every error includes a suggested action.
7. **Add short flags:** `-r` for `--repo`, `-b` for `--branch`.

### Phase 3 (polish):
8. **TTY detection** — suppress progress when piped.
9. **`NO_COLOR` support.**
10. **Typo suggestions** using Levenshtein distance.
11. **Version with commit hash** via build-time injection.

## Consequences

- The `--token` removal is a breaking change (but CLI is pre-release, no users)
- `--output json` adds complexity but enables scripting/automation
- Exit codes improve CI/CD integration
- These changes make the CLI composable with Unix tools
