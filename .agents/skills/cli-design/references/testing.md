# Testing and Reliability

## Test strategy

- **Unit test** individual commands and flag parsing
- **Integration test** full CLI invocations using subprocess execution. Assert on stdout, stderr, and exit codes.
- **Snapshot test** help text and output formatting to catch unintended changes
- **Test the JSON contract** -- parse `--output json` and validate against a schema
- Use argument parsing libraries (docopt, Cobra, Click, clap, oclif, picocli) -- they handle flags, help text, and spelling suggestions consistently

## Signal handling

Handle signals gracefully:

| Signal | Behavior |
|---|---|
| `SIGINT` (Ctrl+C) | Say something immediately, then clean up and exit with code `130` |
| `SIGTERM` | Clean up and exit with code `143` |
| `SIGPIPE` | Exit silently (user closed the pipe) |
| `SIGWINCH` | Adapt to new terminal dimensions |

### Ctrl+C handling details

- Exit as soon as possible
- Print a message immediately before cleanup
- Add a timeout to cleanup so it can't hang forever
- On repeated Ctrl+C during cleanup, skip remaining cleanup:

```
Gracefully stopping... (press Ctrl+C again to force)
```

## Crash-only design

Design as if the process will be killed at any moment:

- Avoid cleanup requirements on exit
- Defer cleanup to next run if possible
- Expect to start in a state where previous cleanup didn't run
- This improves both robustness and responsiveness

## Robustness principles

- **Validate all inputs early** -- bail out before state changes
- **Set network timeouts** with sensible defaults (prevent infinite hangs)
- **Support resume from last checkpoint** on transient failures
- **Anticipate misuse** -- programs wrapped in scripts, poor connections, parallel execution, case-insensitive filesystems
- **Idempotent operations** -- "create if not exists" is safer than "create and fail on duplicate"

## Test checklist

- [ ] All commands return correct exit codes
- [ ] `--help` output matches expected format (snapshot)
- [ ] `--output json` produces valid, schema-conforming JSON
- [ ] Errors go to stderr, data goes to stdout
- [ ] SIGINT during operation exits cleanly with code 130
- [ ] SIGPIPE (broken pipe) exits silently
- [ ] Invalid flags produce usage error (exit code 2)
- [ ] Missing required flags produce clear error messages
- [ ] `--no-input` mode never prompts
- [ ] `--quiet` suppresses non-essential output
- [ ] Color is disabled when `NO_COLOR` is set
- [ ] Tool works correctly when stdout is not a TTY
