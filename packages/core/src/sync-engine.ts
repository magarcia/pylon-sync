import type {
  FileState,
  FileSystem,
  ChangeSet,
  FileMutation,
  PluginData,
  Provider,
  SyncCursor,
  SyncResult,
  SyncSettings,
} from "./types";
import { PushConflictError } from "./types";
import { scan } from "./scanner";
import { applyMutations } from "./applier";
import { reconcile } from "./reconciler";
import { isTrackedPath } from "./tracked-path";
import { computeSnapshot } from "./snapshot";
import { hashText } from "./hash";

export interface SyncEngineCallbacks {
  onSaveData: (data: PluginData) => Promise<void>;
  onBeforeApply?: (paths: string[]) => void;
  onAfterApply?: () => void;
  onProgress?: (phase: string, current: number, total: number) => void;
}

const MAX_RETRIES = 5;

function log(...args: unknown[]) {
  console.log("[SyncEngine]", ...args);
}

export class SyncEngine {
  private fs: FileSystem;
  private provider: Provider;
  private settings: SyncSettings;
  private pluginData: PluginData;
  private callbacks: SyncEngineCallbacks;
  private syncing = false;

  constructor(
    fs: FileSystem,
    provider: Provider,
    settings: SyncSettings,
    pluginData: PluginData,
    callbacks: SyncEngineCallbacks,
  ) {
    this.fs = fs;
    this.provider = provider;
    this.settings = settings;
    this.pluginData = pluginData;
    this.callbacks = callbacks;
  }

  get isSyncing(): boolean {
    return this.syncing;
  }

  async sync(): Promise<SyncResult> {
    if (this.syncing) {
      log("Sync skipped — already in progress");
      return { status: "no-changes", mutations: [] };
    }
    this.syncing = true;

    try {
      const forceFullScan =
        this.pluginData.syncCount % this.settings.fullScanInterval === 0;
      log("Scanning local changes — forceFullScan:", forceFullScan, "syncCount:", this.pluginData.syncCount);
      this.callbacks.onProgress?.("Scanning", 0, 0);

      const localChanges = await scan(
        this.fs,
        this.pluginData.snapshot,
        this.pluginData.lastSyncTime,
        forceFullScan,
        this.settings.ignorePatterns,
        this.settings.syncObsidianSettings,
      );

      const localChangeCount = localChanges.added.size + localChanges.modified.size + localChanges.deleted.length;
      log("Local changes — added:", localChanges.added.size, "modified:", localChanges.modified.size, "deleted:", localChanges.deleted.length);
      this.callbacks.onProgress?.("Scanned local files", localChangeCount, 0);

      const localPaths = this.buildLocalPaths(localChanges);

      log("Fetching remote changes — cursor:", this.pluginData.cursor ? "present" : "none", "localPaths:", localPaths.size);
      this.callbacks.onProgress?.("Fetching remote changes", 0, 0);
      let fetchResult = await this.provider.fetch(this.pluginData.cursor, localPaths);

      if (fetchResult.cursor == null) {
        log("Empty repo detected — bootstrapping");
        const bootstrapCursor = await this.provider.bootstrap();
        fetchResult = await this.provider.fetch(bootstrapCursor);
      }

      const { changes: remoteChanges, cursor } = fetchResult;

      this.filterRemoteChanges(remoteChanges);

      const remoteChangeCount = remoteChanges.added.size + remoteChanges.modified.size + remoteChanges.deleted.length;
      log("Remote changes (after filter) — added:", remoteChanges.added.size, "modified:", remoteChanges.modified.size, "deleted:", remoteChanges.deleted.length);
      this.callbacks.onProgress?.("Fetched remote changes", remoteChangeCount, 0);

      const hasLocalChanges =
        localChanges.added.size > 0 ||
        localChanges.modified.size > 0 ||
        localChanges.deleted.length > 0;
      const hasRemoteChanges =
        remoteChanges.added.size > 0 ||
        remoteChanges.modified.size > 0 ||
        remoteChanges.deleted.length > 0;

      if (!hasLocalChanges && !hasRemoteChanges) {
        log("No changes on either side");
        return { status: "no-changes", mutations: [] };
      }

      let retries = 0;
      let currentCursor = cursor;
      let currentRemote = remoteChanges;

      while (retries < MAX_RETRIES) {
        const snapshotBases = await this.fetchMergeBases(localChanges, currentRemote);

        const mutations = reconcile(
          localChanges,
          currentRemote,
          snapshotBases,
          this.settings.binaryConflict,
        );

        for (const m of mutations) {
          if (m.content != null && !m.hash) {
            m.hash = await hashText(m.content);
          }
        }

        const newSnapshot = computeSnapshot(
          this.pluginData.snapshot,
          mutations,
        );

        const { files: pushFiles, deletions: pushDeletions } = this.buildPushPayload(mutations);

        let newCursor: SyncCursor | undefined;
        if (pushFiles.size > 0 || pushDeletions.length > 0) {
          this.callbacks.onProgress?.("Pushing", pushFiles.size + pushDeletions.length, 0);
          const snapshotSize = Object.keys(this.pluginData.snapshot).length;
          if (pushDeletions.length > snapshotSize / 2 && snapshotSize > 10) {
            log("WARNING: About to delete", pushDeletions.length, "of", snapshotSize, "files — this looks dangerous, aborting push");
            throw new Error(`Safety check: refusing to delete ${pushDeletions.length} of ${snapshotSize} files in one sync. This likely indicates a bug. Run a manual sync to resolve.`);
          }
          log("Pushing —", pushFiles.size, "files,", pushDeletions.length, "deletions");
          try {
            newCursor = await this.provider.push(
              { files: pushFiles, deletions: pushDeletions },
              currentCursor,
            );
            log("Push succeeded — new cursor:", newCursor);
          } catch (err) {
            if (err instanceof PushConflictError && retries < MAX_RETRIES - 1) {
              retries++;
              log("Push conflict — retry", retries, "of", MAX_RETRIES - 1);
              const refreshed = await this.provider.fetch(this.pluginData.cursor);
              currentCursor = refreshed.cursor;
              currentRemote = refreshed.changes;
              continue;
            }
            throw err;
          }
        } else {
          log("No remote changes to push — pull only");
        }

        const applyCount = mutations.filter(m => m.disk !== "skip").length;
        log("Applying", applyCount, "local mutations");
        if (applyCount > 0) {
          this.callbacks.onProgress?.("Applying", applyCount, 0);
        }
        const applyPaths = mutations.filter(m => m.disk !== "skip").map(m => m.path);
        this.callbacks.onBeforeApply?.(applyPaths);
        try {
          await applyMutations(this.fs, mutations);
        } finally {
          this.callbacks.onAfterApply?.();
        }

        this.pluginData.snapshot = newSnapshot;
        this.pluginData.lastSyncTime = Date.now();
        this.pluginData.syncCount++;
        this.pluginData.cursor = newCursor ?? currentCursor;
        await this.callbacks.onSaveData(this.pluginData);
        log("Snapshot saved — entries:", Object.keys(newSnapshot).length, "syncCount:", this.pluginData.syncCount);

        return { status: "success", mutations };
      }

      return {
        status: "error",
        mutations: [],
        error: new Error("Max retries exceeded"),
      };
    } catch (err) {
      return {
        status: "error",
        mutations: [],
        error: err instanceof Error ? err : new Error(String(err)),
      };
    } finally {
      this.syncing = false;
    }
  }

