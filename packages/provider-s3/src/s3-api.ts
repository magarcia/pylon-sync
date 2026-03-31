import { AwsV4Signer } from "aws4fetch";
import type { HttpClient, HttpResponse } from "@pylon-sync/core";
import type { S3Config } from "./types";
import type { S3ListResult } from "./xml";
import { parseListObjectsV2, parseS3Error } from "./xml";

export class S3ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "S3ApiError";
    this.code = code;
    this.status = status;
  }
}

export class S3Api {
  constructor(
    private readonly http: HttpClient,
    private readonly config: S3Config,
  ) {}

  private buildUrl(key?: string): string {
    const { endpoint, bucket, forcePathStyle } = this.config;
    if (forcePathStyle !== false) {
      const base = `${endpoint}/${bucket}`;
      return key ? `${base}/${key}` : base;
    }
    const url = endpoint.replace("://", `://${bucket}.`);
    return key ? `${url}/${key}` : url;
  }

  private async sign(
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: string | ArrayBuffer,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const signer = new AwsV4Signer({
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
      service: "s3",
      method,
      url,
      headers: headers ? new Headers(headers) : undefined,
      body,
    });
    const signed = await signer.sign();
    const signedHeaders: Record<string, string> = {};
    signed.headers.forEach((v, k) => {
      signedHeaders[k] = v;
    });
    return { url: signed.url.toString(), headers: signedHeaders };
  }

  private async request(
    method: string,
    key: string | undefined,
    opts?: {
      headers?: Record<string, string>;
      body?: string | ArrayBuffer;
      query?: Record<string, string>;
    },
  ): Promise<HttpResponse> {
    let url = this.buildUrl(key);
    if (opts?.query) {
      const params = new URLSearchParams(opts.query);
      url += (url.includes("?") ? "&" : "?") + params.toString();
    }
    const signed = await this.sign(method, url, opts?.headers, opts?.body);
    const response = await this.http.request({
      url: signed.url,
      method,
      headers: signed.headers,
      body: opts?.body,
    });
    if (response.status >= 400) {
      const error = parseS3Error(response.text);
      throw new S3ApiError(
        error?.code ?? "UnknownError",
        error?.message ?? `S3 error: ${response.status}`,
        response.status,
      );
    }
    return response;
  }

  async listObjects(
    prefix?: string,
    continuationToken?: string,
  ): Promise<S3ListResult> {
    const query: Record<string, string> = { "list-type": "2" };
    if (prefix) query["prefix"] = prefix;
    if (continuationToken) query["continuation-token"] = continuationToken;
    const response = await this.request("GET", undefined, { query });
    return parseListObjectsV2(response.text);
  }

  async getObject(key: string): Promise<ArrayBuffer> {
    const response = await this.request("GET", key);
    return response.arrayBuffer;
  }

  async putObject(
    key: string,
    body: string | ArrayBuffer,
    contentType?: string,
  ): Promise<string> {
    const headers: Record<string, string> = {};
    if (contentType) headers["content-type"] = contentType;
    const response = await this.request("PUT", key, { headers, body });
    const etag = response.headers["etag"] ?? "";
    return etag.replace(/"/g, "");
  }

  async deleteObject(key: string): Promise<void> {
    await this.request("DELETE", key);
  }

  async deleteObjects(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const xmlObjects = keys
      .map((k) => `<Object><Key>${k}</Key></Object>`)
      .join("");
    const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${xmlObjects}</Delete>`;
    await this.request("POST", undefined, {
      query: { delete: "" },
      headers: { "content-type": "application/xml" },
      body,
    });
  }

  async headBucket(): Promise<boolean> {
    try {
      await this.request("HEAD", undefined);
      return true;
    } catch (err) {
      if (err instanceof S3ApiError && err.status === 404) return false;
      throw err;
    }
  }
}
