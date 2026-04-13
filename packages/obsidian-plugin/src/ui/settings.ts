import { PluginSettingTab, Setting, Notice } from "obsidian";
import type { App, ButtonComponent, DropdownComponent } from "obsidian";
import type PylonSyncPlugin from "../main";
import { DEFAULT_SYNC_SETTINGS as DEFAULT_SETTINGS } from "@pylon-sync/core";
import { GitHubConnection } from "@pylon-sync/provider-github";
import type { GitHubRepo, GitHubInstallation } from "@pylon-sync/provider-github";
import { ObsidianHttpClient } from "../obsidian-http";
import { DeviceFlowModal } from "./device-flow-modal";
import { isGitHubDotCom, TokenRefreshError } from "@pylon-sync/auth-github";

export { DEFAULT_SETTINGS };

export class PylonSyncSettingTab extends PluginSettingTab {
  plugin: PylonSyncPlugin;
  private cachedRepos: GitHubRepo[] | null = null;
  private cachedBranches: Map<string, string[]> = new Map();
  private cachedUsername: string | null = null;
  private cachedTokenForUser: string | null = null;
  private cachedInstallations: GitHubInstallation[] | null = null;
  private cachedInstallationId: number | null = null;

  constructor(app: App, plugin: PylonSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Whether the user is authenticated (either GitHub App or PAT).
  private isAuthenticated(): boolean {
    if (this.plugin.settings.githubAuthMethod === "github-app") {
      return Boolean(this.plugin.authManager?.hasTokenSet);
    }
    return Boolean(this.plugin.token);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Invalidate GitHub cache if token changed
    if (this.cachedTokenForUser !== this.plugin.token) {
      this.cachedRepos = null;
      this.cachedBranches = new Map();
      this.cachedUsername = null;
      this.cachedTokenForUser = this.plugin.token;
    }

    containerEl.createEl("h2", { text: "Pylon Sync" });

    // Eagerly populate the username cache for GitHub App users so the
    // settings tab shows "Signed in as @user" without requiring interaction.
    if (
      this.plugin.settings.githubAuthMethod === "github-app" &&
      this.plugin.authManager?.hasTokenSet &&
      !this.cachedUsername
    ) {
      void this.refreshUsernameAndRedisplay();
      return;
    }

    this.renderGitHubSettings(containerEl);

    // Only show action buttons and sync behavior after authentication.
    if (!this.isAuthenticated()) return;

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

    // ── Sync behavior ──
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

    // ── Selective sync ──
    containerEl.createEl("h3", { text: "Selective sync" });

    new Setting(containerEl)
      .setName("Excluded folders")
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
      .setName("Sync images")
      .setDesc(
        "Sync image files with these extensions: bmp, png, jpg, jpeg, gif, svg, webp, avif, ico, tiff, tif",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncImages)
          .onChange(async (value) => {
            this.plugin.settings.syncImages = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sync audio")
      .setDesc(
        "Sync audio files with these extensions: mp3, webm, wav, m4a, ogg, 3gp, flac, opus, aac, wma, aiff",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncAudio)
          .onChange(async (value) => {
            this.plugin.settings.syncAudio = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sync videos")
      .setDesc(
        "Sync video files with these extensions: mp4, mkv, avi, mov, ogv, m4v",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncVideos)
          .onChange(async (value) => {
            this.plugin.settings.syncVideos = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sync PDFs")
      .setDesc("Sync PDF files")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncPDFs)
          .onChange(async (value) => {
            this.plugin.settings.syncPDFs = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sync all other types")
      .setDesc("Sync all other file types not listed above")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncAllOtherTypes)
          .onChange(async (value) => {
            this.plugin.settings.syncAllOtherTypes = value;
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

    // ── Vault configuration sync ──
    containerEl.createEl("h3", { text: "Vault configuration sync" });

    new Setting(containerEl)
      .setName("Main settings")
      .setDesc(
        "Sync editor settings, file & link settings, and other app configuration",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncMainSettings)
          .onChange(async (value) => {
            this.plugin.settings.syncMainSettings = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Appearance settings")
      .setDesc(
        "Sync appearance settings like dark mode, accent color, and font",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncAppearanceSettings)
          .onChange(async (value) => {
            this.plugin.settings.syncAppearanceSettings = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Themes and snippets")
      .setDesc("Sync installed themes and CSS snippets")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncThemesAndSnippets)
          .onChange(async (value) => {
            this.plugin.settings.syncThemesAndSnippets = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hotkeys")
      .setDesc("Sync custom hotkeys")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncHotkeys)
          .onChange(async (value) => {
            this.plugin.settings.syncHotkeys = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Active core plugin list")
      .setDesc("Sync which core plugins are enabled")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncActiveCorePluginList)
          .onChange(async (value) => {
            this.plugin.settings.syncActiveCorePluginList = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Core plugin settings")
      .setDesc("Sync core plugin settings")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncCorePluginSettings)
          .onChange(async (value) => {
            this.plugin.settings.syncCorePluginSettings = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Active community plugin list")
      .setDesc("Sync which community plugins are enabled")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncActiveCommunityPluginList)
          .onChange(async (value) => {
            this.plugin.settings.syncActiveCommunityPluginList = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Installed community plugins")
      .setDesc(
        "Sync installed community plugins (js, css, and manifest.json files and their settings)",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncInstalledCommunityPlugins)
          .onChange(async (value) => {
            this.plugin.settings.syncInstalledCommunityPlugins = value;
            await this.plugin.saveSettings();
          }),
      );

    // ── Advanced ──
    this.renderAdvancedSettings(containerEl);
  }

  // ── GitHub settings ──

  private renderGitHubSettings(containerEl: HTMLElement): void {
    const onCustomHost = !isGitHubDotCom(this.plugin.settings.githubHost);
    const hasCustomClientId =
      this.plugin.settings.githubCustomClientId.trim().length > 0;
    // On non-github.com hosts, device flow only works if the user provided
    // their own GitHub App client_id for that instance.
    const canUseGitHubApp = !onCustomHost || hasCustomClientId;

    // Auth method selector. Hidden on custom hosts without a client_id,
    // where PAT is the only option.
    if (canUseGitHubApp) {
      new Setting(containerEl)
        .setName("Authentication")
        .setDesc(
          "Sign in with the Pylon Sync GitHub App for fine-grained, per-repository access. Or use a personal access token.",
        )
        .addDropdown((dropdown) =>
          dropdown
            .addOption("github-app", "Sign in with GitHub")
            .addOption("pat", "Personal access token")
            .setValue(this.plugin.settings.githubAuthMethod)
            .onChange(async (value) => {
              this.plugin.settings.githubAuthMethod =
                value === "pat" ? "pat" : "github-app";
              // Clear caches when switching modes.
              this.cachedRepos = null;
              this.cachedInstallations = null;
              this.cachedInstallationId = null;
              this.cachedUsername = null;
              await this.plugin.saveSettings();
              this.display();
            }),
        );
    } else {
      containerEl.createEl("p", {
        text:
          "GitHub Enterprise Server: sign-in with GitHub App requires a custom client_id (see Advanced). Using personal access token.",
        cls: "setting-item-description",
      });
      // Force PAT mode silently.
      if (this.plugin.settings.githubAuthMethod !== "pat") {
        this.plugin.settings.githubAuthMethod = "pat";
        void this.plugin.saveSettings();
      }
    }

    if (this.plugin.settings.githubAuthMethod === "github-app") {
      this.renderGitHubAppAuth(containerEl);
    } else {
      this.renderPatAuth(containerEl);
    }

    this.renderBranchSetting(containerEl);
  }

  // Sign-in button, username display, installation-based repo picker.
  private renderGitHubAppAuth(containerEl: HTMLElement): void {
    const manager = this.plugin.authManager;

    // We don't know sync-read "signed in?" status here without async, so we
    // render based on what the manager's settings imply. The first
    // meaningful render happens right after a successful sign-in via the
    // modal, which calls this.display() anyway.
    const signInSetting = new Setting(containerEl).setName("GitHub account");

    if (this.cachedUsername) {
      signInSetting.setDesc(`Signed in as @${this.cachedUsername}`);
      signInSetting.addButton((btn) =>
        btn
          .setButtonText("Sign out")
          .setWarning()
          .onClick(async () => {
            await this.plugin.ensureAuthManager().signOut();
            this.cachedUsername = null;
            this.cachedInstallations = null;
            this.cachedInstallationId = null;
            this.cachedRepos = null;
            this.plugin.settings.githubRepo = "";
            await this.plugin.saveSettings();
            this.display();
          }),
      );
    } else {
      signInSetting.setDesc(
        "Not signed in. Sign in with GitHub to pick a repository.",
      );
      signInSetting.addButton((btn) =>
        btn
          .setButtonText("Sign in with GitHub")
          .setCta()
          .onClick(() => {
            const authManager = this.plugin.ensureAuthManager();
            const modal = new DeviceFlowModal(this.app, authManager, () => {
              // After successful sign-in, fetch the username and refresh the
              // settings view so the installation picker appears.
              void this.refreshUsernameAndRedisplay();
            });
            modal.open();
          }),
      );
      // Haven't signed in yet → don't render repo picker.
      return;
    }

    this.renderInstallationPicker(containerEl);
    this.renderInstallationRepoPicker(containerEl);
    // Only show the repo text fallback when no installations came back.
    if (
      this.cachedInstallations !== null &&
      this.cachedInstallations.length === 0 &&
      manager !== null
    ) {
      this.renderNoInstallationsHelp(containerEl);
    }
  }

  private async refreshUsernameAndRedisplay(): Promise<void> {
    try {
      const conn = this.createAppConnection();
      const user = await conn.getUser();
      this.cachedUsername = user.login;
      // Auto-load installations so the repo picker is ready immediately.
      this.cachedInstallations = await conn.listInstallations();
      this.cachedInstallationId =
        this.cachedInstallations.length > 0 ? this.cachedInstallations[0]!.id : null;
      // Auto-load repos for the first installation.
      if (this.cachedInstallationId !== null) {
        this.cachedRepos = await conn.listInstallationRepos(this.cachedInstallationId);
      } else {
        this.cachedRepos = null;
      }
    } catch (err) {
      if (err instanceof TokenRefreshError) {
        new Notice("Pylon Sync: Sign-in expired, please try again.");
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error";
        new Notice(`Pylon Sync: Failed to load account data: ${msg}`);
      }
    }
    this.display();
  }

  private createAppConnection(): GitHubConnection {
    const manager = this.plugin.ensureAuthManager();
    return new GitHubConnection(
      new ObsidianHttpClient(),
      {
        getToken: () => manager.getAccessToken(),
        onUnauthorized: () => manager.forceRefresh(),
      },
      this.plugin.settings.githubHost,
    );
  }

  private renderInstallationPicker(containerEl: HTMLElement): void {
    const setting = new Setting(containerEl)
      .setName("GitHub account")
      .setDesc(
        "Choose which account to sync from. The Pylon Sync App must be installed on each account.",
      );

    if (this.cachedInstallations && this.cachedInstallations.length > 0) {
      setting.addDropdown((dropdown: DropdownComponent) => {
        for (const inst of this.cachedInstallations!) {
          dropdown.addOption(String(inst.id), `@${inst.account_login}`);
        }
        const current = this.cachedInstallationId ?? this.cachedInstallations![0]!.id;
        if (this.cachedInstallationId === null) this.cachedInstallationId = current;
        dropdown.setValue(String(current)).onChange(async (value) => {
          this.cachedInstallationId = Number(value);
          this.cachedRepos = null;
          try {
            const conn = this.createAppConnection();
            this.cachedRepos = await conn.listInstallationRepos(this.cachedInstallationId!);
          } catch { /* will show text fallback */ }
          this.display();
        });
      });
    } else if (this.cachedInstallations && this.cachedInstallations.length === 0) {
      setting.setDesc(
        "No accounts found. Install the Pylon Sync GitHub App on your account below.",
      );
    }

    setting.addButton((btn) =>
      btn.setButtonText("Refresh").onClick(async () => {
        await this.loadInstallations(btn);
      }),
    );
  }

  private renderInstallationRepoPicker(containerEl: HTMLElement): void {
    if (!this.cachedInstallations || this.cachedInstallations.length === 0) return;

    const setting = new Setting(containerEl)
      .setName("Repository")
      .setDesc("Choose which repository to sync with");

    if (this.cachedRepos && this.cachedRepos.length > 0) {
      setting.addDropdown((dropdown: DropdownComponent) => {
        dropdown.addOption("", "Select a repository...");
        for (const repo of this.cachedRepos!) {
          const label = repo.private
            ? `${repo.full_name} (private)`
            : repo.full_name;
          dropdown.addOption(repo.full_name, label);
        }
        dropdown
          .setValue(this.plugin.settings.githubRepo)
          .onChange(async (value) => {
            this.plugin.settings.githubRepo = value;
            this.cachedBranches.delete(value);
            this.plugin.settings.branch = "main";
            await this.plugin.saveSettings();
            // Auto-load branches for the selected repo.
            if (value && value.includes("/")) {
              try {
                const conn = this.createAppConnection();
                const branches = await conn.listBranches(value);
                this.cachedBranches.set(value, branches);
              } catch { /* will show text fallback */ }
            }
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
  }

  private renderNoInstallationsHelp(containerEl: HTMLElement): void {
    const host = this.plugin.settings.githubHost;
    const installUrl = isGitHubDotCom(host)
      ? "https://github.com/apps/pylon-sync/installations/new"
      : `https://${host}/github-apps/pylon-sync/installations/new`;

    new Setting(containerEl)
      .setName("Install the GitHub App")
      .setDesc(
        "You haven't installed the Pylon Sync GitHub App on any repositories yet. Click below to install it, then come back and press Refresh.",
      )
      .addButton((btn) =>
        btn
          .setButtonText("Install Pylon Sync")
          .setCta()
          .onClick(() => {
            window.open(installUrl, "_blank");
          }),
      );
  }

  private async loadInstallations(btn: ButtonComponent): Promise<void> {
    btn.setButtonText("Loading…");
    btn.setDisabled(true);
    try {
      const conn = this.createAppConnection();
      this.cachedInstallations = await conn.listInstallations();
      // Reset selection when the list changes.
      if (
        this.cachedInstallationId !== null &&
        !this.cachedInstallations.some((i) => i.id === this.cachedInstallationId)
      ) {
        this.cachedInstallationId = null;
      }
      this.cachedRepos = null;
      this.display();
    } catch {
      btn.setButtonText("\u2717 Failed");
      setTimeout(() => {
        btn.setButtonText("Refresh");
        btn.setDisabled(false);
      }, 2000);
    }
  }


  // Existing PAT flow — kept as-is for users who prefer PATs or need GHES.
  private renderPatAuth(containerEl: HTMLElement): void {
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

    if (this.cachedUsername) {
      tokenSetting.setDesc(
        `Authenticated as @${this.cachedUsername}. Token stored securely — never written to data.json.`,
      );
    }

    this.renderRepoSetting(containerEl);
  }

  private renderAdvancedSettings(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details", {
      cls: "pylon-sync-advanced",
    });
    details.createEl("summary", { text: "Advanced" });
    const innerEl = details.createEl("div");

    new Setting(innerEl)
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

    const commitMsgSetting = new Setting(innerEl)
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

    new Setting(innerEl)
      .setName("GitHub host")
      .setDesc(
        "Override to use GitHub Enterprise Server or a data-residency instance. Leave as github.com for normal use.",
      )
      .addText((text) =>
        text
          .setPlaceholder("github.com")
          .setValue(this.plugin.settings.githubHost)
          .onChange(async (value) => {
            this.plugin.settings.githubHost = value.trim() || "github.com";
            // Host change invalidates everything. Sign out to avoid
            // sending the old refresh token to a different host.
            if (this.plugin.authManager) {
              await this.plugin.authManager.signOut();
            }
            this.plugin.resetAuthManager();
            this.cachedInstallations = null;
            this.cachedRepos = null;
            this.cachedUsername = null;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    new Setting(innerEl)
      .setName("Custom GitHub App client ID")
      .setDesc(
        "Only needed if you registered your own GitHub App on a GHES instance. Leave blank to use the official Pylon Sync App on github.com.",
      )
      .addText((text) =>
        text
          .setPlaceholder("Iv1.xxxxxxxx")
          .setValue(this.plugin.settings.githubCustomClientId)
          .onChange(async (value) => {
            this.plugin.settings.githubCustomClientId = value.trim();
            if (this.plugin.authManager) {
              await this.plugin.authManager.signOut();
            }
            this.plugin.resetAuthManager();
            await this.plugin.saveSettings();
          }),
      );
  }

  // ── GitHub helpers ──

  private createConnection(): GitHubConnection {
    return new GitHubConnection(
      new ObsidianHttpClient(),
      this.plugin.token,
      this.plugin.settings.githubHost,
    );
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
      this.cachedUsername = user.login;
      this.cachedTokenForUser = this.plugin.token;
      btn.setButtonText(`\u2713 ${user.login}`);
      setTimeout(() => this.display(), 2000);
    } catch {
      this.cachedUsername = null;
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

    if (this.cachedRepos && this.cachedRepos.length > 0) {
      setting.addDropdown((dropdown: DropdownComponent) => {
        dropdown.addOption("", "Select a repository...");
        for (const repo of this.cachedRepos!) {
          const label = repo.private
            ? `${repo.full_name} (private)`
            : repo.full_name;
          dropdown.addOption(repo.full_name, label);
        }
        dropdown
          .setValue(this.plugin.settings.githubRepo)
          .onChange(async (value) => {
            this.plugin.settings.githubRepo = value;
            this.cachedBranches.delete(value);
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
      this.cachedRepos = await conn.listRepos();
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
    const branches = this.cachedBranches.get(repo);
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
    if (!this.isAuthenticated() || !repo || !repo.includes("/")) {
      btn.setButtonText("Need auth & repo");
      setTimeout(() => btn.setButtonText("Load"), 2000);
      return;
    }

    btn.setButtonText("Loading...");
    btn.setDisabled(true);
    try {
      const conn =
        this.plugin.settings.githubAuthMethod === "github-app"
          ? this.createAppConnection()
          : this.createConnection();
      const branches = await conn.listBranches(repo);
      this.cachedBranches.set(repo, branches);
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
