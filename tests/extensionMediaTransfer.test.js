// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { transferMedia } from '../extension/background/media-transfer.js';
import { CHUNK_BYTES } from '../extension/background/import-protocol.js';

const HTTPS = 'https' + '://';
const IMAGE_URL = HTTPS + 'img.test/a.png';

function fakePeer({ receivedBytes = 0, nextSequence = 0 } = {}) {
  const messages = [];
  const send = async message => {
    messages.push(message);
    if (message.type === 'import.begin') return { transferId: 't1', receivedBytes, nextSequence };
    if (message.type === 'import.chunk') return { nextSequence: message.sequence + 1 };
    return { destinationProjectId: 'p1' };
  };
  return { messages, send };
}

const media = bytes => ({ bytes, name: 'a.png', mimeType: 'image/png', width: 1, height: 1 });
const source = { kind: 'image', sourceUrl: IMAGE_URL + '?token=x', pageUrl: HTTPS + 'page.test/', title: 'T' };

describe('transferMedia', () => {
  it('sends begin, ordered chunks, then commit', async () => {
    const bytes = new Uint8Array(CHUNK_BYTES * 2 + 10).fill(7);
    const peer = fakePeer();
    const progress = [];
    const receipt = await transferMedia(peer.send, media(bytes), source, async percent => {
      progress.push(percent);
    });
    expect(receipt).toEqual({ destinationProjectId: 'p1' });
    expect(peer.messages.map(message => message.type)).toEqual([
      'import.begin',
      'import.chunk',
      'import.chunk',
      'import.chunk',
      'import.commit',
    ]);
    expect(peer.messages[0].payload.sourceUrl).toBe(IMAGE_URL);
    expect(peer.messages[0].payload.byteSize).toBe(bytes.length);
    expect(peer.messages.slice(1, 4).map(message => message.sequence)).toEqual([0, 1, 2]);
    expect(progress.at(-1)).toBe(100);
  });

  it('resumes from the offset the peer already received', async () => {
    const bytes = new Uint8Array(CHUNK_BYTES * 3).fill(1);
    const peer = fakePeer({ receivedBytes: CHUNK_BYTES, nextSequence: 1 });
    await transferMedia(peer.send, media(bytes), source);
    const chunks = peer.messages.filter(message => message.type === 'import.chunk');
    expect(chunks.map(message => message.sequence)).toEqual([1, 2]);
  });

  it('rejects a resume offset beyond the media size', async () => {
    const peer = fakePeer({ receivedBytes: 99 });
    await expect(transferMedia(peer.send, media(new Uint8Array(10)), source)).rejects.toThrow('续传偏移');
  });
});
