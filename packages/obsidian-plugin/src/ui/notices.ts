import { Notice } from "obsidian";
import type { SyncResult } from "@pylon-sync/core";

export function showSyncResult(result: SyncResult): void {
  if (result.status === "success") {
    const count = result.mutations.filter(
      (m) => m.disk !== "skip" || m.remote !== "skip",
    ).length;
    if (count > 0) {
      new Notice(`Synced: ${count} change${count !== 1 ? "s" : ""}`, 3000);
    }
  } else if (result.status === "error" && result.error) {
    const msg = result.error.message
      .replace(/https?:\/\/[^\s]+/g, "[API]")
      .replace(/\/repos\/[^\s]+/g, "[endpoint]");
    new Notice(`Sync error: ${msg}`, 0);
  }
}

export function showAuthError(): void {
  new Notice(
    "Pylon Sync: Authentication failed. Check your token in settings.",
    0,
  );
}

export function showRateLimitError(resetAt: Date): void {
  const time = resetAt.toLocaleTimeString();
  new Notice(`Pylon Sync: Rate limit exceeded. Resets at ${time}.`, 0);
}

export function showSyncConflictWarning(): void {
  new Notice(
    "Pylon Sync: Obsidian Sync is also active. Consider disabling one to avoid conflicts.",
    0,
  );
}
