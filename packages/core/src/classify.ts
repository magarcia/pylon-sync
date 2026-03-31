import { hashBuffer } from "./hash";
import type { FileState } from "./types";

export async function classifyContent(
  buffer: ArrayBuffer,
  mtime: number,
): Promise<FileState> {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { type: "text", content: text };
  } catch {
    const hash = await hashBuffer(buffer);
    return { type: "binary", hash, modified: mtime, data: buffer };
  }
}
