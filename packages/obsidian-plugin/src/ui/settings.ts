import { PluginSettingTab, Setting } from "obsidian";
import type { App, ButtonComponent, DropdownComponent } from "obsidian";
import type PylonSyncPlugin from "../main";
import type { S3Service } from "@pylon-sync/core";
import { DEFAULT_SYNC_SETTINGS as DEFAULT_SETTINGS } from "@pylon-sync/core";
import { GitHubConnection } from "@pylon-sync/provider-github";
import type { GitHubRepo } from "@pylon-sync/provider-github";
import { S3Api } from "@pylon-sync/provider-s3";
import { ObsidianHttpClient } from "../obsidian-http";

export { DEFAULT_SETTINGS };

interface S3Preset {
  readonly label: string;
  readonly endpoint: string;
  readonly region: string;
  readonly endpointPlaceholder: string;
  readonly regionPlaceholder: string;
  readonly forcePathStyle: boolean;
  readonly endpointEditable: boolean;
  readonly regionEditable: boolean;
}

const S3_PRESETS: Record<S3Service, S3Preset> = {
  aws: {
    label: "Amazon S3",
    endpoint: "",
    region: "",
    endpointPlaceholder: "https://s3.us-east-1.amazonaws.com",
    regionPlaceholder: "us-east-1",
    forcePathStyle: false,
    endpointEditable: false,
    regionEditable: true,
  },
  "cloudflare-r2": {
    label: "Cloudflare R2",
    endpoint: "",
    region: "auto",
    endpointPlaceholder: "https://<account-id>.r2.cloudflarestorage.com",
    regionPlaceholder: "auto",
    forcePathStyle: true,
    endpointEditable: true,
    regionEditable: false,
  },
  minio: {
    label: "MinIO",
    endpoint: "",
    region: "us-east-1",
    endpointPlaceholder: "https://minio.example.com:9000",
    regionPlaceholder: "us-east-1",
    forcePathStyle: true,
    endpointEditable: true,
    regionEditable: true,
  },
  "backblaze-b2": {
    label: "Backblaze B2",
    endpoint: "",
    region: "",
    endpointPlaceholder: "https://s3.us-west-004.backblazeb2.com",
    regionPlaceholder: "us-west-004",
    forcePathStyle: true,
    endpointEditable: false,
    regionEditable: true,
  },
  custom: {
    label: "Custom S3-compatible",
    endpoint: "",
    region: "",
    endpointPlaceholder: "https://s3.example.com",
    regionPlaceholder: "us-east-1",
    forcePathStyle: true,
    endpointEditable: true,
    regionEditable: true,
  },
};

function buildAwsEndpoint(region: string): string {
  return region ? `https://s3.${region}.amazonaws.com` : "";
}

function buildB2Endpoint(region: string): string {
  return region ? `https://s3.${region}.backblazeb2.com` : "";
}

// Cache fetched data to avoid re-fetching on every display()
let cachedRepos: GitHubRepo[] | null = null;
let cachedBranches: Map<string, string[]> = new Map();
let cachedUsername: string | null = null;
let cachedTokenForUser: string | null = null;

export class PylonSyncSettingTab extends PluginSettingTab {
  plugin: PylonSyncPlugin;

