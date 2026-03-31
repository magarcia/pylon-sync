import { Plugin, Platform, Notice } from "obsidian";
import type { SyncSettings, PluginData, SyncState, SyncResult, Provider } from "@pylon-sync/core";
import { SyncEngine, SyncScheduler } from "@pylon-sync/core";
import { GitHubProvider, GitHubApiError, RateLimitError } from "@pylon-sync/provider-github";
import { S3Provider } from "@pylon-sync/provider-s3";
import type { S3Config } from "@pylon-sync/provider-s3";
import { VaultFileSystem } from "./vault-fs";
import { ObsidianHttpClient } from "./obsidian-http";
import { StatusBar } from "./ui/status-bar";
import { PylonSyncSettingTab, DEFAULT_SETTINGS } from "./ui/settings";
import {
  showSyncResult,
  showAuthError,
  showRateLimitError,
  showSyncConflictWarning,
} from "./ui/notices";

const GITHUB_TOKEN_KEY = "github-sync-token";
const S3_ACCESS_KEY_ID_KEY = "s3-access-key-id";
const S3_SECRET_KEY_KEY = "s3-secret-access-key";
const LOG_PREFIX = "[Pylon Sync]";

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}
function logWarn(...args: unknown[]) {
  console.warn(LOG_PREFIX, ...args);
}
function logError(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args);
}

export default class PylonSyncPlugin extends Plugin {
  settings: SyncSettings = DEFAULT_SETTINGS;
  token: string = "";
  s3AccessKeyId: string = "";
  s3SecretAccessKey: string = "";
  private pluginData: PluginData = {
    version: 1,
    snapshot: {},
    lastSyncTime: 0,
    syncCount: 0,
    cursor: null,
  };
  private syncEngine: SyncEngine | null = null;
  private scheduler: SyncScheduler | null = null;
  private statusBar: StatusBar | null = null;
  private visibilityHandler: (() => void) | null = null;
  private pollIntervalId: number | null = null;
  private applyingPaths = new Set<string>();
  private lastCredentials = "";
  private ribbonEl: HTMLElement | null = null;
  private syncNotice: Notice | null = null;

  private async loadSecret(key: string): Promise<string> {
    try {
      if ((this.app as any).secretStorage?.getSecret) {
        const secret = (this.app as any).secretStorage.getSecret(key);
        if (secret) return secret;
      }
    } catch (e) { logWarn("SecretStorage not available:", e); }

    try {
      const stored = (this.app as any).loadLocalStorage?.(key);
      if (stored) return stored;
    } catch (e) { logWarn("localStorage not available:", e); }

    return "";
  }

  async saveSecret(key: string, value: string): Promise<void> {
    try {
      if ((this.app as any).secretStorage?.setSecret) {
        (this.app as any).secretStorage.setSecret(key, value);
        return;
      }
    } catch (e) { logWarn("SecretStorage save failed, falling back:", e); }

    try {
      (this.app as any).saveLocalStorage?.(key, value);
    } catch (e) { logError("Failed to save secret:", e); }
  }

  async loadToken(): Promise<string> {
    return this.loadSecret(GITHUB_TOKEN_KEY);
  }

  async saveToken(token: string): Promise<void> {
    await this.saveSecret(GITHUB_TOKEN_KEY, token);
  }

  async loadS3Credentials(): Promise<{ accessKeyId: string; secretAccessKey: string }> {
    const accessKeyId = await this.loadSecret(S3_ACCESS_KEY_ID_KEY);
    const secretAccessKey = await this.loadSecret(S3_SECRET_KEY_KEY);
    return { accessKeyId, secretAccessKey };
  }

  async saveS3Credentials(accessKeyId: string, secretAccessKey: string): Promise<void> {
    await this.saveSecret(S3_ACCESS_KEY_ID_KEY, accessKeyId);
    await this.saveSecret(S3_SECRET_KEY_KEY, secretAccessKey);
  }

