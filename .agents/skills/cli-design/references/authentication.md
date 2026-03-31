# Authentication

## Auth methods (priority order)

Support multiple methods, resolved in this order:

1. **Environment variable**: `MYCLI_TOKEN` (highest non-interactive priority; CI/CD-friendly)
2. **Stored credentials**: from config file or system keychain
3. **Interactive login**: OAuth device flow or browser-based flow (last resort)

Note: do not support `--token` flag for passing secrets -- flags leak to `ps` and shell history. Use env vars or file-based input instead.

## Token-based auth

```bash
# Set via env var (ideal for CI)
export MYCLI_TOKEN=ghp_xxxxx
mycli issue list

# Or via credential file
mycli auth login --token-file ~/.mycli/token

# Or via stdin
echo "$TOKEN" | mycli auth login --token-stdin
```

## OAuth device flow

Follow the pattern established by `gh auth login`:

```
$ mycli auth login
! First, copy your one-time code: ABCD-1234
> Press Enter to open https://example.com/device in your browser...

Waiting for authentication... done
Logged in as martin (martin@example.com)
Token stored in ~/.config/mycli/credentials.yml
```

For environments without a browser (SSH, containers), the device code flow lets the user enter the code on any device.

## Auth status

```bash
$ mycli auth status
Logged in to api.example.com as martin (martin@example.com)
  Token: ghp_****xxxx
  Token source: ~/.config/mycli/credentials.yml
  Scopes: read, write, admin
  Expires: 2025-06-01
```

## Multiple accounts

Support multiple accounts/hosts:

```bash
mycli auth login --hostname enterprise.example.com
mycli auth switch --hostname enterprise.example.com
mycli auth status --hostname enterprise.example.com
```

## Auth errors

Use the `AUTH-` error code namespace:

| Code | Meaning |
|---|---|
| `AUTH-001` | No credentials found |
| `AUTH-002` | Invalid token |
| `AUTH-003` | Token expired |
| `AUTH-004` | Insufficient permissions |

Always suggest the fix: `Run 'mycli auth login' to reauthenticate.`

## Token storage

- Store tokens in `~/.config/mycli/credentials.yml` with `600` permissions
- Use system keychain when available (macOS Keychain, Linux Secret Service)
- Never write tokens to the main config file
- Support `mycli auth logout` to securely remove stored credentials
