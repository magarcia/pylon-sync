import type { FileSystem, FileEntry, ChangeSet, FileState, SnapshotEntry } from "./types";
import { hashText } from "./hash";
import { isTrackedPath } from "./tracked-path";
import { classifyContent } from "./classify";

// GitHub rejects files larger than 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

export async function readFileState(
  fs: FileSystem,
  file: FileEntry,
): Promise<FileState> {
  const buffer = await fs.readBinary(file.path);
  return classifyContent(buffer, file.mtime);
}

export async function scan(
  fs: FileSystem,
  snapshot: Record<string, SnapshotEntry>,
  lastSyncTime: number,
  forceFullScan: boolean,
  ignorePatterns: string[],
  syncObsidianSettings: boolean,
): Promise<ChangeSet> {
  const added = new Map<string, FileState>();
  const modified = new Map<string, FileState>();
  const deleted: string[] = [];

  const allFiles = await fs.list();
  const trackedFiles = allFiles.filter((f) =>
    isTrackedPath(f.path, ignorePatterns, syncObsidianSettings),
  );

  const trackedPaths = new Set<string>();

  for (const file of trackedFiles) {
    if (file.size > MAX_FILE_SIZE) {
      console.warn(`[Scanner] Skipping file exceeding 100MB limit: ${file.path} (${file.size} bytes)`);
      continue;
    }

    trackedPaths.add(file.path);
    const entry = snapshot[file.path];

    if (!entry) {
      try {
        const state = await readFileState(fs, file);
        added.set(file.path, state);
      } catch {
        continue;
      }
      continue;
    }

    if (!forceFullScan && file.mtime <= lastSyncTime) {
      continue;
    }

    try {
      const state = await readFileState(fs, file);
      const currentHash =
        state.type === "text" ? await hashText(state.content) : state.hash;

      if (currentHash !== entry.hash) {
        modified.set(file.path, state);
      }
    } catch {
      continue;
    }
  }

  for (const path of Object.keys(snapshot)) {
    if (!trackedPaths.has(path)) {
      deleted.push(path);
    }
  }

  return { added, modified, deleted };
}
