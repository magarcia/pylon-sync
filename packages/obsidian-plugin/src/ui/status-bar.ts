import type { SyncState } from "@pylon-sync/core";

export class StatusBar {
  private el: HTMLElement;
  private lastSyncTime: number | null = null;

  constructor(statusBarEl: HTMLElement) {
    this.el = statusBarEl;
  }

  update(state: SyncState): void {
    switch (state) {
      case "idle":
        this.el.setText(this.lastSyncTime ? "Synced" : "Pylon Sync");
        break;
      case "debouncing":
        this.el.setText("Sync pending...");
        break;
      case "syncing":
        this.el.setText("Syncing...");
        break;
      case "error":
        this.el.setText("Sync error");
        break;
    }
  }

  setLastSyncTime(time: number): void {
    this.lastSyncTime = time;
  }

  setFileStatus(status: "synced" | "modified" | "new" | null): void {
    if (status === null) return;
    const base = this.el.getText().split(" | ")[0];
    switch (status) {
      case "synced":
        this.el.setText(`${base} | \u2713`);
        break;
      case "modified":
        this.el.setText(`${base} | \u25CF`);
        break;
      case "new":
        this.el.setText(`${base} | +`);
        break;
    }
  }
}