  async onload(): Promise<void> {
    log("Loading plugin...");
    await this.loadSettings();
    this.token = await this.loadToken();
    const s3Creds = await this.loadS3Credentials();
    this.s3AccessKeyId = s3Creds.accessKeyId;
    this.s3SecretAccessKey = s3Creds.secretAccessKey;
    await this.loadPluginData();
    log("Settings loaded — provider:", this.settings.provider);
    log("Plugin data — syncCount:", this.pluginData.syncCount, "cursor:", this.pluginData.cursor ? "present" : "none", "snapshot entries:", Object.keys(this.pluginData.snapshot).length);

    const statusBarEl = this.addStatusBarItem();
    this.statusBar = new StatusBar(statusBarEl);
    this.statusBar.update("idle");

    this.addSettingTab(new PylonSyncSettingTab(this.app, this));

    this.addCommand({
      id: "sync",
      name: "Sync now",
      callback: () => this.triggerSync(),
    });

    this.addCommand({
      id: "force-full-scan",
      name: "Force full scan",
      callback: () => this.triggerFullScan(),
    });

    this.addCommand({
      id: "reset-sync",
      name: "Reset sync data (start fresh)",
      callback: async () => {
        log("Resetting sync data...");
        this.teardownSync();
        this.pluginData = { version: 1, snapshot: {}, lastSyncTime: 0, syncCount: 0, cursor: null };
        await this.savePluginData();
        log("Sync data reset — snapshot cleared, cursor cleared");
        if (this.isProviderConfigured()) {
          this.initSync();
        }
      },
    });

    this.ribbonEl = this.addRibbonIcon("refresh-cw", "Sync now", () =>
      this.triggerSync(),
    );

    if (this.isProviderConfigured()) {
      log("Provider configured — deferring sync until layout ready");
      this.app.workspace.onLayoutReady(() => {
        log("Layout ready — initializing sync");
        this.initSync();
      });
    } else {
      log("Sync not initialized — provider not fully configured");
    }

    this.checkObsidianSync();
    log("Plugin loaded");
  }

  onunload(): void {
    this.teardownSync();
  }

  private teardownSync(): void {
    this.scheduler?.stop();
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.pollIntervalId !== null) {
      window.clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    this.syncEngine = null;
    this.scheduler = null;
  }

  isProviderConfigured(): boolean {
    if (this.settings.provider === "github") {
      return Boolean(this.token && this.settings.githubRepo);
    }
    return Boolean(
      this.s3AccessKeyId &&
      this.s3SecretAccessKey &&
      this.settings.s3Bucket &&
      this.settings.s3Endpoint,
    );
  }

  private createProvider(): Provider {
    const http = new ObsidianHttpClient();

    if (this.settings.provider === "s3") {
      const config: S3Config = {
        endpoint: this.settings.s3Endpoint,
        region: this.settings.s3Region || "auto",
        bucket: this.settings.s3Bucket,
        accessKeyId: this.s3AccessKeyId,
        secretAccessKey: this.s3SecretAccessKey,
        prefix: this.settings.s3Prefix || undefined,
        forcePathStyle: this.settings.s3ForcePathStyle,
      };
      return new S3Provider(config, http);
    }

    return new GitHubProvider(
      {
        token: this.token,
        repo: this.settings.githubRepo,
        branch: this.settings.branch,
        commitMessage: this.settings.commitMessage,
      },
      http,
    );
  }

