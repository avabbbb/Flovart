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
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
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
