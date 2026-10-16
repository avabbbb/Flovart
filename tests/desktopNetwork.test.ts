import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

import {
  fetchRemoteMediaBlob,
  openRemoteMediaUrl,
  shouldUseDesktopNativeFetch,
} from '../services/desktopNetwork';

function framedPayload(mimeType: string, body: number[]) {
  const mime = new TextEncoder().encode(mimeType);
  const payload = new Uint8Array(4 + mime.length + body.length);
  new DataView(payload.buffer).setUint32(0, mime.length, true);
  payload.set(mime, 4);
  payload.set(body, 4 + mime.length);
  return payload.buffer;
}

describe('desktopNetwork', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.isTauri.mockReset();
    mocks.isTauri.mockReturnValue(true);
  });

  it('uses raw Tauri IPC for HTTPS media in the desktop app', async () => {
    mocks.invoke.mockResolvedValueOnce(framedPayload('video/mp4', [1, 2, 3]));

    const blob = await fetchRemoteMediaBlob('https://cdn.example.com/result.mp4');

    expect(mocks.invoke).toHaveBeenCalledWith('desktop_fetch_remote_media', {
      url: 'https://cdn.example.com/result.mp4',
    });
    expect(blob.type).toBe('video/mp4');
    const body = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    expect([...body]).toEqual([1, 2, 3]);
  });

  it('does not route blob/data URLs through the native remote downloader', () => {
    expect(shouldUseDesktopNativeFetch('blob:https://example.com/id')).toBe(false);
    expect(shouldUseDesktopNativeFetch('data:image/png;base64,AA==')).toBe(false);
    expect(shouldUseDesktopNativeFetch('https://example.com/file.png')).toBe(true);
  });

  it('opens HTTPS fallback URLs through the desktop opener command', async () => {
    mocks.invoke.mockResolvedValueOnce(undefined);

    await openRemoteMediaUrl('https://cdn.example.com/result.mp4');

    expect(mocks.invoke).toHaveBeenCalledWith('desktop_open_remote_url', {
      url: 'https://cdn.example.com/result.mp4',
    });
  });

  it('rejects malformed native media frames', async () => {
    mocks.invoke.mockResolvedValueOnce(new Uint8Array([1, 2]).buffer);

    await expect(fetchRemoteMediaBlob('https://cdn.example.com/result.mp4'))
      .rejects.toThrow('桌面媒体响应无效');
  });
});

import { describe as describeCors, expect as expectCors, it as itCors, vi as viCors } from 'vitest';
import { fetchRemoteMediaBlob as fetchRemoteMediaBlobForCors, RemoteMediaFetchError as RemoteMediaFetchErrorForCors } from '../services/desktopNetwork';

describeCors('fetchRemoteMediaBlob - web CORS', () => {
    itCors('normalizes a browser CORS rejection into a readable error that keeps the remote url', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = viCors.fn(async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
        try {
            const error = await fetchRemoteMediaBlobForCors('http://cdn.example.com/out.mp4').catch((e: unknown) => e);
            expectCors(error).toBeInstanceOf(RemoteMediaFetchErrorForCors);
            expectCors((error as InstanceType<typeof RemoteMediaFetchErrorForCors>).corsBlocked).toBe(true);
            expectCors((error as Error).message).toContain('http://cdn.example.com/out.mp4');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    itCors('keeps the HTTP status for non-ok responses', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = viCors.fn(async () => new Response('nope', { status: 403 })) as typeof fetch;
        try {
            const error = await fetchRemoteMediaBlobForCors('http://cdn.example.com/out.png').catch((e: unknown) => e);
            expectCors(error).toBeInstanceOf(RemoteMediaFetchErrorForCors);
            expectCors((error as InstanceType<typeof RemoteMediaFetchErrorForCors>).corsBlocked).toBe(false);
            expectCors((error as InstanceType<typeof RemoteMediaFetchErrorForCors>).status).toBe(403);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

import { saveBlob as saveBlobForDesktop } from '../services/desktopNetwork';

describeCors('saveBlob - desktop', () => {
    itCors('writes through the native save dialog and appends a missing extension', async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.invoke.mockReset();
        mocks.invoke.mockResolvedValueOnce('C:/Users/me/Downloads/result 1.png');
        const saved = await saveBlobForDesktop(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), '结果 1');
        expectCors(saved).toBe(true);
        expectCors(mocks.invoke).toHaveBeenCalledWith('desktop_save_file', new Uint8Array([1, 2, 3]), {
            headers: { 'x-iris-file-name': encodeURIComponent('结果 1.png') },
        });
    });

    itCors('reports a cancelled dialog as not saved', async () => {
        mocks.isTauri.mockReturnValue(true);
        mocks.invoke.mockReset();
        mocks.invoke.mockResolvedValueOnce(null);
        expectCors(await saveBlobForDesktop(new Blob(['{}'], { type: 'application/json' }), 'config.json')).toBe(false);
    });
});
