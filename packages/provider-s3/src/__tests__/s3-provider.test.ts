import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpClient, HttpResponse } from "@pylon-sync/core";
import { S3Provider } from "../s3-provider";
import type { S3Config, S3Cursor } from "../types";

function makeConfig(): S3Config {
  return {
    endpoint: "https://s3.us-east-1.amazonaws.com",
    region: "us-east-1",
    bucket: "test-bucket",
    accessKeyId: "AKID",
    secretAccessKey: "SECRET",
    forcePathStyle: true,
  };
}

function makeResponse(
  overrides: Partial<HttpResponse> = {},
): HttpResponse {
  return {
    status: 200,
    headers: {},
    json: null,
    text: "",
    arrayBuffer: new ArrayBuffer(0),
    ...overrides,
  };
}

function textToArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/**
 * Builds a mock HttpClient that routes requests based on method + URL patterns.
 * Each handler receives the request params and returns an HttpResponse.
 */
function buildMockHttp(routes: {
  list?: string;
  objects?: Record<string, string>;
  putEtags?: Record<string, string>;
  headStatus?: number;
}): HttpClient {
  const listXml = routes.list ?? `<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`;
  const objects = routes.objects ?? {};
  const putEtags = routes.putEtags ?? {};
  const headStatus = routes.headStatus ?? 200;

  return {
    request: vi.fn(async (params) => {
      const { url, method } = params;

      if (method === "HEAD") {
        if (headStatus >= 400) {
          return makeResponse({
            status: headStatus,
            text: "<Error><Code>NoSuchBucket</Code><Message>Not found</Message></Error>",
          });
        }
        return makeResponse({ status: headStatus });
      }

      if (method === "GET" && url.includes("list-type=2")) {
        return makeResponse({ text: listXml });
      }

      if (method === "GET") {
        for (const [key, content] of Object.entries(objects)) {
          if (url.includes(`/${key}`)) {
            return makeResponse({
              arrayBuffer: textToArrayBuffer(content),
            });
          }
        }
        return makeResponse({ status: 404, text: "<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>" });
      }

      if (method === "PUT") {
        for (const [key, etag] of Object.entries(putEtags)) {
          if (url.includes(`/${key}`) || key === "*") {
            return makeResponse({ headers: { etag: `"${etag}"` } });
          }
        }
        return makeResponse({ headers: { etag: '"default-etag"' } });
      }

      if (method === "DELETE" || method === "POST") {
        return makeResponse({ status: 204 });
      }

      return makeResponse();
    }),
  };
}

