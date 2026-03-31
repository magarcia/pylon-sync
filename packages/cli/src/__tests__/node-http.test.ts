import { NodeHttpClient } from "../node-http";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createMockResponse(options: {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}): Response {
  const { status = 200, body = "", headers = {} } = options;
  const responseHeaders = new Headers(headers);
  const encoder = new TextEncoder();
  const buffer = encoder.encode(body).buffer;

  return {
    status,
    headers: responseHeaders,
    arrayBuffer: () => Promise.resolve(buffer),
  } as unknown as Response;
}

let client: NodeHttpClient;

beforeEach(() => {
  client = new NodeHttpClient();
  mockFetch.mockReset();
});

describe("NodeHttpClient", () => {
  it("should make GET request and return parsed JSON response", async () => {
    const payload = { data: [1, 2, 3] };
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        status: 200,
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await client.request({ url: "https://api.example.com/data" });

    expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/data", {
      method: "GET",
      headers: undefined,
      body: undefined,
    });
    expect(result.status).toBe(200);
    expect(result.json).toEqual(payload);
    expect(result.text).toBe(JSON.stringify(payload));
  });

  it("should make POST request with body", async () => {
    const requestBody = JSON.stringify({ name: "test" });
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ status: 201, body: '{"id": 1}' }),
    );

    const result = await client.request({
      url: "https://api.example.com/create",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });
    expect(result.status).toBe(201);
    expect(result.json).toEqual({ id: 1 });
  });

  it("should handle non-JSON responses by returning json as null", async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ status: 200, body: "plain text response" }),
    );

    const result = await client.request({ url: "https://example.com/text" });

    expect(result.json).toBeNull();
    expect(result.text).toBe("plain text response");
  });

  it("should collect response headers", async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        status: 200,
        body: "{}",
        headers: {
          "x-ratelimit-remaining": "59",
          "content-type": "application/json",
        },
      }),
    );

    const result = await client.request({ url: "https://api.example.com" });

    expect(result.headers["x-ratelimit-remaining"]).toBe("59");
    expect(result.headers["content-type"]).toBe("application/json");
  });

  it("should return arrayBuffer in the response", async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ status: 200, body: "hello" }),
    );

    const result = await client.request({ url: "https://example.com" });

    expect(result.arrayBuffer).toBeInstanceOf(ArrayBuffer);
  });
});
