import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpClient, HttpResponse } from "@pylon-sync/core";
import { S3Api, S3ApiError } from "../s3-api";
import type { S3Config } from "../types";

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

function makeConfig(overrides: Partial<S3Config> = {}): S3Config {
  return {
    endpoint: "https://s3.us-east-1.amazonaws.com",
    region: "us-east-1",
    bucket: "test-bucket",
    accessKeyId: "AKID",
    secretAccessKey: "SECRET",
    forcePathStyle: true,
    ...overrides,
  };
}

function makeHttp(
  handler: (params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
  }) => HttpResponse,
): HttpClient {
  return {
    request: vi.fn(async (params) => handler(params)),
  };
}

describe("S3Api", () => {
  describe("listObjects", () => {
    it("sends GET request with list-type=2 query parameter", async () => {
      const listXml = `
        <ListBucketResult>
          <Contents>
            <Key>notes/hello.md</Key>
            <ETag>"abc"</ETag>
            <Size>100</Size>
          </Contents>
          <IsTruncated>false</IsTruncated>
        </ListBucketResult>
      `;
      const http = makeHttp(() => makeResponse({ text: listXml }));
      const api = new S3Api(http, makeConfig());

      const result = await api.listObjects("notes/");

      expect(http.request).toHaveBeenCalledOnce();
      const call = vi.mocked(http.request).mock.calls[0]![0];
      expect(call.method).toBe("GET");
      expect(call.url).toContain("list-type=2");
      expect(call.url).toContain("prefix=notes");
      expect(result.objects).toHaveLength(1);
      expect(result.objects[0]!.key).toBe("notes/hello.md");
    });

    it("passes continuation token for pagination", async () => {
      const xml = `
        <ListBucketResult>
          <IsTruncated>false</IsTruncated>
        </ListBucketResult>
      `;
      const http = makeHttp(() => makeResponse({ text: xml }));
      const api = new S3Api(http, makeConfig());

      await api.listObjects(undefined, "next-page-token");

      const call = vi.mocked(http.request).mock.calls[0]![0];
      expect(call.url).toContain("continuation-token=next-page-token");
    });
  });

  describe("getObject", () => {
    it("returns ArrayBuffer content from GET request", async () => {
      const content = new TextEncoder().encode("hello world").buffer as ArrayBuffer;
      const http = makeHttp(() => makeResponse({ arrayBuffer: content }));
      const api = new S3Api(http, makeConfig());

      const result = await api.getObject("notes/hello.md");

      expect(new TextDecoder().decode(result)).toBe("hello world");
      const call = vi.mocked(http.request).mock.calls[0]![0];
      expect(call.method).toBe("GET");
      expect(call.url).toContain("/test-bucket/notes/hello.md");
    });
  });

  describe("putObject", () => {
    it("sends PUT with content and returns ETag", async () => {
      const http = makeHttp(() =>
        makeResponse({ headers: { etag: '"abc123"' } }),
      );
      const api = new S3Api(http, makeConfig());

      const etag = await api.putObject(
        "notes/hello.md",
        "hello",
        "text/plain",
      );

      expect(etag).toBe("abc123");
      const call = vi.mocked(http.request).mock.calls[0]![0];
      expect(call.method).toBe("PUT");
      expect(call.url).toContain("/test-bucket/notes/hello.md");
      expect(call.body).toBe("hello");
    });
  });

  describe("deleteObject", () => {
    it("sends DELETE request for the given key", async () => {
      const http = makeHttp(() => makeResponse({ status: 204 }));
      const api = new S3Api(http, makeConfig());

      await api.deleteObject("notes/hello.md");

      const call = vi.mocked(http.request).mock.calls[0]![0];
      expect(call.method).toBe("DELETE");
      expect(call.url).toContain("/test-bucket/notes/hello.md");
    });
  });

  describe("deleteObjects", () => {
    it("sends POST with XML delete body for batch deletion", async () => {
      const http = makeHttp(() => makeResponse());
      const api = new S3Api(http, makeConfig());

      await api.deleteObjects(["file1.md", "file2.md"]);

      const call = vi.mocked(http.request).mock.calls[0]![0];
      expect(call.method).toBe("POST");
      expect(call.url).toContain("delete=");
      const body = call.body as string;
      expect(body).toContain("<Key>file1.md</Key>");
      expect(body).toContain("<Key>file2.md</Key>");
      expect(body).toContain("<Quiet>true</Quiet>");
    });

    it("skips the request when keys array is empty", async () => {
      const http = makeHttp(() => makeResponse());
      const api = new S3Api(http, makeConfig());

      await api.deleteObjects([]);

      expect(http.request).not.toHaveBeenCalled();
    });
  });

  describe("headBucket", () => {
    it("returns true when bucket exists (200)", async () => {
      const http = makeHttp(() => makeResponse({ status: 200 }));
      const api = new S3Api(http, makeConfig());

      const exists = await api.headBucket();

      expect(exists).toBe(true);
      const call = vi.mocked(http.request).mock.calls[0]![0];
      expect(call.method).toBe("HEAD");
    });

    it("returns false when bucket does not exist (404)", async () => {
      const http = makeHttp(() =>
        makeResponse({
          status: 404,
          text: "<Error><Code>NoSuchBucket</Code><Message>Not found</Message></Error>",
        }),
      );
      const api = new S3Api(http, makeConfig());

      const exists = await api.headBucket();

      expect(exists).toBe(false);
    });
  });

  describe("error handling", () => {
    it("throws S3ApiError for error responses", async () => {
      const errorXml =
        "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>";
      const http = makeHttp(() =>
        makeResponse({ status: 403, text: errorXml }),
      );
      const api = new S3Api(http, makeConfig());

      await expect(api.getObject("secret.md")).rejects.toThrow(S3ApiError);
      await expect(api.getObject("secret.md")).rejects.toMatchObject({
        code: "AccessDenied",
        message: "Access Denied",
        status: 403,
      });
    });

    it("uses fallback message when error XML cannot be parsed", async () => {
      const http = makeHttp(() =>
        makeResponse({ status: 500, text: "Internal error" }),
      );
      const api = new S3Api(http, makeConfig());

      await expect(api.listObjects()).rejects.toMatchObject({
        code: "UnknownError",
        status: 500,
      });
    });
  });

  describe("URL construction", () => {
    it("uses path-style URLs when forcePathStyle is true", async () => {
      const http = makeHttp(() => makeResponse({ text: "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>" }));
      const api = new S3Api(http, makeConfig({ forcePathStyle: true }));

      await api.listObjects();

      const call = vi.mocked(http.request).mock.calls[0]![0];
      expect(call.url).toContain(
        "https://s3.us-east-1.amazonaws.com/test-bucket",
      );
    });

    it("uses virtual-hosted URLs when forcePathStyle is false", async () => {
      const http = makeHttp(() => makeResponse({ text: "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>" }));
      const api = new S3Api(
        http,
        makeConfig({ forcePathStyle: false }),
      );

      await api.listObjects();

      const call = vi.mocked(http.request).mock.calls[0]![0];
      expect(call.url).toContain(
        "https://test-bucket.s3.us-east-1.amazonaws.com",
      );
    });
  });
});
