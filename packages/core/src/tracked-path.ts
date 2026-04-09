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
      ignorePatterns.length > 0 ? picomatch(ignorePatterns, { dot: true }) : null;
  }
  return cachedMatcher ? cachedMatcher(path) : false;
}

function matchesIncludePath(path: string, includePaths: string[]): boolean {
  for (const inc of includePaths) {
    if (inc.length === 0) continue;
    // Exact match for root dotfiles (e.g., ".gitignore")
    if (path === inc) return true;
    // Directory prefix match (e.g., ".claude" matches ".claude/foo.md")
    if (path.startsWith(inc + "/")) return true;
    // Nested dot-directory match (e.g., "notes/.claude" matches "notes/.claude/foo.md")
    if (path.includes("/" + inc + "/")) return true;
    // Nested exact file match (e.g., "notes/.gitignore")
    if (path.endsWith("/" + inc)) return true;
  }
  return false;
}

export function isTrackedPath(
  path: string,
  ignorePatterns: string[],
  syncObsidianSettings: boolean,
  includePaths: string[] = [],
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
  if (path.startsWith(".")) {
    if (!matchesIncludePath(path, includePaths)) return false;
  }

  // Dot-directories anywhere in path
  if (path.includes("/.")) {
    if (!matchesIncludePath(path, includePaths)) return false;
  }

  if (matchesIgnorePattern(path, ignorePatterns)) return false;

  return true;
}