  private initSync(): void {
    log("initSync — provider:", this.settings.provider);
    this.teardownSync();

    const vaultFs = new VaultFileSystem(this.app.vault, this.settings.syncObsidianSettings);
    const provider = this.createProvider();

    this.syncEngine = new SyncEngine(
      vaultFs,
      provider,
      this.settings,
      this.pluginData,
      {
        onSaveData: async (data) => {
          this.pluginData = data;
          await this.savePluginData();
        },
        onBeforeApply: (paths) => {
          for (const p of paths) this.applyingPaths.add(p);
        },
        onAfterApply: () => {
          this.applyingPaths.clear();
        },
        onProgress: (phase, current) => {
          if (this.syncNotice) {
            const msg = current > 0
              ? `Syncing: ${phase} (${current} files)...`
              : `Syncing: ${phase}...`;
            this.syncNotice.noticeEl.textContent = msg;
          }
        },
      },
    );

    const onStateChange = (state: SyncState) => {
      this.statusBar?.update(state);
    };

    this.scheduler = new SyncScheduler(
      () => this.runSync(),
      this.settings,
      onStateChange,
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateFileStatus();
      }),
    );

    if (this.settings.autoSync) {
      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          if (this.applyingPaths.has(file.path)) return;
          this.scheduler?.queueEvent(file.path);
        }),
      );
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (this.applyingPaths.has(file.path)) return;
          this.scheduler?.queueEvent(file.path);
        }),
      );
      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          if (this.applyingPaths.has(file.path)) return;
          this.scheduler?.queueEvent(file.path);
        }),
      );
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (this.applyingPaths.has(oldPath)) return;
          if (this.applyingPaths.has(file.path)) return;
          this.scheduler?.queueEvent(oldPath);
          this.scheduler?.queueEvent(file.path);
        }),
      );

      if (Platform.isMobile) {
        this.visibilityHandler = () => {
          this.scheduler?.triggerSync();
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);
      } else {
        this.pollIntervalId = window.setInterval(
          () => this.scheduler?.triggerSync(),
          this.settings.pollIntervalMs,
        );
        this.registerInterval(this.pollIntervalId);
      }

      this.scheduler.start();
      this.scheduler.triggerSync();
    }
  }

  private updateFileStatus(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file || !this.statusBar) return;

    const snapshotEntry = this.pluginData.snapshot[file.path];
    if (!snapshotEntry) {
      this.statusBar.setFileStatus("new");
    } else if (file.stat.mtime > this.pluginData.lastSyncTime) {
      this.statusBar.setFileStatus("modified");
    } else {
      this.statusBar.setFileStatus("synced");
    }
  }

  private async runSync(): Promise<SyncResult> {
    if (!this.syncEngine) {
      logWarn("runSync called but engine not initialized");
      return {
        status: "error",
        mutations: [],
        error: new Error("Sync not initialized"),
      };
    }

    log("Sync starting...");
    this.syncNotice = new Notice("Syncing...", 0);
    this.ribbonEl?.addClass("github-sync-ribbon-syncing");
    const startTime = Date.now();
    const result = await this.syncEngine.sync();
    const elapsed = Date.now() - startTime;
    this.syncNotice?.hide();
    this.syncNotice = null;
    this.ribbonEl?.removeClass("github-sync-ribbon-syncing");

    if (result.status === "success") {
      const changes = result.mutations.filter(m => m.disk !== "skip" || m.remote !== "skip");
      log(`Sync complete in ${elapsed}ms — ${changes.length} change(s), ${result.mutations.length} total mutations`);
      this.statusBar?.setLastSyncTime(Date.now());
    } else if (result.status === "no-changes") {
      log(`Sync complete in ${elapsed}ms — no changes`);
      new Notice("Already up to date", 2000);
    } else {
      logError(`Sync failed in ${elapsed}ms:`, result.error?.message);
    }

    if (result.status === "error" && result.error) {
      const isGitHubAuth =
        result.error instanceof GitHubApiError && result.error.status === 401;
      const isRateLimit = result.error instanceof RateLimitError;

      if (isGitHubAuth) {
        showAuthError();
      } else if (isRateLimit) {
        showRateLimitError(result.error.resetAt);
      } else {
        showSyncResult(result);
      }
    } else {
      showSyncResult(result);
    }

    return result;
  }

  private triggerSync(): void {
    if (!this.syncEngine) {
      new Notice("Pylon Sync: Configure your provider in settings first.");
      return;
    }
    this.scheduler?.triggerSync();
  }

  private triggerFullScan(): void {
    if (!this.syncEngine) return;
    this.pluginData.syncCount =
      Math.floor(this.pluginData.syncCount / this.settings.fullScanInterval) *
      this.settings.fullScanInterval;
    this.scheduler?.triggerSync();
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    if (data?.settings) {
      this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    }
    this.lastCredentials = this.buildCredentialsKey();
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings, pluginData: this.pluginData });

    const credentials = this.buildCredentialsKey();
    if (credentials !== this.lastCredentials) {
      this.lastCredentials = credentials;
      if (this.isProviderConfigured()) {
        try {
          this.initSync();
        } catch {
          // Invalid config — don't crash, wait for valid input
        }
      } else {
        this.teardownSync();
      }
    }
  }

  private buildCredentialsKey(): string {
    if (this.settings.provider === "s3") {
      return `s3:${this.s3AccessKeyId}:${this.settings.s3Bucket}:${this.settings.s3Endpoint}:${this.settings.s3Region}:${this.settings.s3Prefix}`;
    }
    return `github:${this.token}:${this.settings.githubRepo}:${this.settings.branch}`;
  }

  private async loadPluginData(): Promise<void> {
    const data = await this.loadData();
    if (data?.pluginData) {
      const pd = data.pluginData as PluginData;
      this.pluginData = {
        version: 1,
        snapshot: pd.snapshot ?? {},
        lastSyncTime: pd.lastSyncTime ?? 0,
        syncCount: pd.syncCount ?? 0,
        cursor: pd.cursor ?? null,
      };
    }
  }

  private async savePluginData(): Promise<void> {
    const data = ((await this.loadData()) as Record<string, unknown>) ?? {};
    data.pluginData = this.pluginData;
    await this.saveData(data);
  }

  private checkObsidianSync(): void {
    try {
      const internalPlugins = (this.app as any).internalPlugins as
        | { getPluginById?: (id: string) => { enabled?: boolean } | null }
        | undefined;
      if (internalPlugins?.getPluginById?.("sync")?.enabled) {
        showSyncConflictWarning();
      }
    } catch {
      // Internal API may not be available
    }
  }
}
