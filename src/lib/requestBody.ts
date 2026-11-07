// Reading a request's body with a hard cap, so a huge upload (or one sent in chunks, with no Content-Length) can't
// fill the server's memory: request.json(), .formData() and .arrayBuffer() read everything before a route can check
// its size. A declared Content-Length over the cap is refused before anything is read; otherwise reading stops, and
// the connection is let go, as soon as the cap is passed. No imports, so tests run it directly.

export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body is over ${maxBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

// The body as bytes; throws BodyTooLargeError past maxBytes
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes);
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// The body parsed as JSON, typed like request.json(); throws BodyTooLargeError past maxBytes, or a SyntaxError when it
// isn't JSON
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonLimited(request: Request, maxBytes: number): Promise<any> {
  return JSON.parse((await readBodyLimited(request, maxBytes)).toString('utf8'));
}

// The body as text; throws BodyTooLargeError past maxBytes
export async function readTextLimited(request: Request, maxBytes: number): Promise<string> {
  return (await readBodyLimited(request, maxBytes)).toString('utf8');
}

// A multipart (or urlencoded) body as FormData; throws BodyTooLargeError past maxBytes, or a TypeError when it isn't
// form data
export async function readFormDataLimited(request: Request, maxBytes: number): Promise<FormData> {
  const body = await readBodyLimited(request, maxBytes);
  const contentType = request.headers.get('content-type') ?? '';
  return new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData();
}

// Caps for request bodies: the public forms' JSON is small; the collector's are bigger
export const JSON_BODY_LIMIT = 64 * 1024;
