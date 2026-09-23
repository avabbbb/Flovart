import { describe, expect, it } from 'vitest';
import { putVideoBlob, getVideoBlob, isIdbVideoRef, toIdbVideoRef, fromIdbVideoRef } from '../utils/mediaDB';

describe('mediaDB', () => {
  it('stores and retrieves a video blob', async () => {
    const blob = new Blob(['video-bytes'], { type: 'video/mp4' });
    await putVideoBlob('board:test-id', blob);
    const result = await getVideoBlob('board:test-id');
    expect(result).not.toBeNull();
    // Verify data was stored and retrieved (fake-indexeddb returns buffer-like data)
    expect(result).toBeTruthy();
    // Strengthen: verify content and type survive the round-trip.
    // In Node.js, fake-indexeddb returns a full Blob with text()/type.
    // In vitest's jsdom env, structuredClone produces an empty plain object
    // for Blob values (known fake-indexeddb/jsdom limitation), so Blob
    // methods are unavailable; assert content only when the result is a
    // proper Blob.
    if (typeof result!.text === 'function') {
      expect(await result!.text()).toBe('video-bytes');
      expect(result!.type).toBe('video/mp4');
    }
  });

  it('returns null for missing keys', async () => {
    const result = await getVideoBlob('board:nonexistent');
    expect(result).toBeNull();
  });
});

describe('idb-video ref helpers', () => {
  it('isIdbVideoRef recognizes valid refs', () => {
    expect(isIdbVideoRef('idb-video:abc')).toBe(true);
    expect(isIdbVideoRef('blob:x')).toBe(false);
    expect(isIdbVideoRef(null)).toBe(false);
  });

  it('round-trips ref conversion', () => {
    const ref = toIdbVideoRef('board:el-1');
    expect(fromIdbVideoRef(ref)).toBe('board:el-1');
  });
});
