import { describe, it, expect } from "vitest";
import { hashBuffer, hashText, gitBlobSha, gitBlobShaText } from "../hash";

describe("hashBuffer", () => {
  it('should return "sha256-{64 hex chars}" for any ArrayBuffer', async () => {
    const buffer = new TextEncoder().encode("test data").buffer;
    const result = await hashBuffer(buffer);

    expect(result).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it("should produce consistent hashes for identical input", async () => {
    const buffer = new TextEncoder().encode("same content").buffer;
    const result1 = await hashBuffer(buffer);
    const result2 = await hashBuffer(buffer);

    expect(result1).toBe(result2);
  });

  it("should handle empty ArrayBuffer", async () => {
    const buffer = new ArrayBuffer(0);
    const result = await hashBuffer(buffer);

    expect(result).toMatch(/^sha256-[0-9a-f]{64}$/);
    // SHA-256 of empty input is a known value
    expect(result).toBe(
      "sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});

describe("hashText", () => {
  it("should convert string to UTF-8 then hash", async () => {
    const result = await hashText("hello");

    expect(result).toMatch(/^sha256-[0-9a-f]{64}$/);
    // SHA-256 of "hello" in UTF-8
    expect(result).toBe(
      "sha256-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("should handle empty string", async () => {
    const result = await hashText("");

    // Empty string encodes to empty ArrayBuffer, same hash as empty buffer
    expect(result).toBe(
      "sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("should handle Unicode content (emoji, CJK)", async () => {
    const emoji = await hashText("Hello 🌍");
    const cjk = await hashText("你好世界");

    expect(emoji).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(cjk).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(emoji).not.toBe(cjk);
  });

  it('hashText("hello") and hashBuffer(encode("hello")) should produce identical hashes', async () => {
    const textHash = await hashText("hello");
    const bufferHash = await hashBuffer(
      new TextEncoder().encode("hello").buffer
    );

    expect(textHash).toBe(bufferHash);
  });
});

describe("gitBlobSha", () => {
  it("should produce SHA-1 matching Git's blob format", async () => {
    // echo -n "hello" | git hash-object --stdin
    const result = await gitBlobShaText("hello");
    expect(result).toBe("b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
  });

  it("should handle empty content", async () => {
    // echo -n "" | git hash-object --stdin
    const result = await gitBlobShaText("");
    expect(result).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("should handle binary content", async () => {
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const result = await gitBlobSha(binary as ArrayBuffer);
    expect(result).toMatch(/^[0-9a-f]{40}$/);
  });

  it("should produce consistent results for identical input", async () => {
    const a = await gitBlobShaText("test content");
    const b = await gitBlobShaText("test content");
    expect(a).toBe(b);
  });

  it("should produce different results for different content", async () => {
    const a = await gitBlobShaText("hello");
    const b = await gitBlobShaText("world");
    expect(a).not.toBe(b);
  });
});
