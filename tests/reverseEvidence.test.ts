import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HYPIT_TRANSCRIPT_FORMAT,
  evidenceEndMs,
  isHypitTranscript,
  measuredWordCount,
  parseHypitTranscript,
  parseTranscriptJson,
  toAlignedEvidence,
} from '../services/reverse/evidence';
import { parseTranscriptJson as legacyParse } from '../services/reverse/transcript';

const hypitDoc = {
  format: HYPIT_TRANSCRIPT_FORMAT,
  source: 'whisperx-large-v3',
  language: 'en',
  audio_seconds: 2.5,
  passages: [
    {
      text: 'Tired of waiting',
      start_seconds: 0.1,
      end_seconds: 1.2,
      words: [
        { text: 'Tired', start_seconds: 0.1, end_seconds: 0.4, score: 0.9 },
        { text: 'of' },
        { text: 'waiting', start_seconds: 0.7, end_seconds: 1.2 },
      ],
    },
    { text: 'Try Brew', words: [{ text: 'Try', start_seconds: 1.5, end_seconds: 1.7 }, { text: 'Brew', start_seconds: 1.8, end_seconds: 2.4 }] },
  ],
};

describe('reverse evidence', () => {
  it('imports hypit.transcript@1 and keeps missing times missing', () => {
    expect(isHypitTranscript(hypitDoc)).toBe(true);
    const t = parseHypitTranscript(hypitDoc, 'now')!;
    expect(t).toMatchObject({ source: 'hypit.transcript', language: 'en', importedAt: 'now' });
    expect(t.words.map((w) => w.text)).toEqual(['Tired', 'of', 'waiting', 'Try', 'Brew']);
    expect(t.words[0]).toEqual({ text: 'Tired', startMs: 100, endMs: 400, score: 0.9 });
    expect(t.words[1]).toEqual({ text: 'of' });
    expect(parseTranscriptJson(hypitDoc, 'now')).toEqual(t);
  });

  it('rejects non-hypit input on the strict entry', () => {
    expect(parseHypitTranscript({ segments: [] })).toBeNull();
    expect(parseHypitTranscript({ format: 'hypit.transcript@2', passages: [] })).toBeNull();
  });

  it('still imports WhisperX JSON and plain arrays', () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/reverse/whisperx.sample.json'), 'utf8'));
    const w = parseTranscriptJson(fixture, 'now')!;
    expect(w.source).toBe('whisperx');
    expect(w.words[0]).toMatchObject({ text: 'Tired', startMs: 120, endMs: 410 });
    expect(parseTranscriptJson([{ text: 'a', startMs: 5, endMs: 9 }], 'now')).toEqual({ source: 'manual', words: [{ text: 'a', startMs: 5, endMs: 9 }], importedAt: 'now' });
    expect(parseTranscriptJson([], 'now')).toBeNull();
  });

  it('keeps transcript.ts as a behavior-identical compat entry', () => {
    expect(legacyParse).toBe(parseTranscriptJson);
  });

  it('binds evidence to a local domain', () => {
    const e = toAlignedEvidence(parseHypitTranscript(hypitDoc, 'now')!, 'ref-audio');
    expect(e).toMatchObject({ domainId: 'ref-audio', language: 'en', source: 'hypit.transcript' });
    expect(measuredWordCount(e)).toBe(4);
    expect(evidenceEndMs(e)).toBe(2400);
    expect(evidenceEndMs({ words: [{ text: 'z' }] })).toBeUndefined();
  });
});
