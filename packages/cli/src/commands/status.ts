import { scan, DEFAULT_SYNC_SETTINGS } from "@pylon-sync/core";
import { NodeFileSystem } from "../node-fs";
import { loadConfig, loadData } from "../config";

export interface StatusCommandOptions {
  outputJson?: boolean;
}

export async function statusCommand(
  dir: string,
  options: StatusCommandOptions = {},
): Promise<void> {
  await loadConfig(dir);
  const data = await loadData(dir);

  const fs = new NodeFileSystem(dir);
  const changes = await scan(
    fs,
    data.snapshot,
    data.lastSyncTime,
    false,
    DEFAULT_SYNC_SETTINGS,
  );

  const total =
    changes.added.size + changes.modified.size + changes.deleted.length;

  if (options.outputJson) {
    console.log(
      JSON.stringify({
        total,
        added: [...changes.added.keys()],
        modified: [...changes.modified.keys()],
        deleted: changes.deleted,
        lastSyncTime: data.lastSyncTime || null,
      }),
    );
  } else {
    if (total === 0) {
      console.log("No local changes");
    } else {
      for (const path of changes.added.keys()) console.log(`  + ${path}`);
      for (const path of changes.modified.keys()) console.log(`  ~ ${path}`);
      for (const path of changes.deleted) console.log(`  - ${path}`);
      console.log(`${total} file(s) changed since last sync`);
    }
    console.log(
      `Last sync: ${data.lastSyncTime ? new Date(data.lastSyncTime).toLocaleString() : "never"}`,
    );
  }
}
