import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  DeviceFlowController,
  type DeviceFlowState,
} from "../auth/device-flow-controller";
import type { GitHubAuthManager } from "../auth/github-auth-manager";
import {
  DeviceFlowError,
  type DeviceCodeResponse,
  type TokenSet,
} from "@pylon-sync/auth-github";

// Minimal hand-rolled stub of GitHubAuthManager. We only use `signIn`.
interface StubManager {
  signIn: (
    onCode: (code: DeviceCodeResponse) => void,
    signal: AbortSignal,
  ) => Promise<TokenSet>;
}

function asManager(stub: StubManager): GitHubAuthManager {
  // The controller only touches signIn. Cast is safe for tests.
  return stub as unknown as GitHubAuthManager;
}

const SAMPLE_CODE: DeviceCodeResponse = {
  deviceCode: "dev_abc",
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  expiresAt: Date.now() + 900_000,
  interval: 5,
};

const SAMPLE_TOKEN: TokenSet = {
  accessToken: "ghu_access",
  refreshToken: "ghr_refresh",
  expiresAt: Date.now() + 28800_000,
  refreshExpiresAt: Date.now() + 15811200_000,
};

describe("DeviceFlowController", () => {
  let states: DeviceFlowState[];

  beforeEach(() => {
    states = [];
  });

  function track(controller: DeviceFlowController) {
    controller.subscribe((s) => states.push(s));
  }

  it("should start in idle state", () => {
    const controller = new DeviceFlowController(
      asManager({ signIn: vi.fn() }),
    );
    expect(controller.getState()).toEqual({ kind: "idle" });
  });

  it("should transition idle → starting → awaiting → success on happy path", async () => {
    let emittedCode: ((code: DeviceCodeResponse) => void) | undefined;
    const signIn = vi.fn(async (onCode) => {
      emittedCode = onCode;
      onCode(SAMPLE_CODE);
      return SAMPLE_TOKEN;
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    track(controller);

    await controller.start();

    expect(emittedCode).toBeDefined();
    expect(states.map((s) => s.kind)).toEqual([
      "idle",
      "starting",
      "awaiting",
      "success",
    ]);
    expect(controller.getState().kind).toBe("success");
  });

  it("should transition to cancelled when cancel() is called", async () => {
    let resolveSignIn: ((t: TokenSet) => void) | undefined;
    let capturedSignal: AbortSignal | undefined;
    const signIn = vi.fn((onCode, signal: AbortSignal) => {
      capturedSignal = signal;
      onCode(SAMPLE_CODE);
      return new Promise<TokenSet>((resolve, reject) => {
        resolveSignIn = resolve;
        signal.addEventListener("abort", () =>
          reject(new DeviceFlowError("DEVICE_FLOW_ABORTED", "aborted")),
        );
      });
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    track(controller);

    const startPromise = controller.start();
    // Give the microtasks a chance to flush so awaiting state is reached.
    await Promise.resolve();
    await Promise.resolve();

    controller.cancel();
    await startPromise;

    expect(capturedSignal?.aborted).toBe(true);
    expect(controller.getState().kind).toBe("cancelled");
    expect(resolveSignIn).toBeDefined();
  });

  it("should transition to error on DeviceFlowError other than abort", async () => {
    const signIn = vi.fn(async () => {
      throw new DeviceFlowError("EXPIRED_TOKEN", "expired");
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    track(controller);

    await controller.start();

    const final = controller.getState();
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.message).toContain("expired");
    }
  });

  it("should humanize access_denied error", async () => {
    const signIn = vi.fn(async () => {
      throw new DeviceFlowError("ACCESS_DENIED", "access_denied");
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    await controller.start();

    const final = controller.getState();
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.message).toBe("Authorization was denied.");
    }
  });

  it("should transition to error on generic thrown Error", async () => {
    const signIn = vi.fn(async () => {
      throw new Error("something broke");
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    await controller.start();

    const final = controller.getState();
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.message).toBe("something broke");
    }
  });

  it("should be a no-op when start() is called twice", async () => {
    const signIn = vi.fn(async () => SAMPLE_TOKEN);
    const controller = new DeviceFlowController(asManager({ signIn }));

    await controller.start();
    await controller.start();

    expect(signIn).toHaveBeenCalledOnce();
  });

  it("should not flip cancelled → success if cancel raced with token return", async () => {
    let resolveSignIn: ((t: TokenSet) => void) | undefined;
    const signIn = vi.fn((_onCode, _signal) => {
      return new Promise<TokenSet>((resolve) => {
        resolveSignIn = resolve;
      });
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    const startPromise = controller.start();
    await Promise.resolve();

    // Simulate cancel arriving before the token return completes its await.
    controller.cancel();
    // Then the authManager resolves (e.g., token was actually granted).
    resolveSignIn?.(SAMPLE_TOKEN);
    await startPromise;

    // Cancellation wins — once user cancelled, we don't silently sign them in.
    expect(controller.getState().kind).toBe("cancelled");
  });

  it("should notify subscribers on every state change", async () => {
    const signIn = vi.fn(async (onCode) => {
      onCode(SAMPLE_CODE);
      return SAMPLE_TOKEN;
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    const listener = vi.fn();
    controller.subscribe(listener);

    await controller.start();

    // idle + starting + awaiting + success = 4
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("should restart from error state with a fresh device code", async () => {
    let callCount = 0;
    const signIn = vi.fn(async (onCode) => {
      callCount++;
      if (callCount === 1) {
        throw new DeviceFlowError("EXPIRED_TOKEN", "expired");
      }
      onCode(SAMPLE_CODE);
      return SAMPLE_TOKEN;
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    track(controller);

    await controller.start();
    expect(controller.getState().kind).toBe("error");

    await controller.restart();
    expect(controller.getState().kind).toBe("success");
    expect(signIn).toHaveBeenCalledTimes(2);
    // Full lifecycle: idle → starting → error → idle → starting → awaiting → success
    expect(states.map((s) => s.kind)).toEqual([
      "idle",
      "starting",
      "error",
      "starting",
      "awaiting",
      "success",
    ]);
  });

  it("should be a no-op when restart() is called from non-error state", async () => {
    const signIn = vi.fn(async (onCode) => {
      onCode(SAMPLE_CODE);
      return SAMPLE_TOKEN;
    });
    const controller = new DeviceFlowController(asManager({ signIn }));

    await controller.start();
    expect(controller.getState().kind).toBe("success");

    await controller.restart();
    // Still success, no second signIn call.
    expect(controller.getState().kind).toBe("success");
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("should not notify after unsubscribe", async () => {
    const signIn = vi.fn(async (onCode) => {
      onCode(SAMPLE_CODE);
      return SAMPLE_TOKEN;
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    // initial "idle" call.
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await controller.start();

    // Still only the one initial call — no further notifications after unsubscribe.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("should transition to cancelled when cancel() is called during starting state", async () => {
    // signIn never calls onCode, so the controller stays in "starting".
    // It rejects with DEVICE_FLOW_ABORTED when the signal fires.
    const signIn = vi.fn((_onCode, signal: AbortSignal) => {
      return new Promise<TokenSet>((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DeviceFlowError("DEVICE_FLOW_ABORTED", "aborted")),
        );
      });
    });

    const controller = new DeviceFlowController(asManager({ signIn }));
    track(controller);

    const startPromise = controller.start();
    await Promise.resolve();
    await Promise.resolve();

    // Cancel while still in "starting" (onCode was never called).
    controller.cancel();
    await startPromise;

    expect(controller.getState().kind).toBe("cancelled");
  });
});