describe("S3Provider", () => {
  describe("fetch", () => {
    it("detects added files when remote has files not in cursor snapshot", async () => {
      const listXml = `
        <ListBucketResult>
          <Contents>
            <Key>hello.md</Key>
            <ETag>"etag1"</ETag>
            <Size>100</Size>
          </Contents>
          <Contents>
            <Key>world.md</Key>
            <ETag>"etag2"</ETag>
            <Size>200</Size>
          </Contents>
          <IsTruncated>false</IsTruncated>
        </ListBucketResult>
      `;
      const http = buildMockHttp({
        list: listXml,
        objects: {
          "hello.md": "hello content",
          "world.md": "world content",
        },
      });
      const provider = new S3Provider(makeConfig(), http);

      const result = await provider.fetch(undefined);

      expect(result.changes.added.size).toBe(2);
      expect(result.changes.added.has("hello.md")).toBe(true);
      expect(result.changes.added.has("world.md")).toBe(true);
      expect(result.changes.modified.size).toBe(0);
      expect(result.changes.deleted).toEqual([]);
    });

    it("detects modified files when etag changed", async () => {
      const listXml = `
        <ListBucketResult>
          <Contents>
            <Key>hello.md</Key>
            <ETag>"new-etag"</ETag>
            <Size>150</Size>
          </Contents>
          <IsTruncated>false</IsTruncated>
        </ListBucketResult>
      `;
      const http = buildMockHttp({
        list: listXml,
        objects: { "hello.md": "updated content" },
      });
      const provider = new S3Provider(makeConfig(), http);

      const cursor: S3Cursor = {
        snapshot: { "hello.md": { etag: "old-etag", size: 100 } },
      };
      const result = await provider.fetch(cursor);

      expect(result.changes.modified.size).toBe(1);
      expect(result.changes.modified.has("hello.md")).toBe(true);
      expect(result.changes.added.size).toBe(0);
      expect(result.changes.deleted).toEqual([]);
    });

    it("detects deleted files present in snapshot but not in remote", async () => {
      const listXml = `
        <ListBucketResult>
          <IsTruncated>false</IsTruncated>
        </ListBucketResult>
      `;
      const http = buildMockHttp({ list: listXml });
      const provider = new S3Provider(makeConfig(), http);

      const cursor: S3Cursor = {
        snapshot: { "deleted.md": { etag: "etag1", size: 100 } },
      };
      const result = await provider.fetch(cursor);

      expect(result.changes.deleted).toEqual(["deleted.md"]);
      expect(result.changes.added.size).toBe(0);
      expect(result.changes.modified.size).toBe(0);
    });

    it("returns empty changeset when nothing changed", async () => {
      const listXml = `
        <ListBucketResult>
          <Contents>
            <Key>hello.md</Key>
            <ETag>"same-etag"</ETag>
            <Size>100</Size>
          </Contents>
          <IsTruncated>false</IsTruncated>
        </ListBucketResult>
      `;
      const http = buildMockHttp({ list: listXml });
      const provider = new S3Provider(makeConfig(), http);

      const cursor: S3Cursor = {
        snapshot: { "hello.md": { etag: "same-etag", size: 100 } },
      };
      const result = await provider.fetch(cursor);

      expect(result.changes.added.size).toBe(0);
      expect(result.changes.modified.size).toBe(0);
      expect(result.changes.deleted).toEqual([]);
    });

    it("skips files that exist locally via localPaths", async () => {
      const listXml = `
        <ListBucketResult>
          <Contents>
            <Key>local-file.md</Key>
            <ETag>"etag1"</ETag>
            <Size>100</Size>
          </Contents>
          <Contents>
            <Key>remote-only.md</Key>
            <ETag>"etag2"</ETag>
            <Size>200</Size>
          </Contents>
          <IsTruncated>false</IsTruncated>
        </ListBucketResult>
      `;
      const http = buildMockHttp({
        list: listXml,
        objects: { "remote-only.md": "remote content" },
      });
      const provider = new S3Provider(makeConfig(), http);
      const localPaths = new Set(["local-file.md"]);

      const result = await provider.fetch(undefined, localPaths);

      expect(result.changes.added.size).toBe(1);
      expect(result.changes.added.has("remote-only.md")).toBe(true);
      expect(result.changes.added.has("local-file.md")).toBe(false);
    });

    it("skips .pylon/ internal files", async () => {
      const listXml = `
        <ListBucketResult>
          <Contents>
            <Key>.pylon/manifest.json</Key>
            <ETag>"manifest-etag"</ETag>
            <Size>50</Size>
          </Contents>
          <Contents>
            <Key>notes.md</Key>
            <ETag>"notes-etag"</ETag>
            <Size>100</Size>
          </Contents>
          <IsTruncated>false</IsTruncated>
        </ListBucketResult>
      `;
      const http = buildMockHttp({
        list: listXml,
        objects: { "notes.md": "content" },
      });
      const provider = new S3Provider(makeConfig(), http);

      const result = await provider.fetch(undefined);

      expect(result.changes.added.size).toBe(1);
      expect(result.changes.added.has("notes.md")).toBe(true);
    });

    it("returns cursor with updated snapshot", async () => {
      const listXml = `
        <ListBucketResult>
          <Contents>
            <Key>hello.md</Key>
            <ETag>"etag1"</ETag>
            <Size>100</Size>
          </Contents>
          <IsTruncated>false</IsTruncated>
        </ListBucketResult>
      `;
      const http = buildMockHttp({
        list: listXml,
        objects: { "hello.md": "content" },
      });
      const provider = new S3Provider(makeConfig(), http);

      const result = await provider.fetch(undefined);
      const cursor = result.cursor as S3Cursor;

      expect(cursor.snapshot).toEqual({
        "hello.md": { etag: "etag1", size: 100 },
      });
    });
  });

  describe("push", () => {
    it("uploads files and deletes files", async () => {
      const http = buildMockHttp({ putEtags: { "*": "new-etag" } });
      const provider = new S3Provider(makeConfig(), http);
      const cursor: S3Cursor = {
        snapshot: { "to-delete.md": { etag: "old", size: 50 } },
      };

      const payload = {
        files: new Map<string, string | ArrayBuffer>([
          ["new-file.md", "new content"],
        ]),
        deletions: ["to-delete.md"],
      };

      const newCursor = (await provider.push(payload, cursor)) as S3Cursor;

      expect(newCursor.snapshot["new-file.md"]).toBeDefined();
      expect(newCursor.snapshot["to-delete.md"]).toBeUndefined();
      expect(newCursor.manifestEtag).toBeDefined();
    });

    it("returns new cursor with updated snapshot after push", async () => {
      const http = buildMockHttp({ putEtags: { "*": "pushed-etag" } });
      const provider = new S3Provider(makeConfig(), http);

      const payload = {
        files: new Map<string, string | ArrayBuffer>([
          ["file.md", "content"],
        ]),
        deletions: [],
      };

      const newCursor = (await provider.push(payload)) as S3Cursor;

      expect(newCursor.snapshot["file.md"]).toEqual({
        etag: "pushed-etag",
        size: 7,
      });
    });

    it("writes manifest to .pylon/manifest.json", async () => {
      const http = buildMockHttp({ putEtags: { "*": "etag" } });
      const provider = new S3Provider(makeConfig(), http);

      const payload = {
        files: new Map<string, string | ArrayBuffer>([["a.md", "text"]]),
        deletions: [],
      };

      await provider.push(payload);

      const calls = vi.mocked(http.request).mock.calls;
      const manifestCall = calls.find(
        (c) =>
          c[0].method === "PUT" &&
          c[0].url.includes(".pylon/manifest.json"),
      );
      expect(manifestCall).toBeDefined();
    });
  });

  describe("bootstrap", () => {
    it("returns empty cursor when bucket exists", async () => {
      const http = buildMockHttp({ headStatus: 200 });
      const provider = new S3Provider(makeConfig(), http);

      const cursor = (await provider.bootstrap()) as S3Cursor;

      expect(cursor.snapshot).toEqual({});
      expect(cursor.manifestEtag).toBeUndefined();
    });

    it("throws when bucket does not exist", async () => {
      const http = buildMockHttp({ headStatus: 404 });
      const provider = new S3Provider(makeConfig(), http);

      await expect(provider.bootstrap()).rejects.toThrow(
        "S3 bucket does not exist",
      );
    });
  });

  describe("getBase", () => {
    it("returns null because S3 has no version history", async () => {
      const http = buildMockHttp({});
      const provider = new S3Provider(makeConfig(), http);

      const result = await provider.getBase("any-file.md", {
        snapshot: {},
      });

      expect(result).toBeNull();
    });
  });
});
