# CLI Design Philosophy

These principles inform every decision in CLI design. When rules conflict, use these to resolve the tension.

## Human-first, machine-compatible

The CLI is a text-based UI for humans that also happens to be scriptable. Design for the human first, then ensure machines can consume the output.

- Default to human-readable output with color and formatting
- Provide `--output json` and `--output llm` for machines
- Use TTY detection to automatically switch between modes

## Conversation, not interrogation

Users interact with CLIs iteratively -- type, read, adjust, retry. Each invocation is a turn in a conversation.

- Suggest corrections on typos: `mycli isue` -> `Did you mean 'issue'?`
- Show the next step after actions: `Created issue #42. View it with 'mycli issue view 42'`
- Confirm destructive actions before proceeding
- When state changes, explain what happened and the new state

## Consistency over novelty

Users have muscle memory. Breaking conventions creates friction that no amount of cleverness can offset.

- `--help` works everywhere, always
- `-v` means verbose (or version -- pick one and stick to it)
- `--output json` is the structured output flag
- Exit 0 on success, non-zero on failure
- stdout for data, stderr for messages

## Say just enough

Too little output and users wonder if it's broken. Too much and they can't find what matters.

- Default to concise, offer verbosity via `--verbose` / `-v`
- Confirm every action: `Created issue #42` (not silence)
- Provide `--quiet` for scripts that only care about exit codes
- Break multi-step processes into visible stages

## Robustness as a feeling

The tool should feel solid -- subjective robustness comes from attention to detail.

- Fast startup (<100ms)
- Immediate feedback (spinner appears before network request)
- No hanging (timeouts on all network calls)
- No cryptic stack traces (catch errors, explain them)
- Graceful degradation (partial results with warnings when possible)

## Empathy

CLI tools are a programmer's creative kit. They should be enjoyable to use.

- Anticipate misuse: programs run in scripts, over poor connections, in parallel
- Exceed expectations: suggest the next command, auto-detect context
- Make it easy to do the right thing and hard to do the wrong thing
- Make installation and uninstallation equally easy

## Ease of discovery

Merge CLI efficiency with GUI discoverability.

- Help text shows the most common commands first
- Suggest corrections when input is close to valid
- Provide shell completions for interactive discovery
- Link to web docs for deeper exploration

## Chaos

Terminal conventions are messy but powerful. Break rules intentionally with clarity of purpose.

> "Abandon a standard when it is demonstrably harmful to productivity or user satisfaction."

Document deviations and explain why they exist.
