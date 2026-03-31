import { GitHubApi } from "./github-api";
import type {
  ChangeSet,
  FileState,
  FetchResult,
  HttpClient,
  PushPayload,
  SnapshotEntry,
  Provider,
  SyncCursor,
} from "@pylon-sync/core";
import { PushConflictError, classifyContent, resolveCommitMessage } from "@pylon-sync/core";
import { GitHubApiError } from "./errors";
import { sleep } from "./sleep";
import { unzip } from "fflate";

export interface GitHubCursor {
  commitSha: string;
  treeSha: string;
}

function encodeGitHubPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function isValidSyncPath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.includes("..")) return false;
  if (path.includes("\0")) return false;
  return true;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

type TreeEntry = { path: string; type: string; sha: string };

export class GitHubProvider implements Provider {
  private api: GitHubApi;
  private owner: string;
  private repo: string;
  private branch: string;
  private token: string;
  private commitMessage: string;
  private cachedUsername: string | null = null;

  constructor(
    config: { token: string; repo: string; branch: string; commitMessage?: string },
    http: HttpClient,
  ) {
    const [owner, repo] = config.repo.split("/");
    if (!owner || !repo || !/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
      throw new Error(`Invalid repository format: "${config.repo}". Expected "owner/repo".`);
    }
    if (!/^[a-zA-Z0-9._\/-]+$/.test(config.branch)) {
      throw new Error(`Invalid branch name: "${config.branch}"`);
    }
    this.owner = owner;
    this.repo = repo;
    this.branch = config.branch;
    this.token = config.token;
    this.commitMessage = config.commitMessage ?? "vault: sync";
    this.api = new GitHubApi(http);
  }

  async fetch(cursor?: SyncCursor, localPaths?: Set<string>): Promise<FetchResult> {
    const ghCursor = cursor as GitHubCursor | undefined;
    const lastCommitSha = ghCursor?.commitSha ?? "";
    console.log("[GitHubProvider] fetch — lastCommitSha:", lastCommitSha || "(none)");

    const emptyResult: FetchResult = {
      changes: { added: new Map(), modified: new Map(), deleted: [] },
      cursor: null,
    };

    // 1. Get branch HEAD
    const branchRes = await this.api.rest(
      "GET",
      `/repos/${this.owner}/${this.repo}/branches/${this.branch}`,
      this.token,
    );

    if (branchRes.status === 404 || branchRes.status === 409) {
      return emptyResult;
    }

    const branchData = branchRes.json as {
      commit: { sha: string; commit: { tree: { sha: string } } };
    };
    const headSha = branchData.commit.sha;
    const treeSha = branchData.commit.commit.tree.sha;
    const newCursor: GitHubCursor = { commitSha: headSha, treeSha };

    // 2. No remote changes if HEAD hasn't moved
    if (lastCommitSha && headSha === lastCommitSha) {
      return {
        changes: { added: new Map(), modified: new Map(), deleted: [] },
        cursor: newCursor,
      };
    }

    // 3. First sync (no lastCommitSha) -- treat all remote files as added
    if (!lastCommitSha) {
      return this.fetchFullTree({}, headSha, treeSha, localPaths);
    }

    // 4. Compare old tree vs new tree
    const oldCommitRes = await this.api.rest(
      "GET",
      `/repos/${this.owner}/${this.repo}/git/commits/${lastCommitSha}`,
      this.token,
    );
    if (oldCommitRes.status === 404) {
      return this.fetchFullTree({}, headSha, treeSha, localPaths);
    }
    const oldTreeSha = (oldCommitRes.json as { tree: { sha: string } }).tree.sha;

    const [oldTreeRes, newTreeRes] = await Promise.all([
      this.api.rest(
        "GET",
        `/repos/${this.owner}/${this.repo}/git/trees/${oldTreeSha}?recursive=1`,
        this.token,
      ),
      this.api.rest(
        "GET",
        `/repos/${this.owner}/${this.repo}/git/trees/${treeSha}?recursive=1`,
        this.token,
      ),
    ]);

    const oldTreeData = oldTreeRes.json as { tree: TreeEntry[]; truncated?: boolean };
    if (oldTreeData.truncated) {
      console.warn("GitHub tree response was truncated — some files may be missed");
    }
    const newTreeData = newTreeRes.json as { tree: TreeEntry[]; truncated?: boolean };
    if (newTreeData.truncated) {
      console.warn("GitHub tree response was truncated — some files may be missed");
    }

    const oldBlobs = this.buildBlobMap(oldTreeData.tree);
    const newBlobs = this.buildBlobMap(newTreeData.tree);

    const changeset: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: [],
    };

