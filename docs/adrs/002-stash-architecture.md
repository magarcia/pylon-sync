# ADR-002: Architecture Inspired by Stash

## Status

Accepted

## Date

2026-03-29

## Context

We need a sync architecture that supports incremental change detection, three-way text merging, and conflict resolution. Rather than designing from scratch, we evaluated existing open-source implementations.

## Options Considered

### Option A: Build from scratch
- Pros: Full control, tailored to Obsidian
- Cons: Complex reconciliation logic is error-prone, significant design effort

### Option B: Port Stash's architecture (telepath-computer/stash, MIT license)
- Pros: Proven reconciliation logic, well-documented (6 docs covering architecture, sync lifecycle, reconciliation, provider contract), pure functions easy to port, same diff-match-patch library Obsidian Sync uses
- Cons: Some adaptation needed (Node fs → Vault API, fetch → requestUrl, streams → ArrayBuffer)

## Decision

Option B — adapt the five-layer architecture from Stash (telepath-computer/stash): Reconciler (pure functions), Provider (API transport), Scanner (filesystem), Scheduler (events), Locking (in-memory flag). The reconciliation logic (`reconcile()` and `mergeText()`) ported as pure functions with no platform dependencies. Pylon Sync has since diverged significantly: provider-agnostic interface with opaque cursors, git-tree-based remote detection (no metadata files), ZIP archive downloads, and a monorepo structure with CLI companion.

## Consequences

- Reconciliation logic is well-tested, not custom
- Architecture evolved beyond the original Stash design with provider abstraction, platform abstractions (FileSystem, HttpClient), and a monorepo structure
- Well-documented for future contributors
