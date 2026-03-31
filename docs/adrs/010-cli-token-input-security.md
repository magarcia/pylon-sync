# ADR-002: Secure Token Input for CLI

## Status

Proposed

## Date

2026-03-31

## Context

The CLI currently accepts the GitHub token via `--token ghp_...` flag. This is a **critical security violation** per CLI design rule 34: command-line flags are visible in:

1. **Shell history** — `~/.bash_history`, `~/.zsh_history` store the full command
2. **Process list** — `ps aux` exposes all running command arguments
3. **System logs** — some OSes log process execution with full arguments

The token IS stored securely after init (via cross-keychain), but the initial entry is the weakest link.

## Options Considered

### Option A: Environment variable only
- `GITHUB_TOKEN=ghp_... pylon init --repo owner/repo`
- Pros: Standard pattern (gh, docker, terraform all use this). Not stored in shell history (when set inline).
- Cons: Users unfamiliar with env vars may struggle. Still visible in `ps` if exported.

### Option B: Interactive prompt (stdin)
- `pylon init --repo owner/repo` → prompts "GitHub Token: " with hidden input
- Pros: Secure (not in history, not in ps). Familiar UX (ssh, npm login).
- Cons: Doesn't work in non-interactive contexts (CI, scripts). Need `--no-input` fallback.

### Option C: Env var + interactive prompt (hybrid)
- Check `GITHUB_TOKEN` env var first
- If not set and stdin is TTY → prompt interactively
- If not set and stdin is not TTY → error with clear message
- Pros: Works in all contexts. Secure in all contexts.
- Cons: Slightly more complex implementation.

### Option D: `pylon auth login` flow
- Separate auth command that stores the token. `init` doesn't handle tokens at all.
- Pros: Separates concerns. Can add OAuth later.
- Cons: Extra step for users. Over-engineered for v0.1.

## Decision

**Option C (hybrid).** This is the standard pattern used by `gh auth login`, `npm login`, etc.

```
# CI/scripting: env var
GITHUB_TOKEN=ghp_... pylon init --repo owner/repo

# Interactive: prompt
pylon init --repo owner/repo
GitHub Token: ******* (hidden input)

# Non-interactive without env var: clear error
pylon init --repo owner/repo
Error: No token provided. Set GITHUB_TOKEN environment variable or run interactively.
```

The `--token` flag is removed entirely. It will not be accepted.

## Implementation

```typescript
import { createInterface } from "node:readline";

async function getTokenFromStdin(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("No token provided. Set GITHUB_TOKEN environment variable or run interactively.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    // Hide input
    process.stdout.write("GitHub Token: ");
    let token = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (char) => {
      const c = char.toString();
      if (c === "\n" || c === "\r") {
        process.stdout.write("\n");
        process.stdin.setRawMode(false);
        rl.close();
        resolve(token);
      } else if (c === "\u0003") { // Ctrl+C
        process.exit(130);
      } else if (c === "\u007f") { // Backspace
        token = token.slice(0, -1);
      } else {
        token += c;
      }
    });
  });
}
```

## Consequences

- `--token` flag removed (breaking change — acceptable pre-release)
- Users in CI set `GITHUB_TOKEN` env var
- Users in terminal get interactive prompt with hidden input
- Token never appears in shell history or process list
