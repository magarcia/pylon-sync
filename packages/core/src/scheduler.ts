import type { SyncState, SyncSettings, SyncResult } from "./types";

export interface SyncFunction {
  (): Promise<SyncResult>;
}

export class SyncScheduler {
  private _state: SyncState = "idle";
  private pending = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly MAX_DEBOUNCE_MS = 30000;
  private syncFn: SyncFunction;
  private settings: SyncSettings;
  private onStateChange: (state: SyncState) => void;

  constructor(
    syncFn: SyncFunction,
    settings: SyncSettings,
    onStateChange: (state: SyncState) => void
  ) {
    this.syncFn = syncFn;
    this.settings = settings;
    this.onStateChange = onStateChange;
  }

  get state(): SyncState {
    return this._state;
  }

  private setState(state: SyncState): void {
    this._state = state;
    this.onStateChange(state);
  }

  start(): void {
    this.stopped = false;
  }

  stop(): void {
    this.stopped = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxDebounceTimer) {
      clearTimeout(this.maxDebounceTimer);
      this.maxDebounceTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pending = false;
  }

  queueEvent(_path: string): void {
    if (this.stopped) return;

    if (this._state === "syncing") {
      this.pending = true;
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.setState("debouncing");
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.runSync();
    }, this.settings.debounceMs);

    if (!this.maxDebounceTimer) {
      this.maxDebounceTimer = setTimeout(() => {
        this.maxDebounceTimer = null;
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        this.runSync();
      }, this.MAX_DEBOUNCE_MS);
    }
  }

  triggerSync(): void {
    if (this.stopped) return;

    if (this._state === "syncing") {
      this.pending = true;
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.runSync();
  }

  private async runSync(): Promise<void> {
    if (this.maxDebounceTimer) {
      clearTimeout(this.maxDebounceTimer);
      this.maxDebounceTimer = null;
    }
    this.setState("syncing");
    let isError = false;
    try {
      const result = await this.syncFn();
      if (result.status === "error") {
        isError = true;
      }
    } catch {
      isError = true;
    }

    if (this.stopped) return;

    if (isError) {
      this.setState("error");
    }

    if (isError && !this.pending && !this.stopped) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.runSync();
      }, 30000);
      return;
    }

    if (this.pending) {
      this.pending = false;
      this.setState("debouncing");
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.runSync();
      }, this.settings.debounceMs);
    } else if (!isError) {
      this.setState("idle");
    }
  }
}
