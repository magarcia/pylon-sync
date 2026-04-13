import { describe, it, expect } from "vitest";
import { resolveHostUrls, isGitHubDotCom } from "../hosts";

describe("resolveHostUrls", () => {
  it("should resolve github.com to api.github.com", () => {
    const urls = resolveHostUrls("github.com");
    expect(urls.apiBase).toBe("https://api.github.com");
    expect(urls.deviceCodeUrl).toBe(
      "https://github.com/login/device/code",
    );
  });

  it("should be case insensitive", () => {
    const urls = resolveHostUrls("GITHUB.COM");
    expect(urls.apiBase).toBe("https://api.github.com");
    expect(urls.deviceCodeUrl).toBe(
      "https://github.com/login/device/code",
    );
  });

  it("should strip scheme and trailing slash", () => {
    const urls = resolveHostUrls("https://github.com/");
    expect(urls.apiBase).toBe("https://api.github.com");
    expect(urls.deviceCodeUrl).toBe(
      "https://github.com/login/device/code",
    );
  });

  it("should resolve GHES hosts to /api/v3", () => {
    const urls = resolveHostUrls("ghes.example.com");
    expect(urls.apiBase).toBe("https://ghes.example.com/api/v3");
  });

  it("should resolve ghe.com hosts to api.<host>", () => {
    const urls = resolveHostUrls("acme.ghe.com");
    expect(urls.apiBase).toBe("https://api.acme.ghe.com");
  });
});

describe("isGitHubDotCom", () => {
  it("should return true for github.com", () => {
    expect(isGitHubDotCom("github.com")).toBe(true);
  });

  it("should return true for GITHUB.COM (case insensitive)", () => {
    expect(isGitHubDotCom("GITHUB.COM")).toBe(true);
  });

  it("should return false for GHES hosts", () => {
    expect(isGitHubDotCom("ghes.example.com")).toBe(false);
  });

  it("should return true after normalizing scheme and trailing slash", () => {
    expect(isGitHubDotCom("https://github.com/")).toBe(true);
  });
});

describe("SSRF protection", () => {
  const blockedHosts = [
    "::1",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "[::ffff:10.0.0.1]",
    "fc00::1",
    "fe80::1",
    "localhost",
    "127.0.0.1",
  ];

  for (const host of blockedHosts) {
    it(`should reject ${host}`, () => {
      expect(() => resolveHostUrls(host)).toThrow(
        /private or local address/,
      );
    });
  }

  const allowedHosts = ["ghes.example.com", "github.com"];

  for (const host of allowedHosts) {
    it(`should allow ${host}`, () => {
      expect(() => resolveHostUrls(host)).not.toThrow();
    });
  }
});
