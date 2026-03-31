# Error Handling

## Error message format

Every error must answer three questions: **what happened**, **why**, and **what to do about it**.

```
Error [AUTH-003]: Authentication token expired

Your access token expired on 2025-03-01. Run `mycli auth login` to
reauthenticate, or set a new token via MYCLI_TOKEN.

Docs: https://mycli.dev/errors/AUTH-003
```

Treat errors as dialogue: the user did something wrong (or something broke), guide them toward resolution.

## Error codes

Use a namespaced code system:

| Domain | Prefix | Example errors |
|---|---|---|
| Authentication | `AUTH-` | No creds, invalid token, expired, insufficient perms |
| Network | `NET-` | Timeout, DNS failure, connection refused |
| Configuration | `CFG-` | Missing config, invalid value, parse error |
| I/O | `IO-` | File not found, permission denied, disk full |
| API | `API-` | Rate limited, bad request, server error |
| Plugin | `PLUGIN-` | Not found, incompatible version, load failure |
| CLI usage | `CLI-` | Missing args, unknown flag, invalid value |

Properties of good error codes:

- **Stable** -- once assigned, never changes meaning
- **Searchable** -- users can paste `AUTH-003` into a search engine
- **Granular enough** to distinguish failure modes, not so granular every situation gets its own

## The `explain` subcommand

```bash
$ mycli explain AUTH-003
AUTH-003: Authentication token expired

Your stored authentication token has passed its expiration date.
This typically happens after 30 days of inactivity.

Resolution:
  1. Run `mycli auth login` to reauthenticate interactively
  2. Or set MYCLI_TOKEN with a fresh personal access token

Related:
  AUTH-001  No authentication credentials found
  AUTH-002  Invalid authentication token
  AUTH-004  Insufficient permissions
```

## Exit codes

Define a clear, documented mapping:

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | General error |
| `2` | Usage error (bad flags, missing args) |
| `3` | Authentication error |
| `4` | Not found |
| `5` | Permission denied |
| `10` | Network error |
| `20` | Plugin error |
| `130` | Interrupted (Ctrl+C / SIGINT) |
| `143` | Terminated (SIGTERM) |

Document exit codes in `mycli help exit-codes`.

## Error principles

- **Never show raw stack traces.** Log to a debug file and reference it: `See debug log: ~/.config/mycli/debug.log`
- **Distinguish user errors from system errors.** User errors suggest fixes; system errors suggest retry or reporting.
- **Validate input early, bail before state changes.** Don't modify anything until all inputs are validated.
- **In JSON mode, errors are JSON:** `{"error": {"code": "AUTH-003", "message": "...", "docs": "..."}}`
- **Return partial results if possible** (with non-zero exit code and a warning).
- **Use stderr for error messages, never stdout.**
- **Group similar errors.** If 50 files fail validation, show a summary header, not 50 similar lines.
- **Place critical info where the eye lands.** Red text at the end of output, not buried in the middle.

## Bug reports

When an unexpected error occurs:

- Provide debug info and traceback context
- Include instructions for submitting a bug report
- Pre-populate the bug report URL with system context (OS, version, error code)
- Write detailed debug logs to a file rather than overwhelming the terminal

```
Unexpected error [INTERNAL-001]: Null reference in issue parser

This is a bug. Please report it:
  https://github.com/org/mycli/issues/new?title=INTERNAL-001&body=...

Debug log written to: ~/.config/mycli/debug.log
```
