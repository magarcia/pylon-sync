import { describe, it, expect, beforeEach, vi } from "vitest";
import { Notice } from "obsidian";
import type { SyncResult, FileMutation } from "@pylon-sync/core";
import {
  showSyncResult,
  showAuthError,
  showRateLimitError,
  showSyncConflictWarning,
} from "../ui/notices";

// Spy on Notice constructor to capture created instances
let notices: Array<{ message: string }>;

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
  return {
    ...actual,
    Notice: vi.fn().mockImplementation((message: string) => {
      const instance = { message, hide: vi.fn() };
      notices.push(instance);
      return instance;
    }),
  };
});

function makeMutation(
  disk: FileMutation["disk"],
  remote: FileMutation["remote"],
): FileMutation {
  return { path: "file.md", disk, remote };
}

describe("notices", () => {
  beforeEach(() => {
    notices = [];
    vi.clearAllMocks();
  });

  describe("showSyncResult", () => {
    it("should create notice with change count on success", () => {
      const result: SyncResult = {
        status: "success",
        mutations: [
          makeMutation("write", "skip"),
          makeMutation("skip", "write"),
          makeMutation("delete", "skip"),
        ],
      };

      showSyncResult(result);

      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("3 changes");
    });

    it("should not create notice when success with 0 actual changes", () => {
      const result: SyncResult = {
        status: "success",
        mutations: [makeMutation("skip", "skip")],
      };

      showSyncResult(result);

      expect(notices).toHaveLength(0);
    });

    it("should create persistent notice on error", () => {
      const result: SyncResult = {
        status: "error",
        mutations: [],
        error: new Error("Something went wrong"),
      };

      showSyncResult(result);

      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("Sync error");
      // Persistent notice: timeout = 0
      expect(Notice).toHaveBeenCalledWith(expect.any(String), 0);
    });

    it("should sanitize API paths in error messages", () => {
      const result: SyncResult = {
        status: "error",
        mutations: [],
        error: new Error(
          "Failed at https://api.github.com/repos/owner/repo/git/trees",
        ),
      };

      showSyncResult(result);

      expect(notices[0]!.message).not.toContain("api.github.com");
      expect(notices[0]!.message).toContain("[API]");
    });
  });

  describe("showAuthError", () => {
    it("should create notice mentioning settings", () => {
      showAuthError();

      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("settings");
    });
  });

  describe("showRateLimitError", () => {
    it("should include reset time", () => {
      const resetAt = new Date("2026-03-31T15:00:00Z");

      showRateLimitError(resetAt);

      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("Rate limit");
      // The time string is locale-dependent, but should be present
      expect(notices[0]!.message).toMatch(/\d/);
    });
  });

  describe("showSyncConflictWarning", () => {
    it("should mention Obsidian Sync", () => {
      showSyncConflictWarning();

      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("Obsidian Sync");
    });
  });
});
