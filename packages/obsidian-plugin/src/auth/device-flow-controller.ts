import type { DeviceCodeResponse } from "@pylon-sync/auth-github";
import { DeviceFlowError } from "@pylon-sync/auth-github";
import type { GitHubAuthManager } from "./github-auth-manager";

// Discriminated state for the device flow UI. The modal renders a view for
// each state; the controller owns the transitions. The success state does NOT
// carry the TokenSet — subscribers only need to know sign-in succeeded, not
// the raw tokens.
export type DeviceFlowState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  | { readonly kind: "awaiting"; readonly code: DeviceCodeResponse }
  | { readonly kind: "success" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "cancelled" };

export type DeviceFlowListener = (state: DeviceFlowState) => void;

// Pure controller: drives the device flow and notifies a listener on every
// state transition. No DOM, no Obsidian APIs — the Modal class wraps this.
export class DeviceFlowController {
  private state: DeviceFlowState = { kind: "idle" };
  private listeners = new Set<DeviceFlowListener>();
  private controller: AbortController | null = null;
  // Cancellation flag checked after awaits so we can honor a cancel() that
  // raced with the token response. TypeScript can't track mutations of
  // `this.state` across async boundaries, so we use a dedicated boolean.
  private cancelled = false;

  constructor(private readonly authManager: GitHubAuthManager) {}

  getState(): DeviceFlowState {
    return this.state;
  }

  subscribe(listener: DeviceFlowListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  // Kicks off the flow. Safe to call once per controller instance.
  async start(): Promise<void> {
    if (this.state.kind !== "idle") return;
    this.controller = new AbortController();
    this.setState({ kind: "starting" });

    try {
      await this.authManager.signIn(
        (code) => this.setState({ kind: "awaiting", code }),
        this.controller.signal,
      );
      // If cancel() was called after the token came back but before we got
      // here, honor the cancellation. Otherwise mark success.
      if (this.cancelled) return;
      this.setState({ kind: "success" });
    } catch (err) {
      if (
        err instanceof DeviceFlowError &&
        err.reason === "DEVICE_FLOW_ABORTED"
      ) {
        // Cancellation is a user action, not an error.
        this.setState({ kind: "cancelled" });
        return;
      }
      const message =
        err instanceof DeviceFlowError
          ? humanizeError(err)
          : err instanceof Error
            ? err.message
            : "Unknown error";
      this.setState({ kind: "error", message });
    }
  }

  cancel(): void {
    const kind = this.state.kind;
    if (kind === "success" || kind === "error" || kind === "cancelled") {
      return;
    }
    this.cancelled = true;
    this.setState({ kind: "cancelled" });
    this.controller?.abort();
  }

  // Restart the flow after an error or expiry. Resets internal state so
  // start() will run again with a fresh device code.
  async restart(): Promise<void> {
    const kind = this.state.kind;
    if (kind !== "error") return;
    this.cancelled = false;
    this.controller = null;
    this.state = { kind: "idle" };
    await this.start();
  }

  private setState(next: DeviceFlowState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

function humanizeError(err: DeviceFlowError): string {
  switch (err.reason) {
    case "EXPIRED_TOKEN":
      return "The code expired before you authorized it. Please try again.";
    case "ACCESS_DENIED":
      return "Authorization was denied.";
    case "DEVICE_CODE_REQUEST_FAILED":
      return "Could not start sign-in. Check your internet connection, or verify that device flow is enabled on your GitHub instance.";
    case "INCORRECT_CLIENT_CREDENTIALS":
      return "The GitHub App is misconfigured. Please report this issue.";
    default:
      return err.message;
  }
}
