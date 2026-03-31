import type { HttpClient, HttpResponse } from "@pylon-sync/core";

export class NodeHttpClient implements HttpClient {
  async request(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<HttpResponse> {
    const response = await fetch(params.url, {
      method: params.method ?? "GET",
      headers: params.headers,
      body: params.body,
    });

    const arrayBuffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return { status: response.status, headers, json, text, arrayBuffer };
  }
}
