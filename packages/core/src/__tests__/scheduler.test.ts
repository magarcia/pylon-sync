import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SyncResult } from "../types";
import { DEFAULT_SYNC_SETTINGS } from "../types";
import { SyncScheduler } from "../scheduler";

function createSyncFn() {
  let resolve: (result: SyncResult) => void;
  const fn = vi.fn(
    () =>
      new Promise<SyncResult>((r) => {
        resolve = r;
      })
  );
  return {
    fn,
    complete: (
      result: SyncResult = { status: "success", mutations: [] }
    ) => resolve(result),
  };
}

const defaultSettings = {
  ...DEFAULT_SYNC_SETTINGS,
  debounceMs: 2000,
  pollIntervalMs: 30000,
};

async function flushPromises() {
  // Advance by 0ms to flush pending microtasks/promises without moving timers forward
  await vi.advanceTimersByTimeAsync(0);
}

describe("SyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should start in idle state", () => {
    const { fn } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);

    expect(scheduler.state).toBe("idle");
  });

  it("should transition idle -> debouncing on queueEvent()", () => {
    const { fn } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.queueEvent("file.md");

    expect(scheduler.state).toBe("debouncing");
  });

  it("should transition debouncing -> syncing after debounce timeout", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.queueEvent("file.md");
    expect(scheduler.state).toBe("debouncing");

    vi.advanceTimersByTime(2000);
    expect(scheduler.state).toBe("syncing");

    complete();
    await flushPromises();
    expect(scheduler.state).toBe("idle");
  });

  it("should reset debounce timer on new events during debounce", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.queueEvent("file1.md");
    expect(scheduler.state).toBe("debouncing");

    // Advance 1500ms (not enough to trigger)
    vi.advanceTimersByTime(1500);
    expect(scheduler.state).toBe("debouncing");

    // Queue another event, resetting the timer
    scheduler.queueEvent("file2.md");

    // Advance another 1500ms — would have fired without the reset
    vi.advanceTimersByTime(1500);
    expect(scheduler.state).toBe("debouncing");

    // Advance the remaining 500ms to complete the new debounce
    vi.advanceTimersByTime(500);
    expect(scheduler.state).toBe("syncing");

    complete();
    await flushPromises();
  });

  it("should transition syncing -> idle after sync completes (success)", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.queueEvent("file.md");
    vi.advanceTimersByTime(2000);
    expect(scheduler.state).toBe("syncing");

    complete({ status: "success", mutations: [] });
    await flushPromises();

    expect(scheduler.state).toBe("idle");
  });

  it("should transition syncing -> error after sync completes with error status", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.queueEvent("file.md");
    vi.advanceTimersByTime(2000);
    expect(scheduler.state).toBe("syncing");

    complete({
      status: "error",
      mutations: [],
      error: new Error("network failure"),
    });
    await flushPromises();

    expect(scheduler.state).toBe("error");
  });

  it("should transition error -> debouncing when pending event exists after error", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.queueEvent("file.md");
    vi.advanceTimersByTime(2000);
    expect(scheduler.state).toBe("syncing");

    // Queue event during sync to set pending
    scheduler.queueEvent("other.md");

    complete({
      status: "error",
      mutations: [],
      error: new Error("network failure"),
    });
    await flushPromises();

    // Should briefly enter error, then transition to debouncing due to pending
    expect(scheduler.state).toBe("debouncing");
  });

  it("should mark pending if event arrives during sync", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.queueEvent("file.md");
    vi.advanceTimersByTime(2000);
    expect(scheduler.state).toBe("syncing");

    // Queue event while syncing — should not change state to debouncing yet
    scheduler.queueEvent("other.md");
    expect(scheduler.state).toBe("syncing");

    // Complete sync — should start a new debounce cycle because of pending
    complete();
    await flushPromises();

    expect(scheduler.state).toBe("debouncing");
  });

  it("should start new debounce after sync completes if pending was set", async () => {
    const sync1 = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(sync1.fn, defaultSettings, onStateChange);
    scheduler.start();

    // First sync cycle
    scheduler.queueEvent("file.md");
    vi.advanceTimersByTime(2000);
    expect(scheduler.state).toBe("syncing");

    // Queue event during sync
    scheduler.queueEvent("other.md");

    // Complete first sync
    sync1.complete();
    await flushPromises();

    // Should be debouncing again
    expect(scheduler.state).toBe("debouncing");

    // Let the debounce fire
    vi.advanceTimersByTime(2000);
    expect(scheduler.state).toBe("syncing");

    // Complete second sync
    sync1.complete();
    await flushPromises();

    expect(scheduler.state).toBe("idle");
  });

  it("should trigger immediate sync on triggerSync() from idle", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.triggerSync();

    // Should go straight to syncing, no debounce
    expect(scheduler.state).toBe("syncing");
    expect(fn).toHaveBeenCalledOnce();

    complete();
    await flushPromises();

    expect(scheduler.state).toBe("idle");
  });

  it("should call onStateChange on every transition", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.queueEvent("file.md");
    expect(onStateChange).toHaveBeenLastCalledWith("debouncing");

    vi.advanceTimersByTime(2000);
    expect(onStateChange).toHaveBeenLastCalledWith("syncing");

    complete();
    await flushPromises();
    expect(onStateChange).toHaveBeenLastCalledWith("idle");

    expect(onStateChange).toHaveBeenCalledTimes(3);
  });

  it("should stop all timers on stop() (no more transitions)", async () => {
    const { fn } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.queueEvent("file.md");
    expect(scheduler.state).toBe("debouncing");

    scheduler.stop();

    // Advancing timers should not trigger sync
    vi.advanceTimersByTime(5000);
    await flushPromises();

    expect(fn).not.toHaveBeenCalled();
    // State stays at debouncing since stop() doesn't reset state
    // but no further transitions happen
  });

  it("should retry automatically after 30 seconds when sync fails with error and no pending events", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.triggerSync();
    expect(scheduler.state).toBe("syncing");

    complete({
      status: "error",
      mutations: [],
      error: new Error("network failure"),
    });
    await flushPromises();

    expect(scheduler.state).toBe("error");
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance 29 seconds — retry should not have fired yet
    vi.advanceTimersByTime(29000);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance to 30 seconds — retry fires
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(scheduler.state).toBe("syncing");

    complete({ status: "success", mutations: [] });
    await flushPromises();

    expect(scheduler.state).toBe("idle");
  });

  it("should not retry after error when stopped", async () => {
    const { fn, complete } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();

    scheduler.triggerSync();
    complete({
      status: "error",
      mutations: [],
      error: new Error("network failure"),
    });
    await flushPromises();

    expect(scheduler.state).toBe("error");

    scheduler.stop();

    vi.advanceTimersByTime(30000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should not crash if queueEvent called after stop", () => {
    const { fn } = createSyncFn();
    const onStateChange = vi.fn();
    const scheduler = new SyncScheduler(fn, defaultSettings, onStateChange);
    scheduler.start();
    scheduler.stop();

    // Should not throw
    expect(() => scheduler.queueEvent("file.md")).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});
