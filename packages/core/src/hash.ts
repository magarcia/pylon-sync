export async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

export async function hashText(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  return hashBuffer(encoded.buffer);
}

/**
 * Computes a Git-compatible blob SHA-1: SHA-1("blob <byteLength>\0" + content).
 * Used to compare local files against GitHub's tree API blob SHAs.
 */
export async function gitBlobSha(content: ArrayBuffer): Promise<string> {
  const header = `blob ${content.byteLength}\0`;
  const headerBytes = new TextEncoder().encode(header);

  const combined = new Uint8Array(headerBytes.length + content.byteLength);
  combined.set(headerBytes);
  combined.set(new Uint8Array(content), headerBytes.length);

  const digest = await crypto.subtle.digest("SHA-1", combined.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function gitBlobShaText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return gitBlobSha(bytes.buffer as ArrayBuffer);
}
