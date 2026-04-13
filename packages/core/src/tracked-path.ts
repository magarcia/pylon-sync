import picomatch from "picomatch";
import type { SyncSettings } from "./types";

const OBSIDIAN_ALWAYS_EXCLUDED = new Set([
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
]);

let cachedPatterns: string[] = [];
let cachedMatcher: ((path: string) => boolean) | null = null;

function matchesIgnorePattern(path: string, ignorePatterns: string[]): boolean {
  if (ignorePatterns !== cachedPatterns) {
    cachedPatterns = ignorePatterns;
    cachedMatcher =
      ignorePatterns.length > 0 ? picomatch(ignorePatterns, { dot: true }) : null;
  }
  return cachedMatcher ? cachedMatcher(path) : false;
}

function matchesIncludePath(path: string, includePaths: string[]): boolean {
  for (const inc of includePaths) {
    if (inc.length === 0) continue;
    if (path === inc) return true;
    if (path.startsWith(inc + "/")) return true;
    if (path.includes("/" + inc + "/")) return true;
    if (path.endsWith("/" + inc)) return true;
  }
  return false;
}

// Extension sets matching Obsidian Sync's file type categories.
const IMAGE_EXTENSIONS = new Set([
  "bmp", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "tiff", "tif",
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3", "webm", "wav", "m4a", "ogg", "3gp", "flac", "opus", "aac", "wma", "aiff",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4", "mkv", "avi", "mov", "ogv", "m4v",
]);

const PDF_EXTENSIONS = new Set(["pdf"]);

function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1 || dot === path.length - 1) return "";
  return path.slice(dot + 1).toLowerCase();
}

function isExcludedByFileType(
  path: string,
  settings: Pick<SyncSettings, "syncImages" | "syncAudio" | "syncVideos" | "syncPDFs" | "syncAllOtherTypes">,
): boolean {
  const ext = getExtension(path);
  if (ext === "" || ext === "md" || ext === "canvas") return false;
  if (IMAGE_EXTENSIONS.has(ext)) return !settings.syncImages;
  if (AUDIO_EXTENSIONS.has(ext)) return !settings.syncAudio;
  if (VIDEO_EXTENSIONS.has(ext)) return !settings.syncVideos;
  if (PDF_EXTENSIONS.has(ext)) return !settings.syncPDFs;
  return !settings.syncAllOtherTypes;
}

// Map .obsidian/ paths to vault config categories. Returns null for
// paths that are always excluded regardless of toggles.
type VaultConfigCategory =
  | "mainSettings"
  | "appearance"
  | "themesSnippets"
  | "hotkeys"
  | "corePluginList"
  | "corePluginSettings"
  | "communityPluginList"
  | "installedPlugins";

function getObsidianCategory(path: string): VaultConfigCategory | null {
  if (OBSIDIAN_ALWAYS_EXCLUDED.has(path)) return null;
  if (path.startsWith(".obsidian/cache/")) return null;
  if (path.startsWith(".obsidian/plugins/pylon-sync/")) return null;

  if (path === ".obsidian/appearance.json") return "appearance";
  if (path === ".obsidian/hotkeys.json") return "hotkeys";
  if (path === ".obsidian/core-plugins.json") return "corePluginList";
  if (path === ".obsidian/core-plugins-migration.json") return "corePluginSettings";
  if (path === ".obsidian/community-plugins.json") return "communityPluginList";
  if (path.startsWith(".obsidian/themes/")) return "themesSnippets";
  if (path.startsWith(".obsidian/snippets/")) return "themesSnippets";
  if (path.startsWith(".obsidian/plugins/")) return "installedPlugins";

  return "mainSettings";
}

const CATEGORY_TO_SETTING: Record<VaultConfigCategory, keyof SyncSettings> = {
  mainSettings: "syncMainSettings",
  appearance: "syncAppearanceSettings",
  themesSnippets: "syncThemesAndSnippets",
  hotkeys: "syncHotkeys",
  corePluginList: "syncActiveCorePluginList",
  corePluginSettings: "syncCorePluginSettings",
  communityPluginList: "syncActiveCommunityPluginList",
  installedPlugins: "syncInstalledCommunityPlugins",
};

function isObsidianPathAllowed(path: string, settings: SyncSettings): boolean {
  const category = getObsidianCategory(path);
  if (category === null) return false;
  return Boolean(settings[CATEGORY_TO_SETTING[category]]);
}

export function hasAnyVaultConfigSync(settings: SyncSettings): boolean {
  return (
    settings.syncMainSettings ||
    settings.syncAppearanceSettings ||
    settings.syncThemesAndSnippets ||
    settings.syncHotkeys ||
    settings.syncActiveCorePluginList ||
    settings.syncCorePluginSettings ||
    settings.syncActiveCommunityPluginList ||
    settings.syncInstalledCommunityPlugins
  );
}

export function isTrackedPath(path: string, settings: SyncSettings): boolean {
  if (path.startsWith(".trash/")) return false;

  if (path.startsWith(".obsidian/")) {
    return isObsidianPathAllowed(path, settings);
  }

  // Dotfiles at root
  if (path.startsWith(".")) {
    if (!matchesIncludePath(path, settings.includePaths)) return false;
  }

  // Dot-directories anywhere in path
  if (path.includes("/.")) {
    if (!matchesIncludePath(path, settings.includePaths)) return false;
  }

  if (matchesIgnorePattern(path, settings.ignorePatterns)) return false;

  if (isExcludedByFileType(path, settings)) return false;

  return true;
}
