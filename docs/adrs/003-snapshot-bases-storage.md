# ADR-003: Store Snapshot Bases as Individual Adapter Files

## Status

Accepted

## Date

2026-03-29

## Context

Three-way text merging requires storing the "base" version of each synced text file (the common ancestor for future merges). The CLI stores these in a `.pylon/snapshot/` directory on disk. In Obsidian, plugin data is typically stored via `plugin.saveData()` which writes to a single `data.json` file.

Storing all bases in `data.json` would bloat it — a vault with 3,000 markdown files could produce tens of megabytes of JSON, parsed and serialized on every `saveData()`/`loadData()` call. This is especially problematic on mobile where JSON.parse is slower.

## Options Considered

### Option A: Store bases in data.json alongside snapshot
- Pros: Simple, atomic save
- Cons: data.json grows unbounded, slow parse on mobile, entire file rewritten on every sync

### Option B: Store bases as individual files via vault.adapter
- Pros: Only touched files' bases are read/written, no JSON parse overhead, scales to large vaults
- Cons: More filesystem operations, need to manage cleanup of orphaned bases

### Option C: Don't store bases at all (two-way merge only)
- Pros: Simplest, no storage concern
- Cons: Poor merge quality — two-way merge can't distinguish "both added" from "both modified"

## Decision

Option B — store bases as individual files under `.obsidian/plugins/pylon-sync/bases/` using `vault.adapter.write()` and `vault.adapter.read()`. File paths are encoded (replace `/` with `__`) to create flat filenames. Bases for deleted files are cleaned up during snapshot computation.

## Consequences

- data.json stays small (only snapshot map + settings)
- Each sync only reads/writes bases for changed files
- Must use vault.adapter (not vault.create/modify) since these are hidden plugin files
- Cleanup logic needed when files are deleted from sync