  constructor(app: App, plugin: PylonSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Invalidate GitHub cache if token changed
    if (cachedTokenForUser !== this.plugin.token) {
      cachedRepos = null;
      cachedBranches = new Map();
      cachedUsername = null;
      cachedTokenForUser = this.plugin.token;
    }

    containerEl.createEl("h2", { text: "Pylon Sync" });

    // Action buttons
    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Manually trigger a sync cycle")
      .addButton((btn) =>
        btn
          .setButtonText("Sync")
          .setCta()
          .onClick(async () => {
            btn.setButtonText("Syncing...");
            btn.setDisabled(true);
            try {
              (this.app as any).commands.executeCommandById(
                "pylon-sync:sync",
              );
            } finally {
              setTimeout(() => {
                btn.setButtonText("Sync");
                btn.setDisabled(false);
              }, 3000);
            }
          }),
      );

    new Setting(containerEl)
      .setName("Reset sync data")
      .setDesc("Clear snapshot and cursor — next sync will start fresh")
      .addButton((btn) =>
        btn
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            if (btn.buttonEl.dataset.confirming === "true") {
              (this.app as any).commands.executeCommandById(
                "pylon-sync:reset-sync",
              );
              btn.setButtonText("Reset!");
              delete btn.buttonEl.dataset.confirming;
              setTimeout(() => btn.setButtonText("Reset"), 2000);
            } else {
              btn.setButtonText("Click again to confirm");
              btn.buttonEl.dataset.confirming = "true";
              setTimeout(() => {
                btn.setButtonText("Reset");
                delete btn.buttonEl.dataset.confirming;
              }, 3000);
            }
          }),
      );

    // ── Provider selection ──
    containerEl.createEl("h3", { text: "Storage provider" });

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Where to sync your vault files")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("github", "GitHub")
          .addOption("s3", "S3-compatible storage")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as "github" | "s3";
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.provider === "github") {
      this.renderGitHubSettings(containerEl);
    } else {
      this.renderS3Settings(containerEl);
    }

    // ── Shared settings ──
    containerEl.createEl("h3", { text: "Sync behavior" });

    new Setting(containerEl)
      .setName("Auto sync")
      .setDesc("Automatically sync on file changes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Poll interval (seconds)")
      .setDesc("How often to check for remote changes (desktop only)")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.pollIntervalMs / 1000))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.pollIntervalMs = num * 1000;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Debounce delay (seconds)")
      .setDesc("Wait time after last change before syncing")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.debounceMs / 1000))
          .onChange(async (value) => {
            const num = parseFloat(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.debounceMs = num * 1000;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Sync .obsidian/ settings")
      .setDesc(
        "Include Obsidian configuration files (workspace files always excluded)",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncObsidianSettings)
          .onChange(async (value) => {
            this.plugin.settings.syncObsidianSettings = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Ignore patterns")
      .setDesc("Glob patterns to exclude from sync (one per line)")
      .addTextArea((text) =>
        text
          .setPlaceholder("*.mp4\ntemplates/\ndaily/2023-*")
          .setValue(this.plugin.settings.ignorePatterns.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.ignorePatterns = value
              .split("\n")
              .map((p) => p.trim())
              .filter((p) => p.length > 0);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Include hidden paths")
      .setDesc(
        "Dot-files or dot-folders normally hidden from Obsidian to include in sync (one per line)",
      )
      .addTextArea((text) =>
        text
          .setPlaceholder(".claude\n.github\n.gitignore")
          .setValue(this.plugin.settings.includePaths.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.includePaths = [
              ...new Set(
                value
                  .split("\n")
                  .map((p) => p.trim().replace(/^\.\//, "").replace(/\/+$/, ""))
                  .filter((p) => p.length > 0),
              ),
            ];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Binary conflict resolution")
      .setDesc("How to resolve conflicts for binary files")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("newest", "Newest wins")
          .addOption("local", "Local wins")
          .addOption("remote", "Remote wins")
          .setValue(this.plugin.settings.binaryConflict)
          .onChange(async (value) => {
            this.plugin.settings.binaryConflict = value as
              | "local"
              | "remote"
              | "newest";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Full scan interval")
      .setDesc(
        "Perform full hash scan every N syncs (catches mtime inconsistencies)",
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.fullScanInterval))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.fullScanInterval = num;
              await this.plugin.saveSettings();
            }
          }),
      );
  }

  // ── GitHub settings ──

  private renderGitHubSettings(containerEl: HTMLElement): void {
    // Token with Verify button
    const tokenSetting = new Setting(containerEl)
      .setName("GitHub token")
      .setDesc(
        "Personal access token with Contents read/write scope. Stored securely — never written to data.json.",
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("ghp_...")
          .setValue(this.plugin.token)
          .onChange(async (value) => {
            this.plugin.token = value;
            await this.plugin.saveToken(value);
            await this.plugin.saveSettings();
          });
      })
      .addButton((btn) =>
        btn.setButtonText("Verify").onClick(async () => {
          await this.verifyToken(btn);
        }),
      );

    if (cachedUsername) {
      tokenSetting.setDesc(
        `Authenticated as @${cachedUsername}. Token stored securely — never written to data.json.`,
      );
    }

    this.renderRepoSetting(containerEl);
    this.renderBranchSetting(containerEl);

    const commitMsgSetting = new Setting(containerEl)
      .setName("Commit message")
      .addText((text) =>
        text
          .setPlaceholder("vault: sync {{date}}")
          .setValue(this.plugin.settings.commitMessage)
          .onChange(async (value) => {
            this.plugin.settings.commitMessage = value;
            await this.plugin.saveSettings();
          }),
      );
    const descFragment = document.createDocumentFragment();
    descFragment.append(
      "Message used for sync commits. Supports template variables: ",
    );
    descFragment.createEl("code", { text: "{{date}}" });
    descFragment.append(", ");
    descFragment.createEl("code", { text: "{{time}}" });
    descFragment.append(", ");
    descFragment.createEl("code", { text: "{{datetime}}" });
    descFragment.append(", ");
    descFragment.createEl("code", { text: "{{timestamp}}" });
    commitMsgSetting.setDesc(descFragment);
  }

  // ── S3 settings ──

  private renderS3Settings(containerEl: HTMLElement): void {
    const preset = S3_PRESETS[this.plugin.settings.s3Service];

    // Service preset
    new Setting(containerEl)
      .setName("Service")
      .setDesc("Select your S3-compatible storage provider for auto-configured defaults")
      .addDropdown((dropdown) => {
        for (const [key, p] of Object.entries(S3_PRESETS)) {
          dropdown.addOption(key, p.label);
        }
        dropdown
          .setValue(this.plugin.settings.s3Service)
          .onChange(async (value) => {
            const service = value as S3Service;
            const newPreset = S3_PRESETS[service];
            this.plugin.settings.s3Service = service;

            // Auto-fill region from preset if it has a fixed value
            if (newPreset.region && !newPreset.regionEditable) {
              this.plugin.settings.s3Region = newPreset.region;
            }

            // Reset endpoint so it gets rebuilt from region
            this.plugin.settings.s3Endpoint = "";
            this.plugin.settings.s3ForcePathStyle = newPreset.forcePathStyle;

            await this.plugin.saveSettings();
            this.display();
          });
      });

    // Access Key ID
    new Setting(containerEl)
      .setName("Access key ID")
      .setDesc("Stored securely — never written to data.json")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("AKIA...")
          .setValue(this.plugin.s3AccessKeyId)
          .onChange(async (value) => {
            this.plugin.s3AccessKeyId = value;
            await this.plugin.saveS3Credentials(value, this.plugin.s3SecretAccessKey);
            await this.plugin.saveSettings();
          });
      });

    // Secret Access Key
    new Setting(containerEl)
      .setName("Secret access key")
      .setDesc("Stored securely — never written to data.json")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("wJalr...")
          .setValue(this.plugin.s3SecretAccessKey)
          .onChange(async (value) => {
            this.plugin.s3SecretAccessKey = value;
            await this.plugin.saveS3Credentials(this.plugin.s3AccessKeyId, value);
            await this.plugin.saveSettings();
          });
      });

    // Bucket
    new Setting(containerEl)
      .setName("Bucket")
      .setDesc("Name of the S3 bucket to sync with")
      .addText((text) =>
        text
          .setPlaceholder("my-vault-backup")
          .setValue(this.plugin.settings.s3Bucket)
          .onChange(async (value) => {
            this.plugin.settings.s3Bucket = value;
            await this.plugin.saveSettings();
          }),
      );

    // Region
    if (preset.regionEditable) {
      new Setting(containerEl)
        .setName("Region")
        .setDesc(this.getRegionDesc())
        .addText((text) =>
          text
            .setPlaceholder(preset.regionPlaceholder)
            .setValue(this.plugin.settings.s3Region)
            .onChange(async (value) => {
              this.plugin.settings.s3Region = value;
              this.autoFillEndpoint();
              await this.plugin.saveSettings();
            }),
        );
    }

    // Endpoint
    if (preset.endpointEditable) {
      new Setting(containerEl)
        .setName("Endpoint URL")
        .setDesc("Full URL to the S3-compatible API endpoint")
        .addText((text) =>
          text
            .setPlaceholder(preset.endpointPlaceholder)
            .setValue(this.plugin.settings.s3Endpoint)
            .onChange(async (value) => {
              this.plugin.settings.s3Endpoint = value;
              await this.plugin.saveSettings();
            }),
        );
    }

    // Prefix (optional)
    new Setting(containerEl)
      .setName("Path prefix")
      .setDesc("Optional folder prefix within the bucket (e.g. 'vault' syncs to s3://bucket/vault/)")
      .addText((text) =>
        text
          .setPlaceholder("vault")
          .setValue(this.plugin.settings.s3Prefix)
          .onChange(async (value) => {
            this.plugin.settings.s3Prefix = value.replace(/^\/+|\/+$/g, "");
            await this.plugin.saveSettings();
          }),
      );

    // Test connection button
    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Verify that your credentials and bucket are accessible")
      .addButton((btn) =>
        btn
          .setButtonText("Test")
          .onClick(async () => {
            await this.testS3Connection(btn);
          }),
      );
  }

  private getRegionDesc(): string {
    switch (this.plugin.settings.s3Service) {
      case "aws":
        return "AWS region where your bucket lives (e.g. us-east-1, eu-west-1)";
      case "backblaze-b2":
        return "B2 region for your bucket (e.g. us-west-004, eu-central-003)";
      default:
        return "Region identifier for your S3-compatible service";
    }
  }

  private autoFillEndpoint(): void {
    const { s3Service, s3Region } = this.plugin.settings;
    if (s3Service === "aws") {
      this.plugin.settings.s3Endpoint = buildAwsEndpoint(s3Region);
    } else if (s3Service === "backblaze-b2") {
      this.plugin.settings.s3Endpoint = buildB2Endpoint(s3Region);
    }
  }

  private async testS3Connection(btn: ButtonComponent): Promise<void> {
    const { s3Bucket, s3Endpoint, s3Region, s3ForcePathStyle } = this.plugin.settings;
    const { s3AccessKeyId, s3SecretAccessKey } = this.plugin;

    if (!s3AccessKeyId || !s3SecretAccessKey) {
      btn.setButtonText("Missing credentials");
      setTimeout(() => btn.setButtonText("Test"), 2000);
      return;
    }
    if (!s3Bucket || !s3Endpoint) {
      btn.setButtonText("Missing bucket/endpoint");
      setTimeout(() => btn.setButtonText("Test"), 2000);
      return;
    }

    btn.setButtonText("Testing...");
    btn.setDisabled(true);
    try {
      const http = new ObsidianHttpClient();
      const api = new S3Api(http, {
        endpoint: s3Endpoint,
        region: s3Region || "auto",
        bucket: s3Bucket,
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
        forcePathStyle: s3ForcePathStyle,
      });
      const exists = await api.headBucket();
      if (exists) {
        btn.setButtonText("\u2713 Connected");
      } else {
        btn.setButtonText("\u2717 Bucket not found");
      }
    } catch {
      btn.setButtonText("\u2717 Failed");
    }
    setTimeout(() => {
      btn.setButtonText("Test");
      btn.setDisabled(false);
    }, 3000);
  }

  // ── GitHub helpers ──

  private createConnection(): GitHubConnection {
    return new GitHubConnection(new ObsidianHttpClient(), this.plugin.token);
  }

  private async verifyToken(btn: ButtonComponent): Promise<void> {
    if (!this.plugin.token) {
      btn.setButtonText("No token");
      setTimeout(() => btn.setButtonText("Verify"), 2000);
      return;
    }

    btn.setButtonText("Checking...");
    btn.setDisabled(true);
    try {
      const conn = this.createConnection();
      const user = await conn.getUser();
      cachedUsername = user.login;
      cachedTokenForUser = this.plugin.token;
      btn.setButtonText(`\u2713 ${user.login}`);
      setTimeout(() => this.display(), 2000);
    } catch {
      cachedUsername = null;
      btn.setButtonText("\u2717 Failed");
      setTimeout(() => {
        btn.setButtonText("Verify");
        btn.setDisabled(false);
      }, 2000);
    }
  }

  private renderRepoSetting(containerEl: HTMLElement): void {
    const setting = new Setting(containerEl)
      .setName("Repository")
      .setDesc("GitHub repository in owner/repo format");

    if (cachedRepos && cachedRepos.length > 0) {
      setting.addDropdown((dropdown: DropdownComponent) => {
        dropdown.addOption("", "Select a repository...");
        for (const repo of cachedRepos!) {
          const label = repo.private
            ? `${repo.full_name} (private)`
            : repo.full_name;
          dropdown.addOption(repo.full_name, label);
        }
        dropdown
          .setValue(this.plugin.settings.githubRepo)
          .onChange(async (value) => {
            this.plugin.settings.githubRepo = value;
            cachedBranches.delete(value);
            this.plugin.settings.branch = "main";
            await this.plugin.saveSettings();
            this.display();
          });
      });
    } else {
      setting.addText((text) =>
        text
          .setPlaceholder("owner/repo")
          .setValue(this.plugin.settings.githubRepo)
          .onChange(async (value) => {
            this.plugin.settings.githubRepo = value;
            await this.plugin.saveSettings();
          }),
      );
    }

    setting.addButton((btn) =>
      btn.setButtonText("Browse").onClick(async () => {
        await this.loadRepos(btn);
      }),
    );
  }

  private async loadRepos(btn: ButtonComponent): Promise<void> {
    if (!this.plugin.token) {
      btn.setButtonText("No token");
      setTimeout(() => btn.setButtonText("Browse"), 2000);
      return;
    }

    btn.setButtonText("Loading...");
    btn.setDisabled(true);
    try {
      const conn = this.createConnection();
      cachedRepos = await conn.listRepos();
      this.display();
    } catch {
      btn.setButtonText("\u2717 Failed");
      setTimeout(() => {
        btn.setButtonText("Browse");
        btn.setDisabled(false);
      }, 2000);
    }
  }

  private renderBranchSetting(containerEl: HTMLElement): void {
    const repo = this.plugin.settings.githubRepo;
    const branches = cachedBranches.get(repo);
    const setting = new Setting(containerEl)
      .setName("Branch")
      .setDesc("Branch to sync with");

    if (branches && branches.length > 0) {
      setting.addDropdown((dropdown: DropdownComponent) => {
        for (const branch of branches) {
          dropdown.addOption(branch, branch);
        }
        dropdown
          .setValue(this.plugin.settings.branch)
          .onChange(async (value) => {
            this.plugin.settings.branch = value;
            await this.plugin.saveSettings();
          });
      });
    } else {
      setting.addText((text) =>
        text
          .setValue(this.plugin.settings.branch)
          .onChange(async (value) => {
            this.plugin.settings.branch = value;
            await this.plugin.saveSettings();
          }),
      );
    }

    setting.addButton((btn) =>
      btn.setButtonText("Load").onClick(async () => {
        await this.loadBranches(btn);
      }),
    );
  }

  private async loadBranches(btn: ButtonComponent): Promise<void> {
    const repo = this.plugin.settings.githubRepo;
    if (!this.plugin.token || !repo || !repo.includes("/")) {
      btn.setButtonText("Need token & repo");
      setTimeout(() => btn.setButtonText("Load"), 2000);
      return;
    }

    btn.setButtonText("Loading...");
    btn.setDisabled(true);
    try {
      const conn = this.createConnection();
      const branches = await conn.listBranches(repo);
      cachedBranches.set(repo, branches);
      this.display();
    } catch {
      btn.setButtonText("\u2717 Failed");
      setTimeout(() => {
        btn.setButtonText("Load");
        btn.setDisabled(false);
      }, 2000);
    }
  }
}
