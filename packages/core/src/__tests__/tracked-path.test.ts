import { describe, it, expect } from "vitest";
import { isTrackedPath } from "../tracked-path";

describe("isTrackedPath", () => {
  const noIgnore: string[] = [];
  const syncOff = false;
  const syncOn = true;

  describe("normal files", () => {
    it("should return true for normal markdown files", () => {
      expect(isTrackedPath("notes/hello.md", noIgnore, syncOff)).toBe(true);
    });

    it("should return true for files in nested directories", () => {
      expect(isTrackedPath("a/b/c/file.md", noIgnore, syncOff)).toBe(true);
    });

    it("should return true for image files", () => {
      expect(isTrackedPath("attachments/photo.png", noIgnore, syncOff)).toBe(
        true,
      );
    });
  });

  describe("dotfiles and dot-directories", () => {
    it("should return false for dotfiles", () => {
      expect(isTrackedPath(".gitignore", noIgnore, syncOff)).toBe(false);
    });

    it("should return false for files in dot-directories", () => {
      expect(isTrackedPath(".obsidian/app.json", noIgnore, syncOff)).toBe(
        false,
      );
    });

    it("should return false for files in nested dot-directories", () => {
      expect(isTrackedPath("foo/.hidden/bar.md", noIgnore, syncOff)).toBe(
        false,
      );
    });
  });

  describe(".trash/", () => {
    it("should return false for .trash/ files", () => {
      expect(isTrackedPath(".trash/deleted.md", noIgnore, syncOff)).toBe(false);
    });
  });

  describe(".obsidian/ with syncObsidianSettings", () => {
    it("should return false for .obsidian/ by default", () => {
      expect(isTrackedPath(".obsidian/app.json", noIgnore, syncOff)).toBe(
        false,
      );
    });

    it("should return true for .obsidian/app.json when syncObsidianSettings is true", () => {
      expect(isTrackedPath(".obsidian/app.json", noIgnore, syncOn)).toBe(true);
    });

    it("should return true for .obsidian/plugins/x/data.json when syncObsidianSettings is true", () => {
      expect(
        isTrackedPath(".obsidian/plugins/x/data.json", noIgnore, syncOn),
      ).toBe(true);
    });

    it("should ALWAYS return false for .obsidian/workspace.json even with syncObsidianSettings=true", () => {
      expect(
        isTrackedPath(".obsidian/workspace.json", noIgnore, syncOn),
      ).toBe(false);
    });

    it("should ALWAYS return false for .obsidian/workspace-mobile.json even with syncObsidianSettings=true", () => {
      expect(
        isTrackedPath(".obsidian/workspace-mobile.json", noIgnore, syncOn),
      ).toBe(false);
    });

    it("should ALWAYS return false for files under .obsidian/cache/ even with syncObsidianSettings=true", () => {
      expect(
        isTrackedPath(".obsidian/cache/somefile.json", noIgnore, syncOn),
      ).toBe(false);
    });

    it("should ALWAYS return false for the plugin's own data directory even with syncObsidianSettings=true", () => {
      expect(
        isTrackedPath(
          ".obsidian/plugins/pylon-sync/data.json",
          noIgnore,
          syncOn,
        ),
      ).toBe(false);
      expect(
        isTrackedPath(
          ".obsidian/plugins/pylon-sync/bases/some__file.txt",
          noIgnore,
          syncOn,
        ),
      ).toBe(false);
    });
  });

  describe("ignore patterns", () => {
    it("should match simple glob ignore patterns", () => {
      expect(isTrackedPath("video.mp4", ["*.mp4"], syncOff)).toBe(false);
    });

    it("should match directory glob patterns", () => {
      expect(isTrackedPath("templates/note.md", ["templates/**"], syncOff)).toBe(
        false,
      );
    });

    it("should match nested glob patterns", () => {
      expect(
        isTrackedPath("daily/2023-01-01.md", ["daily/2023-*"], syncOff),
      ).toBe(false);
    });

    it("should return true when path doesn't match any ignore pattern", () => {
      expect(isTrackedPath("notes/hello.md", ["*.mp4", "drafts/**"], syncOff)).toBe(
        true,
      );
    });

    it("should handle empty ignore patterns array", () => {
      expect(isTrackedPath("notes/hello.md", [], syncOff)).toBe(true);
    });
  });
});
