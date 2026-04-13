import { describe, it, expect } from "vitest";
import { isTrackedPath } from "../tracked-path";
import type { SyncSettings } from "../types";
import { DEFAULT_SYNC_SETTINGS } from "../types";

function settings(overrides: Partial<SyncSettings> = {}): SyncSettings {
  return { ...DEFAULT_SYNC_SETTINGS, ...overrides };
}

const ALL_VAULT_CONFIG = {
  syncMainSettings: true,
  syncAppearanceSettings: true,
  syncThemesAndSnippets: true,
  syncHotkeys: true,
  syncActiveCorePluginList: true,
  syncCorePluginSettings: true,
  syncActiveCommunityPluginList: true,
  syncInstalledCommunityPlugins: true,
} as const;

describe("isTrackedPath", () => {
  describe("normal files", () => {
    it("should return true for normal markdown files", () => {
      expect(isTrackedPath("notes/hello.md", settings())).toBe(true);
    });

    it("should return true for files in nested directories", () => {
      expect(isTrackedPath("a/b/c/file.md", settings())).toBe(true);
    });

    it("should return true for image files", () => {
      expect(isTrackedPath("attachments/photo.png", settings())).toBe(true);
    });
  });

  describe("dotfiles and dot-directories", () => {
    it("should return false for dotfiles", () => {
      expect(isTrackedPath(".gitignore", settings())).toBe(false);
    });

    it("should return false for files in dot-directories", () => {
      expect(isTrackedPath(".obsidian/app.json", settings())).toBe(false);
    });

    it("should return false for files in nested dot-directories", () => {
      expect(isTrackedPath("foo/.hidden/bar.md", settings())).toBe(false);
    });
  });

  describe(".trash/", () => {
    it("should return false for .trash/ files", () => {
      expect(isTrackedPath(".trash/deleted.md", settings())).toBe(false);
    });
  });

  describe(".obsidian/ with syncObsidianSettings", () => {
    it("should return false for .obsidian/ by default", () => {
      expect(isTrackedPath(".obsidian/app.json", settings())).toBe(false);
    });

    it("should return true for .obsidian/app.json when all vault config toggles are on", () => {
      expect(isTrackedPath(".obsidian/app.json", settings({ ...ALL_VAULT_CONFIG }))).toBe(true);
    });

    it("should return true for .obsidian/plugins/x/data.json when syncInstalledCommunityPlugins is on", () => {
      expect(
        isTrackedPath(".obsidian/plugins/x/data.json", settings({ syncInstalledCommunityPlugins: true })),
      ).toBe(true);
    });

    it("should ALWAYS return false for .obsidian/workspace.json even with all vault config on", () => {
      expect(
        isTrackedPath(".obsidian/workspace.json", settings({ ...ALL_VAULT_CONFIG })),
      ).toBe(false);
    });

    it("should ALWAYS return false for .obsidian/workspace-mobile.json even with all vault config on", () => {
      expect(
        isTrackedPath(".obsidian/workspace-mobile.json", settings({ ...ALL_VAULT_CONFIG })),
      ).toBe(false);
    });

    it("should ALWAYS return false for files under .obsidian/cache/ even with all vault config on", () => {
      expect(
        isTrackedPath(".obsidian/cache/somefile.json", settings({ ...ALL_VAULT_CONFIG })),
      ).toBe(false);
    });

    it("should ALWAYS return false for the plugin's own data directory even with all vault config on", () => {
      expect(
        isTrackedPath(
          ".obsidian/plugins/pylon-sync/data.json",
          settings({ ...ALL_VAULT_CONFIG }),
        ),
      ).toBe(false);
      expect(
        isTrackedPath(
          ".obsidian/plugins/pylon-sync/bases/some__file.txt",
          settings({ ...ALL_VAULT_CONFIG }),
        ),
      ).toBe(false);
    });
  });

  describe("ignore patterns", () => {
    it("should match simple glob ignore patterns", () => {
      expect(isTrackedPath("video.mp4", settings({ ignorePatterns: ["*.mp4"] }))).toBe(false);
    });

    it("should match directory glob patterns", () => {
      expect(isTrackedPath("templates/note.md", settings({ ignorePatterns: ["templates/**"] }))).toBe(
        false,
      );
    });

    it("should match nested glob patterns", () => {
      expect(
        isTrackedPath("daily/2023-01-01.md", settings({ ignorePatterns: ["daily/2023-*"] })),
      ).toBe(false);
    });

    it("should return true when path doesn't match any ignore pattern", () => {
      expect(isTrackedPath("notes/hello.md", settings({ ignorePatterns: ["*.mp4", "drafts/**"] }))).toBe(
        true,
      );
    });

    it("should handle empty ignore patterns array", () => {
      expect(isTrackedPath("notes/hello.md", settings())).toBe(true);
    });
  });

  describe("includePaths", () => {
    it("should allow root dotfiles when listed in includePaths", () => {
      expect(isTrackedPath(".gitignore", settings({ includePaths: [".gitignore"] }))).toBe(true);
    });

    it("should allow dot-directory files when directory is in includePaths", () => {
      expect(isTrackedPath(".claude/CLAUDE.md", settings({ includePaths: [".claude"] }))).toBe(true);
    });

    it("should allow deeply nested files in included dot-directory", () => {
      expect(isTrackedPath(".claude/rules/common.md", settings({ includePaths: [".claude"] }))).toBe(true);
    });

    it("should allow nested dot-directories when listed in includePaths", () => {
      expect(isTrackedPath("notes/.claude/memory.md", settings({ includePaths: [".claude"] }))).toBe(true);
    });

    it("should still reject dotfiles not in includePaths", () => {
      expect(isTrackedPath(".secret", settings({ includePaths: [".claude"] }))).toBe(false);
    });

    it("should still reject dot-directories not in includePaths", () => {
      expect(isTrackedPath(".git/config", settings({ includePaths: [".claude"] }))).toBe(false);
    });

    it("should still reject .trash/ even if in includePaths", () => {
      expect(isTrackedPath(".trash/deleted.md", settings({ includePaths: [".trash"] }))).toBe(false);
    });

    it("should respect ignore patterns over includePaths", () => {
      expect(isTrackedPath(".claude/temp.log", settings({ ignorePatterns: ["**/*.log"], includePaths: [".claude"] }))).toBe(false);
    });

    it("should work with multiple include paths", () => {
      expect(isTrackedPath(".claude/foo.md", settings({ includePaths: [".github", ".claude"] }))).toBe(true);
      expect(isTrackedPath(".github/workflows/ci.yml", settings({ includePaths: [".github", ".claude"] }))).toBe(true);
    });

    it("should not affect normal file tracking", () => {
      expect(isTrackedPath("notes/hello.md", settings({ includePaths: [".claude"] }))).toBe(true);
    });

    it("should handle empty includePaths", () => {
      expect(isTrackedPath(".claude/foo.md", settings({ includePaths: [] }))).toBe(false);
    });
  });

  describe("granular vault config sync", () => {
    it("should allow .obsidian/app.json when syncMainSettings is on", () => {
      expect(isTrackedPath(".obsidian/app.json", settings({ syncMainSettings: true }))).toBe(true);
    });

    it("should block .obsidian/app.json when syncMainSettings is off", () => {
      expect(isTrackedPath(".obsidian/app.json", settings())).toBe(false);
    });

    it("should allow .obsidian/appearance.json only when syncAppearanceSettings is on", () => {
      expect(isTrackedPath(".obsidian/appearance.json", settings({ syncAppearanceSettings: true }))).toBe(true);
      expect(isTrackedPath(".obsidian/appearance.json", settings({ syncMainSettings: true }))).toBe(false);
    });

    it("should allow .obsidian/hotkeys.json only when syncHotkeys is on", () => {
      expect(isTrackedPath(".obsidian/hotkeys.json", settings({ syncHotkeys: true }))).toBe(true);
      expect(isTrackedPath(".obsidian/hotkeys.json", settings())).toBe(false);
    });

    it("should allow .obsidian/themes/ when syncThemesAndSnippets is on", () => {
      expect(isTrackedPath(".obsidian/themes/minimal.json", settings({ syncThemesAndSnippets: true }))).toBe(true);
      expect(isTrackedPath(".obsidian/snippets/custom.css", settings({ syncThemesAndSnippets: true }))).toBe(true);
    });

    it("should allow .obsidian/core-plugins.json when syncActiveCorePluginList is on", () => {
      expect(isTrackedPath(".obsidian/core-plugins.json", settings({ syncActiveCorePluginList: true }))).toBe(true);
    });

    it("should allow .obsidian/community-plugins.json when syncActiveCommunityPluginList is on", () => {
      expect(isTrackedPath(".obsidian/community-plugins.json", settings({ syncActiveCommunityPluginList: true }))).toBe(true);
    });

    it("should allow .obsidian/plugins/ when syncInstalledCommunityPlugins is on", () => {
      expect(isTrackedPath(".obsidian/plugins/dataview/main.js", settings({ syncInstalledCommunityPlugins: true }))).toBe(true);
    });

    it("should always block .obsidian/plugins/pylon-sync/ regardless of toggles", () => {
      expect(isTrackedPath(".obsidian/plugins/pylon-sync/data.json", settings({ ...ALL_VAULT_CONFIG }))).toBe(false);
    });

    it("should always block workspace.json regardless of toggles", () => {
      expect(isTrackedPath(".obsidian/workspace.json", settings({ ...ALL_VAULT_CONFIG }))).toBe(false);
    });

    it("should always block .obsidian/cache/ regardless of toggles", () => {
      expect(isTrackedPath(".obsidian/cache/something", settings({ ...ALL_VAULT_CONFIG }))).toBe(false);
    });
  });

  describe("file type filtering", () => {
    const noImages = settings({ syncImages: false });
    const noAudio = settings({ syncAudio: false });
    const noVideos = settings({ syncVideos: false });
    const noPDFs = settings({ syncPDFs: false });
    const noOther = settings({ syncAllOtherTypes: false });

    it("should always allow .md files", () => {
      expect(isTrackedPath("notes/daily.md", noImages)).toBe(true);
    });

    it("should always allow .canvas files", () => {
      expect(isTrackedPath("drawing.canvas", noOther)).toBe(true);
    });

    it("should block image files when syncImages is off", () => {
      expect(isTrackedPath("photo.png", noImages)).toBe(false);
      expect(isTrackedPath("photo.jpg", noImages)).toBe(false);
      expect(isTrackedPath("photo.gif", noImages)).toBe(false);
      expect(isTrackedPath("photo.svg", noImages)).toBe(false);
      expect(isTrackedPath("photo.webp", noImages)).toBe(false);
    });

    it("should allow image files when syncImages is on", () => {
      expect(isTrackedPath("photo.png", settings())).toBe(true);
    });

    it("should block audio files when syncAudio is off", () => {
      expect(isTrackedPath("recording.mp3", noAudio)).toBe(false);
      expect(isTrackedPath("recording.wav", noAudio)).toBe(false);
      expect(isTrackedPath("recording.flac", noAudio)).toBe(false);
    });

    it("should block video files when syncVideos is off", () => {
      expect(isTrackedPath("clip.mp4", noVideos)).toBe(false);
      expect(isTrackedPath("clip.mov", noVideos)).toBe(false);
    });

    it("should block PDFs when syncPDFs is off", () => {
      expect(isTrackedPath("document.pdf", noPDFs)).toBe(false);
    });

    it("should block unknown extensions when syncAllOtherTypes is off", () => {
      expect(isTrackedPath("data.csv", noOther)).toBe(false);
      expect(isTrackedPath("archive.zip", noOther)).toBe(false);
    });

    it("should allow unknown extensions when syncAllOtherTypes is on", () => {
      expect(isTrackedPath("data.csv", settings())).toBe(true);
    });

    it("should allow files without extensions", () => {
      expect(isTrackedPath("Makefile", noOther)).toBe(true);
    });

    it("should be case insensitive for extensions", () => {
      expect(isTrackedPath("photo.PNG", noImages)).toBe(false);
      expect(isTrackedPath("photo.JPG", noImages)).toBe(false);
    });
  });
});
