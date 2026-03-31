import { describe, it, expect, beforeEach } from "vitest";
import { MockFileSystem } from "./mock-fs";
import { applyMutations } from "../applier";
import type { FileMutation } from "../types";

let fs: MockFileSystem;

beforeEach(() => {
  fs = new MockFileSystem();
});

describe("applyMutations", () => {
  it("should create new files for disk='write' when file doesn't exist", async () => {
    const mutations: FileMutation[] = [
      {
        path: "notes/new-file.md",
        disk: "write",
        remote: "skip",
        content: "hello world",
      },
    ];

    await applyMutations(fs, mutations);

    expect(fs.getContent("notes/new-file.md")).toBe("hello world");
  });

  it("should modify existing files for disk='write' when file exists", async () => {
    fs.seed({ "notes/existing.md": "old content" });

    const mutations: FileMutation[] = [
      {
        path: "notes/existing.md",
        disk: "write",
        remote: "skip",
        content: "updated content",
      },
    ];

    await applyMutations(fs, mutations);

    expect(fs.getContent("notes/existing.md")).toBe("updated content");
  });

  it("should delete files for disk='delete'", async () => {
    fs.seed({ "notes/to-delete.md": "some content" });

    const mutations: FileMutation[] = [
      {
        path: "notes/to-delete.md",
        disk: "delete",
        remote: "skip",
      },
    ];

    await applyMutations(fs, mutations);

    expect(await fs.exists("notes/to-delete.md")).toBe(false);
  });

  it("should skip files for disk='skip' (no changes to filesystem)", async () => {
    fs.seed({ "notes/unchanged.md": "original" });

    const mutations: FileMutation[] = [
      {
        path: "notes/unchanged.md",
        disk: "skip",
        remote: "write",
        content: "this should not be applied locally",
      },
    ];

    await applyMutations(fs, mutations);

    expect(fs.getContent("notes/unchanged.md")).toBe("original");
  });

  it("should process deletes before writes (to avoid path conflicts)", async () => {
    fs.seed({ "notes/conflict.md": "old version" });

    const mutations: FileMutation[] = [
      {
        path: "notes/conflict.md",
        disk: "write",
        remote: "skip",
        content: "new version",
      },
      {
        path: "notes/conflict.md",
        disk: "delete",
        remote: "skip",
      },
    ];

    await applyMutations(fs, mutations);

    expect(fs.getContent("notes/conflict.md")).toBe("new version");
  });

  it("should handle binary content writes", async () => {
    const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

    const mutations: FileMutation[] = [
      {
        path: "images/photo.png",
        disk: "write",
        remote: "skip",
        binaryContent: binaryData,
      },
    ];

    await applyMutations(fs, mutations);

    const result = fs.getContent("images/photo.png") as ArrayBuffer;
    expect(new Uint8Array(result)).toEqual(new Uint8Array(binaryData));
  });

  it("should handle binary content modification of existing files", async () => {
    const oldBinary = new Uint8Array([0x00]).buffer;
    fs.seed({ "images/photo.png": oldBinary });

    const newBinary = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const mutations: FileMutation[] = [
      {
        path: "images/photo.png",
        disk: "write",
        remote: "skip",
        binaryContent: newBinary,
      },
    ];

    await applyMutations(fs, mutations);

    const result = fs.getContent("images/photo.png") as ArrayBuffer;
    expect(new Uint8Array(result)).toEqual(new Uint8Array(newBinary));
  });

  it("should handle empty mutations array (no-op)", async () => {
    fs.seed({ "notes/untouched.md": "still here" });

    await applyMutations(fs, []);

    expect(fs.getContent("notes/untouched.md")).toBe("still here");
  });

  it("should handle text content via writeText when file is new", async () => {
    const mutations: FileMutation[] = [
      {
        path: "docs/readme.md",
        disk: "write",
        remote: "skip",
        content: "# README\n\nWelcome",
      },
    ];

    await applyMutations(fs, mutations);

    expect(await fs.exists("docs/readme.md")).toBe(true);
    expect(fs.getContent("docs/readme.md")).toBe("# README\n\nWelcome");
  });

  it("should only process disk-side mutations (ignore remote field)", async () => {
    fs.seed({ "notes/local-only.md": "local content" });

    const mutations: FileMutation[] = [
      {
        path: "notes/local-only.md",
        disk: "skip",
        remote: "write",
        content: "should push to remote but not touch disk",
      },
      {
        path: "notes/remote-delete.md",
        disk: "skip",
        remote: "delete",
      },
    ];

    await applyMutations(fs, mutations);

    expect(fs.getContent("notes/local-only.md")).toBe("local content");
    expect(await fs.exists("notes/remote-delete.md")).toBe(false);
  });

  it("should silently skip deletes for files that don't exist", async () => {
    const mutations: FileMutation[] = [
      {
        path: "notes/nonexistent.md",
        disk: "delete",
        remote: "skip",
      },
    ];

    await applyMutations(fs, mutations);
  });
});
