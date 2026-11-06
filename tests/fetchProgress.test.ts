import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBodyWithProgress, requestWithUpload } from '../services/fetchProgress';

const UPLOAD_PATH = '/api/media/upload';

function streamResponse(chunks: string[], headers: Record<string, string>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, { headers });
}

type ProgressEventLike = { loaded: number; total: number; lengthComputable: boolean };

class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress: ((event: ProgressEventLike) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  status = 0;
  statusText = '';
  response: unknown = null;
  responseType = '';
  timeout = 0;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  aborted = false;

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  getAllResponseHeaders() {
    return 'content-type: application/json\r\nx-request-id: abc\r\n';
  }

  send(body: unknown) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

describe('readBodyWithProgress', () => {
  it('reports loaded bytes against Content-Length', async () => {
    const onProgress = vi.fn();
    const blob = await readBodyWithProgress(streamResponse(['abc', 'de'], { 'Content-Length': '5', 'Content-Type': 'video/mp4' }), onProgress);
    expect(onProgress.mock.calls).toEqual([[3, 5], [5, 5]]);
    expect(blob.size).toBe(5);
    expect(blob.type).toBe('video/mp4');
  });

  it('leaves total undefined without Content-Length or for compressed bodies', async () => {
    const missing = vi.fn();
    await readBodyWithProgress(streamResponse(['abc', 'de'], {}), missing);
    expect(missing.mock.calls).toEqual([[3, undefined], [5, undefined]]);

    const compressed = vi.fn();
    await readBodyWithProgress(streamResponse(['abcd'], { 'Content-Length': '2', 'Content-Encoding': 'gzip' }), compressed);
    expect(compressed.mock.calls).toEqual([[4, undefined]]);
  });
});

describe('requestWithUpload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports upload bytes and resolves a fetch-compatible Response', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const onUploadProgress = vi.fn();
    const pending = requestWithUpload(UPLOAD_PATH, { method: 'POST', headers: { Authorization: 'Bearer key' }, body: 'payload', timeoutMs: 30_000 }, onUploadProgress);
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(UPLOAD_PATH);
    expect(xhr.headers.authorization).toBe('Bearer key');
    expect(xhr.timeout).toBe(30_000);
    expect(xhr.body).toBe('payload');
    xhr.upload.onprogress?.({ loaded: 4, total: 10, lengthComputable: true });
    xhr.upload.onprogress?.({ loaded: 7, total: 0, lengthComputable: false });
    xhr.status = 201;
    xhr.statusText = 'Created';
    xhr.onload?.();
    const response = await pending;
    expect(onUploadProgress.mock.calls).toEqual([[4, 10], [7, undefined]]);
    expect(response.ok).toBe(true);
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-request-id')).toBe('abc');
  });

  it('rejects with AbortError when the signal aborts', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const controller = new AbortController();
    const pending = requestWithUpload(UPLOAD_PATH, { method: 'POST', body: 'payload', signal: controller.signal }, vi.fn());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last.aborted).toBe(true);
  });

  it('rejects with TimeoutError when the request times out', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const pending = requestWithUpload(UPLOAD_PATH, { method: 'POST', body: 'payload', timeoutMs: 10 }, vi.fn());
    FakeXhr.last.ontimeout?.();
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('parses an arraybuffer XHR response as JSON', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const pending = requestWithUpload(UPLOAD_PATH, { method: 'POST', body: 'payload' }, vi.fn());
    const xhr = FakeXhr.last;
    expect(xhr.responseType).toBe('arraybuffer');
    xhr.status = 200;
    xhr.response = new TextEncoder().encode(JSON.stringify({ fileId: 'uploaded-1' })).buffer;
    xhr.onload?.();
    await expect((await pending).json()).resolves.toEqual({ fileId: 'uploaded-1' });
  });

  it('uses fetch when no progress callback is given', async () => {
    const xhrCtor = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhrCtor);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const response = await requestWithUpload(UPLOAD_PATH, { method: 'POST', headers: { Authorization: 'Bearer key' }, body: 'payload', signal: controller.signal, timeoutMs: 30_000 });
    expect(xhrCtor).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(UPLOAD_PATH);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBe('payload');
    expect(calledInit.signal).toBeInstanceOf(AbortSignal);
    await expect(response.json()).resolves.toEqual({ ok: 1 });
  });
});
