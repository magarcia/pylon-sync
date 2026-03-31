import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { HttpClient, PushPayload } from "@pylon-sync/core";
import { PushConflictError } from "@pylon-sync/core";
import { GitHubApiError } from "../errors";
import { GitHubProvider } from "../github-provider";
import type { GitHubCursor } from "../github-provider";
import { zipSync } from "fflate";

vi.mock("../sleep", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

function createMockHttp() {
  return { request: vi.fn<HttpClient["request"]>() };
}

let mockHttp: ReturnType<typeof createMockHttp>;

beforeEach(() => {
  mockHttp = createMockHttp();
});

afterEach(() => {
  vi.useRealTimers();
});

function createProvider(overrides?: { owner?: string; repo?: string }) {
  const owner = overrides?.owner ?? "owner";
  const repo = overrides?.repo ?? "repo";
  return new GitHubProvider(
    { token: "ghp_test", repo: `${owner}/${repo}`, branch: "main" },
    mockHttp,
  );
}

function restResponse(
  status: number,
  json: unknown = {},
  headers: Record<string, string> = {},
) {
  return { status, json, headers, text: JSON.stringify(json), arrayBuffer: new ArrayBuffer(0) };
}

function rawResponse(text: string) {
  return {
    status: 200,
    json: null,
    headers: {},
    text,
    arrayBuffer: new TextEncoder().encode(text).buffer,
  };
}

function branchResponse(headSha: string, treeSha: string) {
  return restResponse(200, {
    commit: {
      sha: headSha,
      commit: { tree: { sha: treeSha } },
    },
  });
}

function treeResponse(entries: Array<{ path: string; type: string; sha: string }>) {
  return restResponse(200, { tree: entries });
}

function commitResponse(treeSha: string) {
  return restResponse(200, { tree: { sha: treeSha } });
}

const cursor = (commitSha: string, treeSha: string): GitHubCursor => ({
  commitSha,
  treeSha,
});

function zipResponse(files: Record<string, Uint8Array>) {
  const zipped = zipSync(files);
  return {
    status: 200,
    json: null,
    headers: {},
    text: "",
    arrayBuffer: zipped.buffer as ArrayBuffer,
  };
}

describe("GitHubProvider", () => {
  describe("fetch()", () => {
    it("should return empty changeset when cursor commitSha matches HEAD", async () => {
      const provider = createProvider();

      mockHttp.request.mockResolvedValueOnce(branchResponse("head123", "tree456"));

      const result = await provider.fetch(cursor("head123", "tree000"));

      const ghCursor = result.cursor as GitHubCursor;
      expect(ghCursor.commitSha).toBe("head123");
      expect(ghCursor.treeSha).toBe("tree456");
      expect(result.changes.added.size).toBe(0);
      expect(result.changes.modified.size).toBe(0);
      expect(result.changes.deleted).toHaveLength(0);
      expect(mockHttp.request).toHaveBeenCalledTimes(1);
    });

    it("should detect added files by comparing old tree vs new tree", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head2", "newTree"))
        .mockResolvedValueOnce(commitResponse("oldTree"))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "existing.md", type: "blob", sha: "blob1" },
          ]),
        )
        .mockResolvedValueOnce(
          treeResponse([
            { path: "existing.md", type: "blob", sha: "blob1" },
            { path: "new-file.md", type: "blob", sha: "blob2" },
          ]),
        )
        .mockResolvedValueOnce(rawResponse("new file content"));

      const result = await provider.fetch(cursor("head1", "tree1"));

      expect(result.changes.added.has("new-file.md")).toBe(true);
      expect(result.changes.added.get("new-file.md")).toEqual({
        type: "text",
        content: "new file content",
      });
      expect(result.changes.modified.size).toBe(0);
      expect(result.changes.deleted).toHaveLength(0);
    });

    it("should detect modified files by comparing blob SHAs", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head2", "newTree"))
        .mockResolvedValueOnce(commitResponse("oldTree"))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "doc.md", type: "blob", sha: "oldblob" },
          ]),
        )
        .mockResolvedValueOnce(
          treeResponse([
            { path: "doc.md", type: "blob", sha: "newblob" },
          ]),
        )
        .mockResolvedValueOnce(rawResponse("updated content"));

      const result = await provider.fetch(cursor("head1", "tree1"));

      expect(result.changes.modified.has("doc.md")).toBe(true);
      expect(result.changes.modified.get("doc.md")).toEqual({
        type: "text",
        content: "updated content",
      });
    });

    it("should detect deleted files (in old tree, not in new tree)", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head2", "newTree"))
        .mockResolvedValueOnce(commitResponse("oldTree"))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "keep.md", type: "blob", sha: "blob1" },
            { path: "removed.md", type: "blob", sha: "blob2" },
          ]),
        )
        .mockResolvedValueOnce(
          treeResponse([
            { path: "keep.md", type: "blob", sha: "blob1" },
          ]),
        );

      const result = await provider.fetch(cursor("head1", "tree1"));

      expect(result.changes.deleted).toContain("removed.md");
      expect(result.changes.deleted).not.toContain("keep.md");
    });

    it("should handle first sync (no cursor) -- treat all files as added via archive download", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head1", "tree1"))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "notes/a.md", type: "blob", sha: "blobsha1" },
            { path: "folder", type: "tree", sha: "treesha" },
          ]),
        )
        .mockResolvedValueOnce(
          zipResponse({
            "owner-repo-head1/notes/a.md": new TextEncoder().encode("content of a"),
          }),
        );

      const result = await provider.fetch(undefined);

      expect(result.changes.added.has("notes/a.md")).toBe(true);
      expect(result.changes.added.get("notes/a.md")).toEqual({
        type: "text",
        content: "content of a",
      });
      expect(result.changes.added.has("folder")).toBe(false);
    });

    it("should handle empty repo (404/409 on branch) -- return empty changeset", async () => {
      const provider = createProvider();

      mockHttp.request.mockResolvedValueOnce(
        restResponse(409, { message: "Git Repository is empty." }),
      );

      const result = await provider.fetch(undefined);

      expect(result.cursor).toBeNull();
      expect(result.changes.added.size).toBe(0);
      expect(result.changes.modified.size).toBe(0);
      expect(result.changes.deleted).toHaveLength(0);
    });

    it("should fetch text content for changed files", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head2", "newTree"))
        .mockResolvedValueOnce(commitResponse("oldTree"))
        .mockResolvedValueOnce(treeResponse([]))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "readme.md", type: "blob", sha: "blob1" },
          ]),
        )
        .mockResolvedValueOnce(rawResponse("# README\nHello"));

      const result = await provider.fetch(cursor("head1", "tree1"));

      // Verify it called with the right Accept header for raw content
      const contentCall = mockHttp.request.mock.calls[4]![0];
      expect(contentCall.url).toContain("/repos/owner/repo/contents/readme.md?ref=head2");
      expect(contentCall.headers?.Accept).toBe("application/vnd.github.raw+json");

      const state = result.changes.added.get("readme.md");
      expect(state).toEqual({ type: "text", content: "# README\nHello" });
    });

    it("should fetch binary content for changed files", async () => {
      const provider = createProvider();

      const binaryBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head2", "newTree"))
        .mockResolvedValueOnce(commitResponse("oldTree"))
        .mockResolvedValueOnce(treeResponse([]))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "image.png", type: "blob", sha: "blob1" },
          ]),
        )
        .mockResolvedValueOnce({
          status: 200,
          json: null,
          headers: {},
          text: "",
          arrayBuffer: binaryBytes.buffer,
        });

      const result = await provider.fetch(cursor("head1", "tree1"));

      const state = result.changes.added.get("image.png");
      expect(state).toBeDefined();
      expect(state!.type).toBe("binary");
    });

    it("should include dotfiles in tree comparison (filtering is done by core)", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head2", "newTree"))
        .mockResolvedValueOnce(commitResponse("oldTree"))
        .mockResolvedValueOnce(treeResponse([]))
        .mockResolvedValueOnce(
          treeResponse([
            { path: ".gitkeep", type: "blob", sha: "blob1" },
            { path: ".obsidian/config.json", type: "blob", sha: "blob2" },
            { path: "notes/hello.md", type: "blob", sha: "blob3" },
          ]),
        )
        // Content fetches for all 3 files
        .mockResolvedValueOnce(rawResponse(""))
        .mockResolvedValueOnce(rawResponse("{}"))
        .mockResolvedValueOnce(rawResponse("hello"));

      const result = await provider.fetch(cursor("head1", "tree1"));

      // Provider returns all files — core's isTrackedPath filters them
      expect(result.changes.added.has(".gitkeep")).toBe(true);
      expect(result.changes.added.has(".obsidian/config.json")).toBe(true);
      expect(result.changes.added.has("notes/hello.md")).toBe(true);
    });

    it("should fall back to per-file fetch if archive download fails", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head1", "tree1"))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "notes/a.md", type: "blob", sha: "blobsha1" },
          ]),
        )
        // Archive download fails (network error, then retry gets invalid zip data)
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(rawResponse("not a zip"))
        // Falls back to per-file fetch
        .mockResolvedValueOnce(rawResponse("content of a"));

      const result = await provider.fetch(undefined);

      expect(result.changes.added.has("notes/a.md")).toBe(true);
      expect(result.changes.added.get("notes/a.md")).toEqual({
        type: "text",
        content: "content of a",
      });
    });

    it("should skip files that exist locally (localPaths) when using archive", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head1", "tree1"))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "notes/a.md", type: "blob", sha: "blobsha1" },
            { path: "notes/b.md", type: "blob", sha: "blobsha2" },
          ]),
        )
        .mockResolvedValueOnce(
          zipResponse({
            "owner-repo-head1/notes/a.md": new TextEncoder().encode("content a"),
            "owner-repo-head1/notes/b.md": new TextEncoder().encode("content b"),
          }),
        );

      const localPaths = new Set(["notes/a.md"]);
      const result = await provider.fetch(undefined, localPaths);

      expect(result.changes.added.has("notes/a.md")).toBe(false);
      expect(result.changes.added.has("notes/b.md")).toBe(true);
      expect(result.changes.added.get("notes/b.md")).toEqual({
        type: "text",
        content: "content b",
      });
    });

    it("should strip root directory prefix from ZIP paths", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head1", "tree1"))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "docs/readme.md", type: "blob", sha: "blobsha1" },
          ]),
        )
        .mockResolvedValueOnce(
          zipResponse({
            "magarcia-test-obsidian-sync-26b17af/docs/readme.md":
              new TextEncoder().encode("# Readme"),
          }),
        );

      const result = await provider.fetch(undefined);

      expect(result.changes.added.has("docs/readme.md")).toBe(true);
      expect(result.changes.added.get("docs/readme.md")).toEqual({
        type: "text",
        content: "# Readme",
      });
    });

    it("should classify text vs binary from archive content", async () => {
      const provider = createProvider();

      // PNG magic bytes — not valid UTF-8
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head1", "tree1"))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "notes/hello.md", type: "blob", sha: "blobsha1" },
            { path: "images/photo.png", type: "blob", sha: "blobsha2" },
          ]),
        )
        .mockResolvedValueOnce(
          zipResponse({
            "owner-repo-head1/notes/hello.md": new TextEncoder().encode("# Hello"),
            "owner-repo-head1/images/photo.png": pngBytes,
          }),
        );

      const result = await provider.fetch(undefined);

      const textState = result.changes.added.get("notes/hello.md");
      expect(textState).toEqual({ type: "text", content: "# Hello" });

      const binaryState = result.changes.added.get("images/photo.png");
      expect(binaryState).toBeDefined();
      expect(binaryState!.type).toBe("binary");
      if (binaryState!.type === "binary") {
        expect(binaryState!.data).toBeInstanceOf(ArrayBuffer);
      }
    });

    it("should validate paths from tree responses", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(branchResponse("head2", "newTree"))
        .mockResolvedValueOnce(commitResponse("oldTree"))
        .mockResolvedValueOnce(treeResponse([]))
        .mockResolvedValueOnce(
          treeResponse([
            { path: "../escape.md", type: "blob", sha: "blob1" },
            { path: "/absolute.md", type: "blob", sha: "blob2" },
            { path: "valid.md", type: "blob", sha: "blob3" },
          ]),
        )
        .mockResolvedValueOnce(rawResponse("valid content"));

      const result = await provider.fetch(cursor("head1", "tree1"));

      expect(result.changes.added.has("../escape.md")).toBe(false);
      expect(result.changes.added.has("/absolute.md")).toBe(false);
      expect(result.changes.added.has("valid.md")).toBe(true);
    });
  });

  describe("push()", () => {
    function basePushSetup() {
      mockHttp.request
        .mockResolvedValueOnce(restResponse(201, { sha: "newtree123" }))
        .mockResolvedValueOnce(restResponse(201, { sha: "newcommit456" }))
        .mockResolvedValueOnce(restResponse(200));
    }

    it("should create tree with file changes", async () => {
      const provider = createProvider();
      basePushSetup();

      const payload: PushPayload = {
        files: new Map([["notes/a.md", "hello world"]]),
        deletions: [],
      };

      const result = await provider.push(payload, cursor("head1", "tree1"));

      const ghResult = result as unknown as GitHubCursor;
      expect(ghResult.commitSha).toBe("newcommit456");

      const treeCall = mockHttp.request.mock.calls[0]![0];
      expect(treeCall.method).toBe("POST");
      expect(treeCall.url).toContain("/repos/owner/repo/git/trees");
      const treeBody = JSON.parse(treeCall.body! as string);
      expect(treeBody.base_tree).toBe("tree1");
      expect(treeBody.tree).toEqual([
        {
          path: "notes/a.md",
          mode: "100644",
          type: "blob",
          content: "hello world",
        },
      ]);
    });

    it("should create commit and update ref", async () => {
      const provider = createProvider();
      basePushSetup();

      const payload: PushPayload = {
        files: new Map(),
        deletions: [],
      };

      await provider.push(payload, cursor("head1", "tree1"));

      const commitCall = mockHttp.request.mock.calls[1]![0];
      expect(commitCall.method).toBe("POST");
      expect(commitCall.url).toContain("/repos/owner/repo/git/commits");
      const commitBody = JSON.parse(commitCall.body! as string);
      expect(commitBody).toEqual({
        message: "vault: sync",
        tree: "newtree123",
        parents: ["head1"],
      });

      const refCall = mockHttp.request.mock.calls[2]![0];
      expect(refCall.method).toBe("PATCH");
      expect(refCall.url).toContain("/repos/owner/repo/git/refs/heads/main");
      const refBody = JSON.parse(refCall.body! as string);
      expect(refBody).toEqual({ sha: "newcommit456", force: false });
    });

    it("should resolve template variables in commit message", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-15T10:30:00.000Z"));

      const provider = new GitHubProvider(
        { token: "ghp_test", repo: "owner/repo", branch: "main", commitMessage: "sync {{date}}" },
        mockHttp,
      );

      mockHttp.request
        .mockResolvedValueOnce(restResponse(201, { sha: "newtree" }))
        .mockResolvedValueOnce(restResponse(201, { sha: "newcommit" }))
        .mockResolvedValueOnce(restResponse(200));

      await provider.push(
        { files: new Map(), deletions: [] },
        cursor("head1", "tree1"),
      );

      const commitCall = mockHttp.request.mock.calls[1]![0];
      const commitBody = JSON.parse(commitCall.body! as string);
      expect(commitBody.message).toBe("sync 2026-03-15");
    });

    it("should throw PushConflictError on 422 when HEAD moved", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(restResponse(201, { sha: "newtree" }))
        .mockResolvedValueOnce(restResponse(201, { sha: "newcommit" }))
        .mockResolvedValueOnce(restResponse(422))
        .mockResolvedValueOnce(branchResponse("different-head", "tree2"));

      const payload: PushPayload = {
        files: new Map(),
        deletions: [],
      };

      await expect(
        provider.push(payload, cursor("head1", "tree1")),
      ).rejects.toThrow(PushConflictError);
    });

    it("should retry ref update on 422 when HEAD matches (transient failure)", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(restResponse(201, { sha: "newtree" }))   // create tree
        .mockResolvedValueOnce(restResponse(201, { sha: "newcommit" })) // create commit
        .mockResolvedValueOnce(restResponse(422))                       // ref update fails
        .mockResolvedValueOnce(branchResponse("head1", "tree1"))        // HEAD check — matches
        .mockResolvedValueOnce(restResponse(200));                      // ref update retry succeeds

      const result = await provider.push(
        { files: new Map(), deletions: [] },
        cursor("head1", "tree1"),
      );

      const ghResult = result as unknown as GitHubCursor;
      expect(ghResult.commitSha).toBe("newcommit");
      expect(mockHttp.request).toHaveBeenCalledTimes(5);
    });

    it("should throw GitHubApiError after exhausting ref update retries when HEAD matches", async () => {
      const provider = createProvider();

      mockHttp.request
        .mockResolvedValueOnce(restResponse(201, { sha: "newtree" }))   // create tree
        .mockResolvedValueOnce(restResponse(201, { sha: "newcommit" })) // create commit
        // 3 rounds: 422 + HEAD check (matches) each
        .mockResolvedValueOnce(restResponse(422))
        .mockResolvedValueOnce(branchResponse("head1", "tree1"))
        .mockResolvedValueOnce(restResponse(422))
        .mockResolvedValueOnce(branchResponse("head1", "tree1"))
        .mockResolvedValueOnce(restResponse(422))
        .mockResolvedValueOnce(branchResponse("head1", "tree1"));

      await expect(
        provider.push(
          { files: new Map(), deletions: [] },
          cursor("head1", "tree1"),
        ),
      ).rejects.toThrow(GitHubApiError);
    });

    it("should handle deletions in tree", async () => {
      const provider = createProvider();
      basePushSetup();

      const payload: PushPayload = {
        files: new Map(),
        deletions: ["old-file.md", "another.md"],
      };

      await provider.push(payload, cursor("head1", "tree1"));

      const treeCall = mockHttp.request.mock.calls[0]![0];
      const treeBody = JSON.parse(treeCall.body! as string);
      expect(treeBody.tree).toEqual([
        { path: "old-file.md", mode: "100644", type: "blob", sha: null },
        { path: "another.md", mode: "100644", type: "blob", sha: null },
      ]);
    });
  });

  describe("getBase()", () => {
    it("should return text content for a file at a specific commit", async () => {
      const provider = createProvider();

      mockHttp.request.mockResolvedValueOnce({
        status: 200,
        json: null,
        headers: {},
        text: "content at commit",
        arrayBuffer: new TextEncoder().encode("content at commit").buffer,
      });

      const result = await provider.getBase("notes/doc.md", cursor("abc123", "tree1"));

      expect(result).toBe("content at commit");
      const call = mockHttp.request.mock.calls[0]![0];
      expect(call.url).toContain("/repos/owner/repo/contents/notes/doc.md?ref=abc123");
      expect(call.headers?.Accept).toBe("application/vnd.github.raw+json");
    });

    it("should return null when file doesn't exist at commit (404)", async () => {
      const provider = createProvider();

      mockHttp.request.mockResolvedValueOnce(
        restResponse(404, { message: "Not Found" }),
      );

      const result = await provider.getBase("missing.md", cursor("abc123", "tree1"));

      expect(result).toBeNull();
    });
  });

  describe("bootstrap()", () => {
    it("should create initial .gitkeep file and return cursor", async () => {
      const provider = createProvider();
      mockHttp.request
        .mockResolvedValueOnce(restResponse(200, {})) // ensureRepository: repo exists
        .mockResolvedValueOnce(restResponse(201)) // .gitkeep creation
        .mockResolvedValueOnce(branchResponse("head1", "tree1")); // branch info

      const result = await provider.bootstrap();

      const ghResult = result as unknown as GitHubCursor;
      expect(ghResult.commitSha).toBe("head1");
      expect(ghResult.treeSha).toBe("tree1");

      const createCall = mockHttp.request.mock.calls[1]![0];
      expect(createCall.url).toContain("/repos/owner/repo/contents/.gitkeep");
      const createBody = JSON.parse(createCall.body! as string);
      expect(createBody).toEqual({
        message: "Initialize repository",
        content: btoa(""),
        branch: "main",
      });
    });

    it("should handle already-initialized repo (422)", async () => {
      const provider = createProvider();
      mockHttp.request
        .mockResolvedValueOnce(restResponse(200, {})) // ensureRepository: repo exists
        .mockResolvedValueOnce(restResponse(422)) // .gitkeep already exists
        .mockResolvedValueOnce(branchResponse("head1", "tree1"));

      await expect(provider.bootstrap()).resolves.not.toThrow();
    });

    it("should create repo if it doesn't exist", async () => {
      const provider = createProvider();
      mockHttp.request
        .mockResolvedValueOnce(restResponse(404, { message: "Not Found" })) // ensureRepository: repo not found
        .mockResolvedValueOnce(restResponse(200, { login: "owner" })) // GET /user
        .mockResolvedValueOnce(restResponse(201, {})) // POST /user/repos
        .mockResolvedValueOnce(restResponse(201, {})) // .gitkeep creation
        .mockResolvedValueOnce(branchResponse("abc", "def")); // branch info

      const result = await provider.bootstrap();

      const ghResult = result as unknown as GitHubCursor;
      expect(ghResult.commitSha).toBe("abc");
      expect(ghResult.treeSha).toBe("def");

      const createCall = mockHttp.request.mock.calls[2]![0];
      expect(createCall.url).toContain("/user/repos");
      expect(JSON.parse(createCall.body! as string)).toMatchObject({
        name: "repo",
        private: true,
        auto_init: false,
      });
    });

    it("should create org repo when owner is not the authenticated user", async () => {
      const provider = createProvider({ owner: "my-org", repo: "vault" });
      mockHttp.request
        .mockResolvedValueOnce(restResponse(404, {})) // ensureRepository: repo not found
        .mockResolvedValueOnce(restResponse(200, { login: "owner" })) // GET /user
        .mockResolvedValueOnce(restResponse(201, {})) // POST /orgs/my-org/repos
        .mockResolvedValueOnce(restResponse(201, {})) // .gitkeep creation
        .mockResolvedValueOnce(branchResponse("abc", "def")); // branch info

      await provider.bootstrap();

      const createCall = mockHttp.request.mock.calls[2]![0];
      expect(createCall.url).toContain("/orgs/my-org/repos");
      expect(JSON.parse(createCall.body! as string)).toMatchObject({
        name: "vault",
        private: true,
        auto_init: false,
      });
    });

    it("should not create repo if it already exists", async () => {
      const provider = createProvider();
      mockHttp.request
        .mockResolvedValueOnce(restResponse(200, {})) // ensureRepository: repo exists
        .mockResolvedValueOnce(restResponse(201, {})) // .gitkeep creation
        .mockResolvedValueOnce(branchResponse("abc", "def")); // branch info

      await provider.bootstrap();

      // 3 calls: repo check + .gitkeep + branch info (no creation calls)
      expect(mockHttp.request).toHaveBeenCalledTimes(3);
    });

    it("should handle race condition where repo is created between check and create (422)", async () => {
      const provider = createProvider();
      mockHttp.request
        .mockResolvedValueOnce(restResponse(404, {})) // ensureRepository: repo not found
        .mockResolvedValueOnce(restResponse(200, { login: "owner" })) // GET /user
        .mockResolvedValueOnce(restResponse(422, { message: "name already exists" })) // POST /user/repos — race
        .mockResolvedValueOnce(restResponse(200, {})) // retry GET /repos — now exists
        .mockResolvedValueOnce(restResponse(201, {})) // .gitkeep creation
        .mockResolvedValueOnce(branchResponse("abc", "def")); // branch info

      const result = await provider.bootstrap();

      const ghResult = result as unknown as GitHubCursor;
      expect(ghResult.commitSha).toBe("abc");
    });
  });
});
