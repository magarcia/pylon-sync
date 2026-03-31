import type {
  Provider,
  SyncCursor,
  FetchResult,
  PushPayload,
  ChangeSet,
  HttpClient,
} from "@pylon-sync/core";
import { classifyContent } from "@pylon-sync/core";
import { S3Api } from "./s3-api";
import type { S3Config, S3Cursor, S3ObjectMeta } from "./types";

const MANIFEST_KEY = ".pylon/manifest.json";

function isValidSyncPath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.includes("..")) return false;
  if (path.includes("\0")) return false;
  return true;
}

export class S3Provider implements Provider {
  private readonly api: S3Api;
  private readonly prefix: string;

  constructor(config: S3Config, http: HttpClient) {
    this.api = new S3Api(http, config);
    this.prefix = config.prefix ?? "";
  }

  async fetch(
    cursor?: SyncCursor,
    localPaths?: Set<string>,
  ): Promise<FetchResult> {
    const s3Cursor = cursor as S3Cursor | undefined;
    const oldSnapshot = s3Cursor?.snapshot ?? {};

    const objects = await this.listAllObjects();

    const currentRemote: Record<string, S3ObjectMeta> = {};
    for (const obj of objects) {
      const relativePath = this.stripPrefix(obj.key);
      if (relativePath.startsWith(".pylon/")) continue;
      if (!isValidSyncPath(relativePath)) continue;
      currentRemote[relativePath] = { etag: obj.etag, size: obj.size };
    }

    const changeset: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: [],
    };

    for (const [path, meta] of Object.entries(currentRemote)) {
      const oldMeta = oldSnapshot[path];
      if (!oldMeta) {
        if (localPaths?.has(path)) continue;
        const content = await this.api.getObject(this.prefixKey(path));
        changeset.added.set(path, await classifyContent(content, Date.now()));
      } else if (oldMeta.etag !== meta.etag) {
        const content = await this.api.getObject(this.prefixKey(path));
        changeset.modified.set(
          path,
          await classifyContent(content, Date.now()),
        );
      }
    }

    for (const key of Object.keys(oldSnapshot)) {
      if (!(key in currentRemote)) {
        changeset.deleted.push(key);
      }
    }

    let manifestEtag: string | undefined;
    const manifestObj = objects.find(
      (o) => this.stripPrefix(o.key) === MANIFEST_KEY,
    );
    manifestEtag = manifestObj?.etag;

    return {
      changes: changeset,
      cursor: {
        snapshot: currentRemote,
        manifestEtag,
      } satisfies S3Cursor,
    };
  }

  async push(payload: PushPayload, cursor?: SyncCursor): Promise<SyncCursor> {
    const s3Cursor = cursor as S3Cursor | undefined;
    const newSnapshot: Record<string, S3ObjectMeta> = {
      ...(s3Cursor?.snapshot ?? {}),
    };

    for (const [path, content] of payload.files) {
      const contentType =
        typeof content === "string"
          ? "text/plain; charset=utf-8"
          : "application/octet-stream";
      const etag = await this.api.putObject(
        this.prefixKey(path),
        content,
        contentType,
      );
      const size =
        typeof content === "string"
          ? new TextEncoder().encode(content).byteLength
          : content.byteLength;
      newSnapshot[path] = { etag, size };
    }

    if (payload.deletions.length > 0) {
      const keys = payload.deletions.map((p) => this.prefixKey(p));
      await this.api.deleteObjects(keys);
      for (const path of payload.deletions) {
        delete newSnapshot[path];
      }
    }

    const manifestContent = JSON.stringify(newSnapshot, null, 2);
    const manifestEtag = await this.api.putObject(
      this.prefixKey(MANIFEST_KEY),
      manifestContent,
      "application/json",
    );

    return {
      snapshot: newSnapshot,
      manifestEtag,
    } satisfies S3Cursor;
  }

  async bootstrap(): Promise<SyncCursor> {
    const exists = await this.api.headBucket();
    if (!exists) {
      throw new Error(
        "S3 bucket does not exist. Create it manually before syncing.",
      );
    }
    return { snapshot: {}, manifestEtag: undefined } satisfies S3Cursor;
  }

  async getBase(_path: string, _cursor: SyncCursor): Promise<string | null> {
    return null;
  }

  private prefixKey(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  private stripPrefix(key: string): string {
    if (this.prefix && key.startsWith(`${this.prefix}/`)) {
      return key.slice(this.prefix.length + 1);
    }
    return key;
  }

  private async listAllObjects(): Promise<
    ReadonlyArray<{ key: string; etag: string; size: number }>
  > {
    const all: Array<{ key: string; etag: string; size: number }> = [];
    let token: string | undefined;
    do {
      const result = await this.api.listObjects(
        this.prefix || undefined,
        token,
      );
      all.push(...result.objects);
      token = result.isTruncated ? result.nextToken : undefined;
    } while (token);
    return all;
  }
}
