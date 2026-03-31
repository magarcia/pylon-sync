import DiffMatchPatch from "diff-match-patch";
import type { ChangeSet, FileMutation, FileState } from "./types";

const dmp = new DiffMatchPatch();

export function mergeText(
  base: string | null,
  local: string,
  remote: string,
): { merged: string; clean: boolean } {
  if (local === remote) return { merged: local, clean: true };
  if (local === base) return { merged: remote, clean: true };
  if (remote === base) return { merged: local, clean: true };

  if (base === null) {
    // Two-way merge: create patches from local->remote, apply to local
    const diffs = dmp.diff_main(local, remote);
    dmp.diff_cleanupSemantic(diffs);
    const patches = dmp.patch_make(local, diffs);
    const [result, applied] = dmp.patch_apply(patches, local);
    const clean = applied.every(Boolean);
    return { merged: result, clean };
  }

  // Three-way merge: apply local patches first, then remote patches
  const localDiffs = dmp.diff_main(base, local);
  dmp.diff_cleanupSemantic(localDiffs);
  const localPatches = dmp.patch_make(base, localDiffs);

  const remoteDiffs = dmp.diff_main(base, remote);
  dmp.diff_cleanupSemantic(remoteDiffs);
  const remotePatches = dmp.patch_make(base, remoteDiffs);

  // Apply local patches to base first
  const [afterLocal, localApplied] = dmp.patch_apply(localPatches, base);
  // Apply remote patches to the result
  const [merged, remoteApplied] = dmp.patch_apply(remotePatches, afterLocal);

  const clean = localApplied.every(Boolean) && remoteApplied.every(Boolean);
  return { merged, clean };
}

function resolveBinaryConflict(
  path: string,
  localState: FileState & { type: "binary" },
  remoteState: FileState & { type: "binary" },
  binaryConflict: "local" | "remote" | "newest",
): FileMutation {
  let useLocal: boolean;

  if (binaryConflict === "local") {
    useLocal = true;
  } else if (binaryConflict === "remote") {
    useLocal = false;
  } else {
    // newest: compare modified timestamps
    useLocal = localState.modified >= remoteState.modified;
  }

  if (useLocal) {
    return {
      path,
      disk: "skip",
      remote: "write",
      source: "local",
      hash: localState.hash,
      modified: localState.modified,
      binaryContent: localState.data,
    };
  }
  return {
    path,
    disk: "write",
    remote: "skip",
    source: "remote",
    hash: remoteState.hash,
    modified: remoteState.modified,
    binaryContent: remoteState.data,
  };
}

function toMutation(
  path: string,
  state: FileState,
  disk: "write" | "skip",
  remote: "write" | "skip",
  source: "local" | "remote",
): FileMutation {
  if (state.type === "text") {
    return { path, disk, remote, content: state.content, source };
  }
  return {
    path,
    disk,
    remote,
    source,
    hash: state.hash,
    modified: state.modified,
    binaryContent: state.data,
  };
}

export function reconcile(
  local: ChangeSet,
  remote: ChangeSet,
  snapshotBases: Record<string, string>,
  binaryConflict: "local" | "remote" | "newest",
): FileMutation[] {
  const mutations: FileMutation[] = [];
  const processed = new Set<string>();

  // Collect all paths that appear in either changeset
  const allPaths = new Set<string>();

  for (const path of local.added.keys()) allPaths.add(path);
  for (const path of local.modified.keys()) allPaths.add(path);
  for (const path of local.deleted) allPaths.add(path);
  for (const path of remote.added.keys()) allPaths.add(path);
  for (const path of remote.modified.keys()) allPaths.add(path);
  for (const path of remote.deleted) allPaths.add(path);

  const remoteDeletedSet = new Set(remote.deleted);
  const localDeletedSet = new Set(local.deleted);

  for (const path of allPaths) {
    if (processed.has(path)) continue;
    processed.add(path);

    const localAdded = local.added.get(path);
    const localModified = local.modified.get(path);
    const localDeleted = localDeletedSet.has(path);
    const remoteAdded = remote.added.get(path);
    const remoteModified = remote.modified.get(path);
    const remoteDeleted = remoteDeletedSet.has(path);

    const localState = localAdded ?? localModified;
    const remoteState = remoteAdded ?? remoteModified;
    const localChanged = localState != null || localDeleted;
    const remoteChanged = remoteState != null || remoteDeleted;

    if (!localChanged && !remoteChanged) continue;

    // Deleted on both sides
    if (localDeleted && remoteDeleted) {
      mutations.push({ path, disk: "skip", remote: "skip" });
      continue;
    }

    // Local deleted, remote edited -> restore remote
    if (localDeleted && remoteState) {
      mutations.push(toMutation(path, remoteState, "write", "skip", "remote"));
      continue;
    }

    // Remote deleted, local edited -> preserve local
    if (remoteDeleted && localState) {
      mutations.push(toMutation(path, localState, "skip", "write", "local"));
      continue;
    }

    // Only local changed (no remote change)
    if (localState && !remoteChanged) {
      mutations.push(toMutation(path, localState, "skip", "write", "local"));
      continue;
    }

    // Only remote changed (no local change)
    if (remoteState && !localChanged) {
      mutations.push(toMutation(path, remoteState, "write", "skip", "remote"));
      continue;
    }

    // Both sides changed (concurrent edits or concurrent creates)
    if (localState && remoteState) {
      // Both text -> merge
      if (localState.type === "text" && remoteState.type === "text") {
        const base = snapshotBases[path] ?? null;
        const { merged } = mergeText(
          base,
          localState.content,
          remoteState.content,
        );
        mutations.push({
          path,
          disk: "write",
          remote: "write",
          content: merged,
          source: "merged",
        });
        continue;
      }

      // At least one side is binary -> use binaryConflict setting
      if (localState.type === "binary" || remoteState.type === "binary") {
        const localBinary: FileState & { type: "binary" } =
          localState.type === "binary"
            ? localState
            : { type: "binary", hash: "", modified: 0, data: new ArrayBuffer(0) };
        const remoteBinary: FileState & { type: "binary" } =
          remoteState.type === "binary"
            ? remoteState
            : { type: "binary", hash: "", modified: 0, data: new ArrayBuffer(0) };
        mutations.push(
          resolveBinaryConflict(path, localBinary, remoteBinary, binaryConflict),
        );
        continue;
      }
    }

    // Local deleted only (remote unchanged)
    if (localDeleted && !remoteChanged) {
      mutations.push({ path, disk: "skip", remote: "delete", source: "local" });
      continue;
    }

    // Remote deleted only (local unchanged)
    if (remoteDeleted && !localChanged) {
      mutations.push({
        path,
        disk: "delete",
        remote: "skip",
        source: "remote",
      });
      continue;
    }
  }

  return mutations;
}
