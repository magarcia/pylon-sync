import picomatch from "picomatch";

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
      ignorePatterns.length > 0 ? picomatch(ignorePatterns) : null;
  }
  return cachedMatcher ? cachedMatcher(path) : false;
}

export function isTrackedPath(
  path: string,
  ignorePatterns: string[],
  syncObsidianSettings: boolean,
): boolean {
  // .trash/ is always excluded
  if (path.startsWith(".trash/")) return false;

  // .obsidian/ handled separately with syncObsidianSettings logic
  if (path.startsWith(".obsidian/")) {
    if (!syncObsidianSettings) return false;
    if (OBSIDIAN_ALWAYS_EXCLUDED.has(path)) return false;
    if (path.startsWith(".obsidian/cache/")) return false;
    if (path.startsWith(".obsidian/plugins/pylon-sync/")) return false;
    return true;
  }

  // Dotfiles at root (starts with ".")
  if (path.startsWith(".")) return false;

  // Dot-directories anywhere in path
  if (path.includes("/.")) return false;

  if (matchesIgnorePattern(path, ignorePatterns)) return false;

  return true;
}
