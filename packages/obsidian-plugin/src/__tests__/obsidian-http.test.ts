import { describe, it, expect, beforeEach, vi } from "vitest";
import { requestUrl } from "obsidian";
import { ObsidianHttpClient } from "../obsidian-http";

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
  return {
    ...actual,
    requestUrl: vi.fn(),
  };
});

describe("ObsidianHttpClient", () => {
  let client: ObsidianHttpClient;

  beforeEach(() => {
    client = new ObsidianHttpClient();
    vi.clearAllMocks();
  });

  it("should make request with correct URL, method, headers, and body", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      headers: {},
      json: null,
      text: "",
      arrayBuffer: new ArrayBuffer(0),
    });

    await client.request({
      url: "https://api.github.com/repos",
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: '{"key":"value"}',
    });

    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://api.github.com/repos",
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: '{"key":"value"}',
      throw: false,
    });
  });

  it("should return status, headers, json, text, and arrayBuffer", async () => {
    const buf = new ArrayBuffer(4);
    vi.mocked(requestUrl).mockResolvedValue({
      status: 201,
      headers: { "content-type": "application/json" },
      json: { id: 1 },
      text: '{"id":1}',
      arrayBuffer: buf,
    });

    const response = await client.request({
      url: "https://api.github.com/repos",
    });

    expect(response.status).toBe(201);
    expect(response.headers).toEqual({ "content-type": "application/json" });
    expect(response.json).toEqual({ id: 1 });
    expect(response.text).toBe('{"id":1}');
    expect(response.arrayBuffer).toBe(buf);
  });

  it("should return json: null when response json throws", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      headers: {},
      get json(): unknown {
        throw new Error("not JSON");
      },
      text: "raw content",
      arrayBuffer: new ArrayBuffer(0),
    });

    const response = await client.request({
      url: "https://api.github.com/contents/file.bin",
    });

    expect(response.json).toBeNull();
    expect(response.text).toBe("raw content");
  });

  it("should pass throw: false to requestUrl", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 404,
      headers: {},
      json: { message: "Not Found" },
      text: '{"message":"Not Found"}',
      arrayBuffer: new ArrayBuffer(0),
    });

    await client.request({ url: "https://api.github.com/missing" });

    expect(vi.mocked(requestUrl).mock.calls[0]![0]).toHaveProperty(
      "throw",
      false,
    );
  });
});