    const fetchPaths: Array<{ path: string; target: "added" | "modified" }> = [];

    for (const [path, sha] of newBlobs) {
      const oldSha = oldBlobs.get(path);
      if (oldSha === undefined) {
        fetchPaths.push({ path, target: "added" });
      } else if (oldSha !== sha) {
        fetchPaths.push({ path, target: "modified" });
      }
    }

    for (const path of oldBlobs.keys()) {
      if (!newBlobs.has(path)) {
        changeset.deleted.push(path);
      }
    }

    const CONCURRENCY = 5;
    for (let i = 0; i < fetchPaths.length; i += CONCURRENCY) {
      const batch = fetchPaths.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async ({ path, target }) => ({
          path,
          target,
          state: await this.fetchFileContent(path, headSha),
        })),
      );
      for (const { path, target, state } of results) {
        changeset[target].set(path, state);
      }
    }

    return { changes: changeset, cursor: newCursor };
  }

  async push(payload: PushPayload, cursor?: SyncCursor): Promise<SyncCursor> {
    const ghCursor = cursor as GitHubCursor | undefined;
    const headSha = ghCursor?.commitSha ?? "";
    const treeSha = ghCursor?.treeSha ?? "";

    // 1. Build tree entries
    const treeEntries: Array<{
      path: string;
      mode: string;
      type: string;
      content?: string;
      sha?: string | null;
    }> = [];

    for (const [path, content] of payload.files) {
      if (typeof content === "string") {
        treeEntries.push({
          path,
          mode: "100644",
          type: "blob",
          content,
        });
      } else {
        const blobRes = await this.api.rest(
          "POST",
          `/repos/${this.owner}/${this.repo}/git/blobs`,
          this.token,
          { content: arrayBufferToBase64(content), encoding: "base64" },
        );
        const blobData = blobRes.json as { sha: string };
        treeEntries.push({
          path,
          mode: "100644",
          type: "blob",
          sha: blobData.sha,
        });
      }
    }

    for (const path of payload.deletions) {
      treeEntries.push({
        path,
        mode: "100644",
        type: "blob",
        sha: null,
      });
    }

    // 2. Create tree
    console.log("[GitHubProvider] Creating tree — base_tree:", treeSha, "entries:", treeEntries.length);
    const treeRes = await this.api.rest(
      "POST",
      `/repos/${this.owner}/${this.repo}/git/trees`,
      this.token,
      { base_tree: treeSha, tree: treeEntries },
    );
    const newTreeSha = (treeRes.json as { sha: string }).sha;
    console.log("[GitHubProvider] Tree created:", newTreeSha);

    // 3. Create commit
    console.log("[GitHubProvider] Creating commit — parent:", headSha);
    const commitRes = await this.api.rest(
      "POST",
      `/repos/${this.owner}/${this.repo}/git/commits`,
      this.token,
      { message: resolveCommitMessage(this.commitMessage), tree: newTreeSha, parents: [headSha] },
    );
    const newCommitSha = (commitRes.json as { sha: string }).sha;
    console.log("[GitHubProvider] Commit created:", newCommitSha);

    // 4. Update ref (with retry for transient 422 when HEAD matches)
    const REF_RETRIES = 3;
    for (let attempt = 0; attempt < REF_RETRIES; attempt++) {
      console.log("[GitHubProvider] Updating ref — sha:", newCommitSha, "attempt:", attempt + 1);
      const refRes = await this.api.rest(
        "PATCH",
        `/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`,
        this.token,
        { sha: newCommitSha, force: false },
      );
      console.log("[GitHubProvider] Ref update response — status:", refRes.status, "body:", JSON.stringify(refRes.json).slice(0, 200));

      if (refRes.status !== 422) {
        return { commitSha: newCommitSha, treeSha: newTreeSha };
      }

      console.log("[GitHubProvider] 422 on ref update — re-fetching HEAD to diagnose");
      const headRes = await this.api.rest(
        "GET",
        `/repos/${this.owner}/${this.repo}/branches/${this.branch}`,
        this.token,
      );

      if (headRes.status === 404) {
        console.log("[GitHubProvider] Branch not found — creating ref");
        await this.api.rest(
          "POST",
          `/repos/${this.owner}/${this.repo}/git/refs`,
          this.token,
          { ref: `refs/heads/${this.branch}`, sha: newCommitSha },
        );
        return { commitSha: newCommitSha, treeSha: newTreeSha };
      }

      const currentHead = (
        headRes.json as { commit: { sha: string } }
      ).commit.sha;
      console.log("[GitHubProvider] Current HEAD:", currentHead, "Expected:", headSha, "Match:", currentHead === headSha);

      if (currentHead !== headSha) {
        throw new PushConflictError();
      }

      // HEAD matches but ref update failed — transient GitHub API issue, retry
      if (attempt < REF_RETRIES - 1) {
        console.log("[GitHubProvider] Transient 422 — retrying ref update after delay");
        await sleep(1000 * (attempt + 1));
      }
    }

    throw new GitHubApiError(
      "Ref update failed after retries (HEAD unchanged, possible GitHub API issue)",
      422,
      `/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`,
    );
  }

  private async ensureRepository(): Promise<void> {
    const res = await this.api.rest(
      "GET",
      `/repos/${this.owner}/${this.repo}`,
      this.token,
    );

    if (res.status !== 404) return;

    if (!this.cachedUsername) {
      const userRes = await this.api.rest("GET", "/user", this.token);
      this.cachedUsername = (userRes.json as { login: string }).login;
    }

    const isOrg = this.owner.toLowerCase() !== this.cachedUsername.toLowerCase();
    const createUrl = isOrg
      ? `/orgs/${this.owner}/repos`
      : "/user/repos";

    console.log(
      `[GitHubProvider] Creating ${isOrg ? "org" : "user"} repository: ${this.owner}/${this.repo}`,
    );

    const createRes = await this.api.rest("POST", createUrl, this.token, {
      name: this.repo,
      private: true,
      auto_init: false,
    });

    // Race condition: repo was created between our 404 check and POST
    if (createRes.status === 422) {
      const retryRes = await this.api.rest(
        "GET",
        `/repos/${this.owner}/${this.repo}`,
        this.token,
      );
      if (retryRes.status === 404) {
        throw new GitHubApiError(
          `Failed to create repository ${this.owner}/${this.repo}`,
          422,
          createUrl,
        );
      }
      return;
    }

    console.log(
      `[GitHubProvider] Repository created: ${this.owner}/${this.repo}`,
    );
  }

  async bootstrap(): Promise<SyncCursor> {
    await this.ensureRepository();

    await this.api.rest(
      "PUT",
      `/repos/${this.owner}/${this.repo}/contents/.gitkeep`,
      this.token,
      { message: "Initialize repository", content: btoa(""), branch: this.branch },
    );

    // 422 means already exists -- that's fine
    // After bootstrap, get branch info for the cursor
    const branchRes = await this.api.rest(
      "GET",
      `/repos/${this.owner}/${this.repo}/branches/${this.branch}`,
      this.token,
    );

    if (branchRes.status === 404 || branchRes.status === 409) {
      return { commitSha: "", treeSha: "" };
    }

    const branchData = branchRes.json as {
      commit: { sha: string; commit: { tree: { sha: string } } };
    };

    return {
      commitSha: branchData.commit.sha,
      treeSha: branchData.commit.commit.tree.sha,
    };
  }

  async getBase(path: string, cursor: SyncCursor): Promise<string | null> {
    const ghCursor = cursor as GitHubCursor;
    const res = await this.api.rest(
      "GET",
      `/repos/${this.owner}/${this.repo}/contents/${encodeGitHubPath(path)}?ref=${ghCursor.commitSha}`,
      this.token,
      undefined,
      { Accept: "application/vnd.github.raw+json" },
    );

    if (res.status === 404) {
      return null;
    }

    const buffer = res.arrayBuffer;
    return new TextDecoder("utf-8").decode(buffer);
  }

  private buildBlobMap(tree: TreeEntry[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of tree) {
      if (entry.type !== "blob") continue;
      if (!isValidSyncPath(entry.path)) continue;
      // Don't filter dotfiles here — let core's isTrackedPath decide
      // what's tracked based on syncObsidianSettings
      map.set(entry.path, entry.sha);
    }
    return map;
  }

  private async downloadArchive(ref: string): Promise<Map<string, ArrayBuffer>> {
    const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024; // 500MB

    const arrayBuffer = await this.api.downloadZip(this.owner, this.repo, ref, this.token);
    const zip = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      unzip(new Uint8Array(arrayBuffer), (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    let totalSize = 0;
    for (const content of Object.values(zip)) {
      totalSize += content.length;
      if (totalSize > MAX_DECOMPRESSED_SIZE) {
        throw new Error("ZIP archive exceeds maximum decompressed size (500MB)");
      }
    }

    const files = new Map<string, ArrayBuffer>();

    for (const [zipPath, content] of Object.entries(zip)) {
      if (zipPath.endsWith("/")) continue;

      const firstSlash = zipPath.indexOf("/");
      if (firstSlash === -1) continue;
      const path = zipPath.slice(firstSlash + 1);

      if (!path) continue;
      if (!isValidSyncPath(path)) continue;

      files.set(path, content.buffer as ArrayBuffer);
    }

    return files;
  }

  private async fetchFullTree(
    localSnapshot: Record<string, SnapshotEntry>,
    headSha: string,
    treeSha: string,
    localPaths?: Set<string>,
  ): Promise<FetchResult> {
    const treeRes = await this.api.rest(
      "GET",
      `/repos/${this.owner}/${this.repo}/git/trees/${treeSha}?recursive=1`,
      this.token,
    );

    const treeData = treeRes.json as { tree: TreeEntry[]; truncated?: boolean };
    if (treeData.truncated) {
      console.warn("GitHub tree response was truncated — some files may be missed");
    }
    const blobs = this.buildBlobMap(treeData.tree);

    let archive: Map<string, ArrayBuffer>;
    try {
      archive = await this.downloadArchive(headSha);
      console.log(`[GitHubProvider] Archive downloaded — ${archive.size} files`);
    } catch (err) {
      console.warn("[GitHubProvider] Archive download failed, falling back to per-file fetch:", err);
      return this.fetchFullTreePerFile(localSnapshot, headSha, treeSha, localPaths, blobs);
    }

    const changeset: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: [],
    };

    for (const [path] of blobs) {
      const localEntry = localSnapshot[path];
      if (localEntry) continue;
      if (localPaths?.has(path)) continue;

      const content = archive.get(path);
      if (!content) continue;

      changeset.added.set(path, await classifyContent(content, Date.now()));
    }

    for (const path of Object.keys(localSnapshot)) {
      if (!blobs.has(path)) {
        changeset.deleted.push(path);
      }
    }

    return {
      changes: changeset,
      cursor: { commitSha: headSha, treeSha },
    };
  }

  private async fetchFullTreePerFile(
    localSnapshot: Record<string, SnapshotEntry>,
    headSha: string,
    treeSha: string,
    localPaths?: Set<string>,
    blobs?: Map<string, string>,
  ): Promise<FetchResult> {
    if (!blobs) {
      const treeRes = await this.api.rest(
        "GET",
        `/repos/${this.owner}/${this.repo}/git/trees/${treeSha}?recursive=1`,
        this.token,
      );
      const treeData = treeRes.json as { tree: TreeEntry[]; truncated?: boolean };
      if (treeData.truncated) {
        console.warn("GitHub tree response was truncated — some files may be missed");
      }
      blobs = this.buildBlobMap(treeData.tree);
    }

    const changeset: ChangeSet = {
      added: new Map(),
      modified: new Map(),
      deleted: [],
    };

    const fetchPaths: string[] = [];
    const skipPaths: string[] = [];
    for (const [path] of blobs) {
      const localEntry = localSnapshot[path];
      if (localEntry) continue;

      if (localPaths?.has(path)) {
        skipPaths.push(path);
      } else {
        fetchPaths.push(path);
      }
    }

    console.log(`[GitHubProvider] fetchFullTreePerFile — ${blobs.size} remote blobs, ${fetchPaths.length} to download, ${skipPaths.length} skipped (exist locally)`);

    const CONCURRENCY = 5;
    for (let i = 0; i < fetchPaths.length; i += CONCURRENCY) {
      const batch = fetchPaths.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (path) => ({
          path,
          state: await this.fetchFileContent(path, headSha),
        })),
      );
      for (const { path, state } of results) {
        changeset.added.set(path, state);
      }
    }

    for (const path of Object.keys(localSnapshot)) {
      if (!blobs.has(path)) {
        changeset.deleted.push(path);
      }
    }

    return {
      changes: changeset,
      cursor: { commitSha: headSha, treeSha },
    };
  }

  private async fetchFileContent(path: string, ref: string): Promise<FileState> {
    const res = await this.api.rest(
      "GET",
      `/repos/${this.owner}/${this.repo}/contents/${encodeGitHubPath(path)}?ref=${ref}`,
      this.token,
      undefined,
      { Accept: "application/vnd.github.raw+json" },
    );

    return classifyContent(res.arrayBuffer, Date.now());
  }
}
