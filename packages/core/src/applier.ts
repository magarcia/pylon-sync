import type { FileSystem, FileMutation } from "./types";

export async function applyMutations(
  fs: FileSystem,
  mutations: FileMutation[]
): Promise<void> {
  const deletes = mutations.filter((m) => m.disk === "delete");
  const writes = mutations.filter((m) => m.disk === "write");

  for (const mutation of deletes) {
    if (await fs.exists(mutation.path)) {
      await fs.delete(mutation.path);
    }
  }

  for (const mutation of writes) {
    if (mutation.binaryContent !== undefined) {
      await fs.writeBinary(mutation.path, mutation.binaryContent);
    } else if (mutation.content !== undefined) {
      await fs.writeText(mutation.path, mutation.content);
    }
  }
}
