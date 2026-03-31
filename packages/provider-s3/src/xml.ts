export interface S3ListObject {
  readonly key: string;
  readonly etag: string;
  readonly size: number;
}

export interface S3ListResult {
  readonly objects: S3ListObject[];
  readonly isTruncated: boolean;
  readonly nextToken?: string;
}

export function parseListObjectsV2(xml: string): S3ListResult {
  const objects: S3ListObject[] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;
  while ((match = contentsRegex.exec(xml)) !== null) {
    const block = match[1]!;
    const key = extractTag(block, "Key");
    const etag = extractTag(block, "ETag");
    const size = extractTag(block, "Size");
    if (key && etag && size) {
      objects.push({
        key,
        etag: etag.replace(/"/g, ""),
        size: parseInt(size, 10),
      });
    }
  }
  const isTruncated = extractTag(xml, "IsTruncated") === "true";
  const nextToken = extractTag(xml, "NextContinuationToken") ?? undefined;
  return { objects, isTruncated, nextToken };
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1] ?? null;
}

export function parseS3Error(
  xml: string,
): { code: string; message: string } | null {
  const code = extractTag(xml, "Code");
  const message = extractTag(xml, "Message");
  if (code && message) return { code, message };
  return null;
}
