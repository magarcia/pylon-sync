import { Modal, Notice, type App } from "obsidian";
import type { GitHubAuthManager } from "../auth/github-auth-manager";
import {
  DeviceFlowController,
  type DeviceFlowState,
} from "../auth/device-flow-controller";

// Thin Obsidian Modal that renders whatever state the DeviceFlowController is
// in. All logic — device flow driving, cancellation, error humanization —
// lives in the controller so it can be unit-tested without a DOM.
export class DeviceFlowModal extends Modal {
  private readonly controller: DeviceFlowController;
  private unsubscribe: (() => void) | null = null;

  constructor(
    app: App,
    authManager: GitHubAuthManager,
    private readonly onSuccess: () => void,
  ) {
    super(app);
    this.controller = new DeviceFlowController(authManager);
  }

  onOpen(): void {
    this.titleEl.setText("Sign in to GitHub");
    this.unsubscribe = this.controller.subscribe((state) => this.render(state));
    void this.controller.start();
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.controller.cancel();
    this.contentEl.empty();
  }

  private render(state: DeviceFlowState): void {
    const { contentEl } = this;
    contentEl.empty();

    switch (state.kind) {
      case "idle":
      case "starting": {
        contentEl.createEl("p", { text: "Connecting to GitHub\u2026" });
        return;
      }
      case "awaiting": {
        this.renderAwaiting(
          state.code.userCode,
          state.code.verificationUri,
          state.code.expiresAt,
        );
        return;
      }
      case "success": {
        contentEl.createEl("p", { text: "Signed in successfully." });
        this.onSuccess();
        setTimeout(() => this.close(), 800);
        return;
      }
      case "cancelled": {
        return;
      }
      case "error": {
        this.renderError(state.message);
        return;
      }
    }
  }

  private renderAwaiting(
    userCode: string,
    verificationUri: string,
    expiresAt: number,
  ): void {
    const { contentEl } = this;

    contentEl.createEl("p", {
      text: "Enter this code on GitHub to authorize Pylon Sync:",
    });

    const codeEl = contentEl.createEl("div", {
      cls: "pylon-sync-device-code",
    });
    codeEl.createEl("code", { text: userCode });

    // Auto-copy the code to clipboard immediately. The user explicitly
    // initiated sign-in, so this isn't surprising.
    navigator.clipboard.writeText(userCode).then(
      () => {
        const hint = contentEl.createEl("p", {
          text: "Code copied to clipboard",
          cls: "pylon-sync-device-copied",
        });
        // Fade out the hint after a moment so it doesn't clutter the UI.
        setTimeout(() => hint.remove(), 3000);
      },
      () => {
        // Clipboard fails silently on some Android WebViews.
      },
    );

    const buttonRow = contentEl.createEl("div", {
      cls: "pylon-sync-device-buttons",
    });

    // Single CTA: copies the code (again, in case the auto-copy failed or
    // was cleared) and opens the browser in one click (VS Code pattern).
    const ctaBtn = buttonRow.createEl("button", {
      text: "Copy & Open GitHub",
      cls: "mod-cta",
    });
    ctaBtn.onclick = () => {
      navigator.clipboard.writeText(userCode).then(
        () => new Notice("Code copied"),
        () => new Notice("Copy failed \u2014 select the code manually"),
      );
      window.open(verificationUri, "_blank");
    };

    // Show the code and a tappable link in the waiting text. The link is
    // critical for mobile where window.open can be unreliable.
    const statusEl = contentEl.createEl("p", {
      cls: "pylon-sync-device-status",
    });
    statusEl.append("Waiting for authorization\u2026 Your code: ");
    statusEl.createEl("strong", { text: userCode });

    const linkEl = contentEl.createEl("p", {
      cls: "pylon-sync-device-link",
    });
    linkEl.append("Or open ");
    linkEl.createEl("a", {
      text: verificationUri,
      href: verificationUri,
      attr: { target: "_blank", rel: "noopener" },
    });
    linkEl.append(" manually.");

    // Countdown showing how long until the code expires.
    const remainingMs = expiresAt - Date.now();
    if (remainingMs > 0) {
      const countdownEl = contentEl.createEl("p", {
        cls: "pylon-sync-device-countdown",
      });
      const updateCountdown = () => {
        const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
        const mins = Math.floor(left / 60);
        const secs = left % 60;
        countdownEl.textContent = `Code expires in ${mins}:${String(secs).padStart(2, "0")}`;
      };
      updateCountdown();
      const timer = setInterval(() => {
        if (!this.contentEl.isConnected) {
          clearInterval(timer);
          return;
        }
        updateCountdown();
      }, 1000);
    }

    contentEl.createEl("p", {
      text: "Only enter this code if you started sign-in from Pylon Sync. Never enter a code sent to you by someone else.",
      cls: "pylon-sync-device-warning",
    });
  }

  private renderError(message: string): void {
    const { contentEl } = this;

    contentEl.createEl("p", {
      text: `Sign-in failed: ${message}`,
      cls: "pylon-sync-device-error",
    });

    const buttonRow = contentEl.createEl("div", {
      cls: "pylon-sync-device-buttons",
    });

    const retryBtn = buttonRow.createEl("button", {
      text: "Try again",
      cls: "mod-cta",
    });
    retryBtn.onclick = () => {
      void this.controller.restart();
    };

    const closeBtn = buttonRow.createEl("button", { text: "Close" });
    closeBtn.onclick = () => this.close();
  }
}
