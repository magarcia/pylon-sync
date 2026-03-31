import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveCommitMessage } from "../commit-message";

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveCommitMessage", () => {
  it("should return plain text unchanged", () => {
    expect(resolveCommitMessage("vault: sync")).toBe("vault: sync");
  });

  it("should replace {{date}} with YYYY-MM-DD", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:30:00Z"));

    const result = resolveCommitMessage("sync on {{date}}");
    expect(result).toBe("sync on 2026-03-15");
  });

  it("should replace {{time}} with HH:MM:SS", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:30:45Z"));

    const result = resolveCommitMessage("sync at {{time}}");
    expect(result).toBe("sync at 10:30:45");
  });

  it("should replace {{datetime}} with ISO 8601", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:30:45.000Z"));

    const result = resolveCommitMessage("sync: {{datetime}}");
    expect(result).toBe("sync: 2026-03-15T10:30:45.000Z");
  });

  it("should replace {{timestamp}} with unix epoch seconds", () => {
    vi.useFakeTimers();
    const now = new Date("2026-03-15T10:30:00Z");
    vi.setSystemTime(now);

    const result = resolveCommitMessage("sync-{{timestamp}}");
    expect(result).toBe(`sync-${Math.floor(now.getTime() / 1000)}`);
  });

  it("should replace multiple variables in one template", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:30:45.000Z"));

    const result = resolveCommitMessage("vault: sync {{date}} {{time}}");
    expect(result).toBe("vault: sync 2026-03-15 10:30:45");
  });

  it("should replace duplicate variables", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:30:00Z"));

    const result = resolveCommitMessage("{{date}} - {{date}}");
    expect(result).toBe("2026-03-15 - 2026-03-15");
  });

  it("should accept custom variables via context", () => {
    const result = resolveCommitMessage("sync {{vault}}", { vault: "MyVault" });
    expect(result).toBe("sync MyVault");
  });

  it("should let custom variables coexist with built-in ones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:30:00Z"));

    const result = resolveCommitMessage("{{vault}}: sync {{date}}", {
      vault: "Notes",
    });
    expect(result).toBe("Notes: sync 2026-03-15");
  });

  it("should leave unknown variables untouched", () => {
    const result = resolveCommitMessage("sync {{unknown}}");
    expect(result).toBe("sync {{unknown}}");
  });

  it("should handle empty template", () => {
    expect(resolveCommitMessage("")).toBe("");
  });

  it("should handle template with only a variable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T10:30:00Z"));

    expect(resolveCommitMessage("{{date}}")).toBe("2026-03-15");
  });

  it("should not replace partial matches like {date} or {{ date }}", () => {
    const result = resolveCommitMessage("{date} and {{ date }}");
    expect(result).toBe("{date} and {{ date }}");
  });
});
