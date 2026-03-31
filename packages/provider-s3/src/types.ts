export interface S3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly prefix?: string;
  readonly forcePathStyle?: boolean;
}

export interface S3Cursor {
  readonly snapshot: Record<string, S3ObjectMeta>;
  readonly manifestEtag?: string;
}

export interface S3ObjectMeta {
  readonly etag: string;
  readonly size: number;
}
