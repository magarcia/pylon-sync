# ADR-007: Event Suppression During Apply

## Status

Accepted

## Date

2026-03-31

## Context

When the sync engine writes downloaded files to the vault via `applyMutations`, Obsidian fires `create` and `modify` vault events for each written file. The scheduler listens to these events to detect local changes and queue syncs. Without suppression, the scheduler interprets the just-written files as new local changes, queues another sync cycle, and re-uploads the files that were just downloaded. This creates an infinite sync loop.

Currently, we rely implicitly on the 2-second debounce to absorb these events — the sync finishes before the debounce fires. This is fragile: if the debounce timer fires during or just after apply, it triggers a redundant sync. With larger vaults or slower I/O, the window for this race condition grows.

Fit solves this with a `justDownloaded` flag. github-gitless-sync uses a similar approach.

See: `.project/COMPETITIVE-RESEARCH.md` (Priority 4: `justDownloaded` flag to prevent re-sync)

## Options Considered

### Option A: Flag-based suppression

- Set a boolean flag before `applyMutations`, check it in vault event handlers, clear after apply completes
- Pros: Simple to implement
- Cons: Suppresses ALL vault events during apply, including real user edits that happen concurrently. If a user edits a different file while sync is applying, that edit gets silently dropped from change detection.

### Option B: Path-based suppression

- Maintain a `Set<string>` of paths currently being written by the sync engine
- Before `applyMutations`, populate the set with all mutation paths that have `disk: "write"`
- In vault event handlers, skip the event if the path is in the set
- Clear the set after apply completes
- Pros: Only suppresses events for the exact files being written. Real user edits to other files are still detected. Precise and safe.
- Cons: Slightly more complex than a boolean flag. Set must be cleared in a `finally` block to avoid leaking.

### Option C: Scheduler pause

- Stop the scheduler entirely before apply, resume after
- Pros: Simple, no events processed at all during apply
- Cons: Same problem as Option A — real user edits during apply are lost. Additionally, if apply takes a long time, the scheduler gap could miss important changes.

### Option D: Debounce absorbs it (current implicit behavior)

- Rely on the 2-second debounce to absorb the vault events
- Pros: No code changes
- Cons: Fragile. Depends on apply completing within the debounce window. Fails silently with large vaults or slow I/O. The debounce timer may still fire and trigger a redundant sync that re-uploads everything.

## Decision

Option B. Maintain a `Set<string>` named `applyingPaths` in the plugin layer (where vault event handlers are registered).

Implementation plan:
1. Add an `applyingPaths: Set<string>` field to the plugin class
2. Before calling `applyMutations`, populate the set with all mutation paths where `disk === "write"` or `disk === "delete"`
3. In the vault event handlers (`create`, `modify`, `delete`), check if the event path is in `applyingPaths` — if so, remove it from the set and skip scheduling a sync
4. After `applyMutations` completes (in a `finally` block), clear the set to avoid leaking stale entries

## Consequences

- Eliminates the re-upload loop for downloaded files
- Real user edits to files not being written by sync are still detected and scheduled normally
- Path-specific suppression means concurrent user edits to other files are never lost
- The set must be cleared in `finally` to handle errors during apply
- Works for both text and binary file writes
- Removes the implicit dependency on debounce timing for correctness
