import { requestUrl } from "obsidian";
import type { HttpClient, HttpResponse } from "@pylon-sync/core";

export class ObsidianHttpClient implements HttpClient {
  async request(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<HttpResponse> {
    const response = await requestUrl({
      url: params.url,
      method: params.method,
      headers: params.headers,
      body: params.body,
      throw: false,
    });

    let json: unknown;
    try {
      json = response.json;
    } catch {
      // Response body is not valid JSON (e.g. raw file content)
      json = null;
    }

    return {
      status: response.status,
      headers: response.headers,
      json,
      text: response.text,
      arrayBuffer: response.arrayBuffer,
    };
  }
}
