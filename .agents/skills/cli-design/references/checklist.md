# Pre-Launch Checklist

Use this before shipping a CLI tool or a significant new command.

## Help and discovery

- [ ] `--help` works on every command and subcommand
- [ ] `--version` prints version, commit hash, and build date
- [ ] Running with no args shows concise help (not full manual)
- [ ] Typos produce "Did you mean...?" suggestions
- [ ] Actions show next steps: "Created #42. View with `mycli issue view 42`"
- [ ] Shell completions available (bash, zsh, fish, powershell)
- [ ] Web docs published and linked from `--help`

## Output

- [ ] stdout is for data, stderr is for messages
- [ ] Color and formatting disabled when not on a TTY
- [ ] `NO_COLOR` environment variable is respected
- [ ] `--output json` supported for all data-producing commands
- [ ] `--output llm` provides LLM-friendly formatted output
- [ ] `--quiet` suppresses non-essential output
- [ ] JSON output schema is documented and versioned
- [ ] Large output is paged when on a TTY

## Errors

- [ ] Error messages include a code, explanation, and suggested fix
- [ ] `explain` subcommand documents all error codes
- [ ] Exit codes are correct (0 for success, non-zero for failure)
- [ ] Exit codes are documented (`mycli help exit-codes`)
- [ ] No raw stack traces shown to users
- [ ] Errors in JSON mode are also JSON

## Interactivity

- [ ] `--no-input` disables all interactive prompts
- [ ] `--yes` / `-y` skips confirmation prompts
- [ ] Destructive actions require confirmation (bypassable with `--yes`)
- [ ] Prompts only appear when stdin is a TTY
- [ ] Ctrl+C works at all times, including during network I/O

## Auth and config

- [ ] Auth supports env var (`MYCLI_TOKEN`) and interactive login
- [ ] No secrets accepted via command-line flags
- [ ] Config follows XDG (`~/.config/mycli/`) on all platforms
- [ ] Config precedence: flags > env vars > project > user > defaults
- [ ] All env vars documented (`mycli help environment`)

## Performance

- [ ] Startup time is under 100ms
- [ ] First output appears within 100ms
- [ ] Long operations show progress indicators (spinners/bars on stderr)
- [ ] Network requests have timeouts
- [ ] Responses cached where appropriate

## Distribution

- [ ] Binary available for major OS/arch combinations
- [ ] Installable via Homebrew and at least one other method
- [ ] `mycli update` or `mycli self-update` available
- [ ] Releases include checksums

## Extensibility

- [ ] Extensions work via `mycli-<name>` executable pattern
- [ ] User-defined aliases supported

## Signals and reliability

- [ ] SIGINT handled gracefully (exit 130)
- [ ] SIGTERM handled gracefully (exit 143)
- [ ] SIGPIPE exits silently
- [ ] Input validated early, before state changes
- [ ] Operations are idempotent where possible
