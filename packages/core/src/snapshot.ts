import type { FileMutation, SnapshotEntry } from "./types";

/**
 * Builds the next snapshot from the old snapshot and reconciliation mutations.
 * Entries for deleted files are removed, written files are updated, skipped files are preserved.
 */
export function computeSnapshot(
  oldSnapshot: Record<string, SnapshotEntry>,
  mutations: FileMutation[]
): Record<string, SnapshotEntry> {
  const snapshot: Record<string, SnapshotEntry> = { ...oldSnapshot };

  for (const mutation of mutations) {
    if (mutation.disk === "delete" || mutation.remote === "delete") {
      delete snapshot[mutation.path];
      continue;
    }

    if (mutation.hash) {
      const mtime = mutation.modified ?? Date.now();
      snapshot[mutation.path] = { hash: mutation.hash, mtime };
    }
  }

  return snapshot;
}

