import { describe, it, expect } from "vitest";
import { parseListObjectsV2, parseS3Error } from "../xml";

describe("parseListObjectsV2", () => {
  it("extracts objects with key, etag, and size", () => {
    const xml = `
      <ListBucketResult>
        <Contents>
          <Key>notes/hello.md</Key>
          <ETag>"abc123"</ETag>
          <Size>1024</Size>
        </Contents>
        <Contents>
          <Key>notes/world.md</Key>
          <ETag>"def456"</ETag>
          <Size>2048</Size>
        </Contents>
        <IsTruncated>false</IsTruncated>
      </ListBucketResult>
    `;
    const result = parseListObjectsV2(xml);

    expect(result.objects).toEqual([
      { key: "notes/hello.md", etag: "abc123", size: 1024 },
      { key: "notes/world.md", etag: "def456", size: 2048 },
    ]);
    expect(result.isTruncated).toBe(false);
    expect(result.nextToken).toBeUndefined();
  });

  it("handles pagination with isTruncated and nextToken", () => {
    const xml = `
      <ListBucketResult>
        <Contents>
          <Key>file1.md</Key>
          <ETag>"aaa"</ETag>
          <Size>100</Size>
        </Contents>
        <IsTruncated>true</IsTruncated>
        <NextContinuationToken>token-abc-123</NextContinuationToken>
      </ListBucketResult>
    `;
    const result = parseListObjectsV2(xml);

    expect(result.objects).toHaveLength(1);
    expect(result.isTruncated).toBe(true);
    expect(result.nextToken).toBe("token-abc-123");
  });

  it("handles empty response with no Contents elements", () => {
    const xml = `
      <ListBucketResult>
        <IsTruncated>false</IsTruncated>
      </ListBucketResult>
    `;
    const result = parseListObjectsV2(xml);

    expect(result.objects).toEqual([]);
    expect(result.isTruncated).toBe(false);
    expect(result.nextToken).toBeUndefined();
  });

  it("strips quotes from ETags", () => {
    const xml = `
      <ListBucketResult>
        <Contents>
          <Key>test.md</Key>
          <ETag>"quoted-etag"</ETag>
          <Size>50</Size>
        </Contents>
        <IsTruncated>false</IsTruncated>
      </ListBucketResult>
    `;
    const result = parseListObjectsV2(xml);

    expect(result.objects[0]!.etag).toBe("quoted-etag");
  });

  it("skips Contents blocks with missing fields", () => {
    const xml = `
      <ListBucketResult>
        <Contents>
          <Key>valid.md</Key>
          <ETag>"etag1"</ETag>
          <Size>100</Size>
        </Contents>
        <Contents>
          <Key>missing-size.md</Key>
          <ETag>"etag2"</ETag>
        </Contents>
        <IsTruncated>false</IsTruncated>
      </ListBucketResult>
    `;
    const result = parseListObjectsV2(xml);

    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]!.key).toBe("valid.md");
  });
});

describe("parseS3Error", () => {
  it("extracts code and message from error XML", () => {
    const xml = `
      <Error>
        <Code>NoSuchBucket</Code>
        <Message>The specified bucket does not exist</Message>
      </Error>
    `;
    const result = parseS3Error(xml);

    expect(result).toEqual({
      code: "NoSuchBucket",
      message: "The specified bucket does not exist",
    });
  });

  it("returns null for non-error XML", () => {
    const xml = `
      <ListBucketResult>
        <IsTruncated>false</IsTruncated>
      </ListBucketResult>
    `;
    const result = parseS3Error(xml);

    expect(result).toBeNull();
  });

  it("returns null when only Code is present without Message", () => {
    const xml = `<Error><Code>SomeCode</Code></Error>`;
    const result = parseS3Error(xml);

    expect(result).toBeNull();
  });
});
