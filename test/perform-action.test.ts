import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { performAction } from "../src/utils";

const ACTION_NAME = "GOOGLE_DRIVE_DOWNLOAD_FILE";
const ACTION_PARAMS = { fileId: "file-1" };
const JWT = "test-jwt";
const RESOURCE_URI = `actionkit://action/${ACTION_NAME}`;
const JSON_MEDIA_TYPE = "application/json; charset=utf-8";
const JSON_SUFFIX_MEDIA_TYPE = "application/vnd.api+json";
const TEXT_MEDIA_TYPE = "text/plain; charset=utf-8";
const PDF_MEDIA_TYPE = "application/pdf";
const PNG_MEDIA_TYPE = "image/png";
const DEFAULT_BINARY_MEDIA_TYPE = "application/octet-stream";
const TEXT_BODY = "On-call rotation...";
const JSON_BODY = { id: "file-1", name: "notes.json" };
const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const BASE64_ENCODING = "base64";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubActionResponse(body: BodyInit, contentType?: string): void {
  globalThis.fetch = async () => {
    const headers = new Headers();

    if (contentType) {
      headers.set("Content-Type", contentType);
    }

    return new Response(body, { status: 200, headers });
  };
}

test("performAction returns a JSON action body as text content", async () => {
  stubActionResponse(JSON.stringify(JSON_BODY), JSON_MEDIA_TYPE);

  const result = await performAction(ACTION_NAME, ACTION_PARAMS, JWT);

  assert.deepEqual(result, [
    { type: "text", text: JSON.stringify(JSON_BODY) },
  ]);
});

test("performAction returns a +json action body as text content", async () => {
  stubActionResponse(JSON.stringify(JSON_BODY), JSON_SUFFIX_MEDIA_TYPE);

  const result = await performAction(ACTION_NAME, ACTION_PARAMS, JWT);

  assert.deepEqual(result, [
    { type: "text", text: JSON.stringify(JSON_BODY) },
  ]);
});

test("performAction returns a text file as text content, unescaped", async () => {
  stubActionResponse(TEXT_BODY, TEXT_MEDIA_TYPE);

  const result = await performAction(ACTION_NAME, ACTION_PARAMS, JWT);

  assert.deepEqual(result, [{ type: "text", text: TEXT_BODY }]);
});

test("performAction returns an image file as image content", async () => {
  stubActionResponse(PNG_BYTES, PNG_MEDIA_TYPE);

  const result = await performAction(ACTION_NAME, ACTION_PARAMS, JWT);

  assert.deepEqual(result, [
    {
      type: "image",
      mimeType: PNG_MEDIA_TYPE,
      data: Buffer.from(PNG_BYTES).toString(BASE64_ENCODING),
    },
  ]);
});

test("performAction returns a non-image binary file as an embedded resource", async () => {
  stubActionResponse(PDF_BYTES, PDF_MEDIA_TYPE);

  const result = await performAction(ACTION_NAME, ACTION_PARAMS, JWT);

  assert.deepEqual(result, [
    {
      type: "resource",
      resource: {
        uri: RESOURCE_URI,
        mimeType: PDF_MEDIA_TYPE,
        blob: Buffer.from(PDF_BYTES).toString(BASE64_ENCODING),
      },
    },
  ]);
});

test("performAction defaults to octet-stream when there is no content type", async () => {
  stubActionResponse(PDF_BYTES);

  const result = await performAction(ACTION_NAME, ACTION_PARAMS, JWT);

  assert.deepEqual(result, [
    {
      type: "resource",
      resource: {
        uri: RESOURCE_URI,
        mimeType: DEFAULT_BINARY_MEDIA_TYPE,
        blob: Buffer.from(PDF_BYTES).toString(BASE64_ENCODING),
      },
    },
  ]);
});
