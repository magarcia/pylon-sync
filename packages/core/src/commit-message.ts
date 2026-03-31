/**
 * Resolves template variables in a commit message.
 *
 * Built-in variables (resolved at call time):
 *   {{date}}      — YYYY-MM-DD (UTC)
 *   {{time}}      — HH:MM:SS (UTC)
 *   {{datetime}}  — ISO 8601
 *   {{timestamp}} — Unix epoch seconds
 *
 * Extra variables can be supplied via the `vars` parameter,
 * e.g. { vault: "MyVault" } resolves {{vault}}.
 *
 * Unknown variables are left untouched.
 */
export function resolveCommitMessage(
  template: string,
  vars?: Record<string, string>,
): string {
  const now = new Date();

  const builtIn: Record<string, string> = {
    date: now.toISOString().slice(0, 10),
    time: now.toISOString().slice(11, 19),
    datetime: now.toISOString(),
    timestamp: String(Math.floor(now.getTime() / 1000)),
  };

  const merged = { ...builtIn, ...vars };

  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = merged[key];
    return value !== undefined ? value : match;
  });
}
