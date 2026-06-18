import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fitWorkflowMediaSize,
  ingestWorkflowMedia,
  inspectWorkflowMedia,
  useWorkflowMediaUrl,
  workflowMediaType,
} from '../components/workflow/media';
import { workflowMediaStorage } from '../components/workflow/storage';

describe('workflow media', () => {
  beforeEach(async () => {
    await workflowMediaStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['image/png', 'image'],
    ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'],
  ] as const)('accepts %s as %s', (mimeType, type) => {
    expect(workflowMediaType(new File(['media'], `asset.${type}`, { type: mimeType }))).toBe(type);
  });

  it('rejects unsupported files with a Chinese error', () => {
    expect(() => workflowMediaType(new File(['document'], 'notes.pdf', { type: 'application/pdf' })))
      .toThrow('仅支持图片、视频或音频文件');
  });

  it('inspects image natural dimensions and revokes its temporary URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    class TestImage {
      naturalWidth = 1600;
      naturalHeight = 900;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', TestImage);

    await expect(inspectWorkflowMedia(new File(['image'], 'wide.png', { type: 'image/png' })))
      .resolves.toEqual({ naturalWidth: 1600, naturalHeight: 900 });
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('inspects video dimensions and duration', async () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { value: 1920 },
      videoHeight: { value: 1080 },
      duration: { value: 12.5 },
    });
    vi.spyOn(document, 'createElement').mockReturnValue(video);
    vi.spyOn(video, 'load').mockImplementation(() => queueMicrotask(() => video.dispatchEvent(new Event('loadedmetadata'))));

    await expect(inspectWorkflowMedia(new File(['video'], 'clip.mp4', { type: 'video/mp4' })))
      .resolves.toEqual({ naturalWidth: 1920, naturalHeight: 1080, durationMs: 12500 });
  });

  it('fits image and video nodes to their original ratio and fixes audio height', () => {
    expect(fitWorkflowMediaSize('image', 1600, 900)).toEqual({ width: 420, height: 236 });
    expect(fitWorkflowMediaSize('video', 1080, 1920)).toEqual({ width: 180, height: 320 });
    expect(fitWorkflowMediaSize('audio')).toEqual({ width: 340, height: 120 });
  });

  it('persists the Blob under a durable storage key without embedding its contents', async () => {
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLMediaElement;
      if (tag === 'audio') {
        Object.defineProperty(element, 'duration', { value: 3 });
        vi.spyOn(element, 'load').mockImplementation(() => queueMicrotask(() => element.dispatchEvent(new Event('loadedmetadata'))));
      }
      return element;
    }) as typeof document.createElement);
    const file = new File(['sound'], 'voice.mp3', { type: 'audio/mpeg' });

    const record = await ingestWorkflowMedia(file);

    expect(record).toMatchObject({ type: 'audio', name: 'voice.mp3', mimeType: 'audio/mpeg', bytes: 5, durationMs: 3000 });
    expect(record.storageKey).toMatch(/^workflow-media-/);
    expect(await workflowMediaStorage.get(record.storageKey)).toBeInstanceOf(Blob);
    expect(JSON.stringify(record)).not.toContain('blob:');
    expect(JSON.stringify(record)).not.toContain('data:');
  });

  it('creates and revokes a render URL and resolves the same storage key after remount', async () => {
    const key = 'workflow-media-reload';
    await workflowMediaStorage.set(key, new Blob(['persisted'], { type: 'image/png' }));
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const first = renderHook(() => useWorkflowMediaUrl(key));
    await waitFor(() => expect(first.result.current.url).toMatch(/^blob:/));
    const firstUrl = first.result.current.url;
    first.unmount();
    expect(revoke).toHaveBeenCalledWith(firstUrl);

    const second = renderHook(() => useWorkflowMediaUrl(key));
    await waitFor(() => expect(second.result.current.url).toMatch(/^blob:/));
    expect(second.result.current.url).not.toBe(firstUrl);
    act(() => second.unmount());
  });

  it('reports a missing durable media file instead of using a fallback href', async () => {
    const { result } = renderHook(() => useWorkflowMediaUrl('missing-key', 'https://example.com/fallback.png'));
    await waitFor(() => expect(result.current.error).toBe('媒体文件不存在，请重新选择文件'));
    expect(result.current.url).toBeNull();
  });
});
