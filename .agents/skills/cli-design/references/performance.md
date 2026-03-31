# Performance

## Startup time

Target **under 100ms** for cold start, **under 50ms** for subcommand dispatch. Users notice anything above 200ms.

Strategies:

- **Language choice matters.** Compiled languages (Go, Rust) have inherently fast startup. Node/Python need lazy-loading.
- **Defer work.** Don't load config, check auth, or hit the network until actually needed for the requested command.
- **Lazy-load subcommands.** Only parse and load code for the subcommand being run.
- **Cache aggressively.** Cache API responses, auth tokens, schema definitions in `$XDG_CACHE_HOME`.
- **Avoid unnecessary I/O.** Don't read files that aren't needed for the current command.

## Responsiveness > raw speed

Even if the operation is slow, make it feel fast:

- **Print something within 100ms.** If a network request is coming, signal immediately (spinner) before hanging.
- **Stream partial results** as they arrive rather than waiting for everything.
- **Show estimated time** for operations expected to take more than a few seconds.
- **Progress indicators** for all long operations.

## Network

- Show a spinner immediately when making network requests
- Set reasonable timeouts: 5s connect, 30s total. Let users override.
- Support `HTTP_PROXY` / `HTTPS_PROXY` env vars
- Cache HTTP responses where appropriate (ETag, If-Modified-Since)
- Support `--dry-run` to preview changes without network calls

## Parallel operations

- Parallel execution can dramatically improve perceived speed
- Use multi-progress display for parallel tasks (like `docker pull`)
- Be careful about interleaved output; use libraries with native multi-progress support
- When errors occur in parallel tasks, surface the logs clearly

## Perceived performance checklist

- [ ] First output appears within 100ms
- [ ] Spinner shows before any network request
- [ ] Progress bar for determinate operations
- [ ] Partial results stream as they arrive
- [ ] Long operations show estimated time
- [ ] Cache responses to avoid redundant requests
