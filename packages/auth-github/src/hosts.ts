// GitHub host URL derivation. Supports:
// - github.com (default) → api.github.com
// - *.ghe.com (GitHub Enterprise Cloud with data residency) → api.<host>
// - any other host (GitHub Enterprise Server) → <host>/api/v3
//
// Device flow URLs always live on the web host (not the API host).

export interface HostUrls {
  readonly apiBase: string;
  readonly deviceCodeUrl: string;
  readonly accessTokenUrl: string;
  readonly verificationUri: string;
}

const GITHUB_COM = "github.com";

// IPv4 patterns that must not be used as a GitHub host. Prevents SSRF via
// requestUrl against internal infrastructure (cloud metadata, local services).
const BLOCKED_IP_PREFIXES = [
  "10.",
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.",
  "192.168.",
  "127.",
  "169.254.",
  "0.",
];

function looksLikeIp(host: string): boolean {
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(host)) return true;
  if (host.startsWith("[") || host.includes(":")) return true;
  return false;
}

function stripBrackets(host: string): string {
  if (host.startsWith("[") && host.includes("]")) {
    return host.slice(1, host.indexOf("]"));
  }
  return host;
}

function isBlockedHost(host: string): boolean {
  if (host === "localhost" || host.startsWith("localhost:")) return true;
  if (!looksLikeIp(host)) return false;

  const bare = stripBrackets(host);

  // IPv6 loopback
  if (bare === "::1") return true;

  // IPv4-mapped IPv6 (::ffff:<ipv4>) — check the embedded IPv4 address
  if (bare.startsWith("::ffff:")) {
    const embedded = bare.slice(7);
    return BLOCKED_IP_PREFIXES.some((prefix) => embedded.startsWith(prefix));
  }

  // IPv6 unique local (fc00::/7 covers fc00:: and fd00::)
  if (bare.startsWith("fc") || bare.startsWith("fd")) return true;

  // IPv6 link-local (fe80::/10)
  if (bare.startsWith("fe80:")) return true;

  // IPv4
  return BLOCKED_IP_PREFIXES.some((prefix) => host.startsWith(prefix));
}

export function normalizeHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  // Strip scheme if a user pasted a full URL.
  return trimmed.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function isGitHubDotCom(host: string): boolean {
  return normalizeHost(host) === GITHUB_COM;
}

export function validateHost(host: string): void {
  const normalized = normalizeHost(host);
  if (normalized.length === 0) {
    throw new Error("GitHub host cannot be empty");
  }
  if (isBlockedHost(normalized)) {
    throw new Error(
      `GitHub host "${normalized}" looks like a private or local address and cannot be used`,
    );
  }
}

export function resolveHostUrls(host: string): HostUrls {
  const normalized = normalizeHost(host);
  validateHost(normalized);

  if (normalized === GITHUB_COM) {
    return {
      apiBase: "https://api.github.com",
      deviceCodeUrl: "https://github.com/login/device/code",
      accessTokenUrl: "https://github.com/login/oauth/access_token",
      verificationUri: "https://github.com/login/device",
    };
  }

  // GitHub Enterprise Cloud with data residency (e.g., acme.ghe.com).
  if (normalized.endsWith(".ghe.com")) {
    return {
      apiBase: `https://api.${normalized}`,
      deviceCodeUrl: `https://${normalized}/login/device/code`,
      accessTokenUrl: `https://${normalized}/login/oauth/access_token`,
      verificationUri: `https://${normalized}/login/device`,
    };
  }

  // GitHub Enterprise Server.
  return {
    apiBase: `https://${normalized}/api/v3`,
    deviceCodeUrl: `https://${normalized}/login/device/code`,
    accessTokenUrl: `https://${normalized}/login/oauth/access_token`,
    verificationUri: `https://${normalized}/login/device`,
  };
}