  private buildLocalPaths(localChanges: ChangeSet): Set<string> {
    const localPaths = new Set<string>();
    for (const path of Object.keys(this.pluginData.snapshot)) localPaths.add(path);
    for (const path of localChanges.added.keys()) localPaths.add(path);
    for (const path of localChanges.modified.keys()) localPaths.add(path);
    return localPaths;
  }

  private filterRemoteChanges(remote: ChangeSet): void {
    const filter = (map: Map<string, FileState>) => {
      for (const path of [...map.keys()]) {
        if (!isTrackedPath(path, this.settings.ignorePatterns, this.settings.syncObsidianSettings)) {
          map.delete(path);
        }
      }
    };
    filter(remote.added);
    filter(remote.modified);
    remote.deleted = remote.deleted.filter(
      p => isTrackedPath(p, this.settings.ignorePatterns, this.settings.syncObsidianSettings)
    );
  }

  private buildPushPayload(mutations: FileMutation[]): {
    files: Map<string, string | ArrayBuffer>;
    deletions: string[];
  } {
    const files = new Map<string, string | ArrayBuffer>();
    const deletions: string[] = [];

    for (const m of mutations) {
      if (m.remote === "write" && m.content != null) {
        files.set(m.path, m.content);
      }
      if (m.remote === "write" && m.binaryContent != null) {
        files.set(m.path, m.binaryContent);
      }
      if (m.remote === "delete") {
        deletions.push(m.path);
      }
    }

    return { files, deletions };
  }

  private async fetchMergeBases(
    localChanges: ChangeSet,
    remoteChanges: ChangeSet,
  ): Promise<Record<string, string>> {
    const snapshotBases: Record<string, string> = {};
    if (!this.pluginData.cursor || !this.provider.getBase) return snapshotBases;

    const concurrentPaths: string[] = [];
    for (const path of localChanges.modified.keys()) {
      if (remoteChanges.modified.has(path)) {
        concurrentPaths.push(path);
      }
    }
    for (const path of localChanges.added.keys()) {
      if (remoteChanges.added.has(path)) {
        concurrentPaths.push(path);
      }
    }

    const baseResults = await Promise.all(
      concurrentPaths.map(async (path) => ({
        path,
        content: await this.provider.getBase!(path, this.pluginData.cursor!),
      }))
    );
    for (const { path, content } of baseResults) {
      if (content !== null) {
        snapshotBases[path] = content;
      }
    }

    return snapshotBases;
  }
}
