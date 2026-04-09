// Abstract filesystem interface (platform-agnostic)
export interface FileEntry {
  readonly path: string;
  readonly mtime: number;
  readonly size: number;
}

export interface FileSystem {
  list(): Promise<FileEntry[]>;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeText(path: string, content: string): Promise<void>;
  writeBinary(path: string, content: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

// HTTP abstraction (platform-agnostic)
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
}

export interface HttpClient {
  request(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
  }): Promise<HttpResponse>;
}

// Snapshot entry — tracks file hash and local mtime
export interface SnapshotEntry {
  readonly hash: string;
  readonly mtime: number;
}

// File state — result of reading a file from the vault
export type FileState =
  | { type: "text"; content: string }
  | { type: "binary"; hash: string; modified: number; data: ArrayBuffer };

// Change set — delta between snapshot and current state (local or remote)
export interface ChangeSet {
  added: Map<string, FileState>;
  modified: Map<string, FileState>;
  deleted: string[];
}

// File mutation — reconciliation output: what to do with each file
export interface FileMutation {
  path: string;
  disk: "write" | "delete" | "skip";
  remote: "write" | "delete" | "skip";
  content?: string;
  binaryContent?: ArrayBuffer;
  source?: "local" | "remote" | "merged";
  hash?: string;
  modified?: number;
}

// Push payload — what gets sent to the provider
export interface PushPayload {
  files: Map<string, string | ArrayBuffer>;
  deletions: string[];
}

// Provider type discriminator
export type ProviderType = "github" | "s3";

// S3 service presets
export type S3Service = "aws" | "cloudflare-r2" | "minio" | "backblaze-b2" | "custom";

// Plugin settings (single repo per vault)
export interface SyncSettings {
  provider: ProviderType;
  // GitHub
  githubRepo: string;
  branch: string;
  commitMessage: string;
  // S3
  s3Service: S3Service;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string;
  s3Prefix: string;
  s3ForcePathStyle: boolean;
  // Shared
  autoSync: boolean;
  pollIntervalMs: number;
  debounceMs: number;
  syncObsidianSettings: boolean;
  ignorePatterns: string[];
  includePaths: string[];
  binaryConflict: "local" | "remote" | "newest";
  fullScanInterval: number;
}

// Sync result — returned after each sync cycle
export interface SyncResult {
  readonly status: "success" | "error" | "no-changes";
  readonly mutations: FileMutation[];
  readonly error?: Error;
}

// Sync state (for UI)
export type SyncState = "idle" | "debouncing" | "syncing" | "error";

// Provider interface (opaque cursor model)
export type SyncCursor = unknown;

export interface FetchResult {
  changes: ChangeSet;
  cursor: SyncCursor;
}

export interface Provider {
  fetch(cursor?: SyncCursor, localPaths?: Set<string>): Promise<FetchResult>;
  push(payload: PushPayload, cursor?: SyncCursor): Promise<SyncCursor>;
  bootstrap(): Promise<SyncCursor>;
  getBase?(path: string, cursor: SyncCursor): Promise<string | null>;
}

// Plugin data — persisted via plugin.saveData() (data.json)
export interface PluginData {
  readonly version?: number;
  snapshot: Record<string, SnapshotEntry>;
  lastSyncTime: number;
  syncCount: number;
  cursor: SyncCursor;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  provider: "github",
  // GitHub
  githubRepo: "",
  branch: "main",
  commitMessage: "vault: sync",
  // S3
  s3Service: "aws",
  s3Bucket: "",
  s3Region: "",
  s3Endpoint: "",
  s3Prefix: "",
  s3ForcePathStyle: true,
  // Shared
  autoSync: true,
  pollIntervalMs: 300000,
  debounceMs: 30000,
  syncObsidianSettings: false,
  ignorePatterns: [],
  includePaths: [],
  binaryConflict: "newest",
  fullScanInterval: 50,
};

// Provider errors
export class ProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

export class PushConflictError extends ProviderError {
  constructor(message = "Push conflict: HEAD has moved") {
    super("PUSH_CONFLICT", message);
    this.name = "PushConflictError";
  }
}
