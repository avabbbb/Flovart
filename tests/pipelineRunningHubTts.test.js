import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { synthesizeLine, ttsRoutes } from '../tools/flovart/pipeline/voice.js';

let dir;
const saved = { key: process.env.RUNNINGHUB_API_KEY, base: process.env.FLOVART_RUNNINGHUB_BASE_URL };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rh-tts-'));
  process.env.RUNNINGHUB_API_KEY = 'test-key';
  process.env.FLOVART_RUNNINGHUB_BASE_URL = 'https://rh.test/';
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [k, env] of [['key', 'RUNNINGHUB_API_KEY'], ['base', 'FLOVART_RUNNINGHUB_BASE_URL']]) {
    if (saved[k] === undefined) delete process.env[env]; else process.env[env] = saved[k];
  }
});

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.authorization });
    const next = script.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return typeof next === 'function' ? next(url, init) : next;
  };
  return { impl, calls };
}
const voice = { route: 'runninghub', voiceId: 'Elegant_Man', speed: 1.1, model: 'speech-2.8-turbo' };

describe('RunningHub TTS route', () => {
  it('is listed as a TTS route', () => {
    expect(ttsRoutes()).toContain('runninghub');
  });

  it('submits, polls, downloads the audio and records the task id and cost', async () => {
    const { impl, calls } = fakeFetch([
      json({ taskId: '42', status: 'RUNNING', results: null }),
      json({ taskId: '42', status: 'RUNNING', results: null }),
      json({ taskId: '42', status: 'SUCCESS', results: [{ url: 'https://cdn.rh.test/a.mp3', outputType: 'mp3' }], usage: { consumeMoney: 0.012 } }),
      { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
    ]);
    const result = await synthesizeLine({ speechText: '做完 App', voice, outDir: dir, fetchImpl: impl, pollMs: 0 });
    expect(result).toMatchObject({ providerRequestId: '42', costMicros: 12000 });
    expect(result.path.endsWith('voice.mp3')).toBe(true);
    expect([...readFileSync(result.path)]).toEqual([1, 2, 3]);
    expect(calls[0].url).toBe('https://rh.test/openapi/v2/rhart-audio/text-to-audio/speech-2.8-turbo');
    expect(calls[0].body).toMatchObject({ text: '做完 App', voice_id: 'Elegant_Man', speed: 1.1, enable_base64_output: false });
    expect(calls[0].auth).toBe('Bearer test-key');
    expect(calls[1]).toMatchObject({ url: 'https://rh.test/openapi/v2/query', body: { taskId: '42' } });
  });

  it('maps failures, rate limits and a missing key to stable codes', async () => {
    await expect(synthesizeLine({ speechText: 'x', voice, outDir: dir, fetchImpl: fakeFetch([json({}, 429)]).impl, pollMs: 0 }))
      .rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    await expect(synthesizeLine({ speechText: 'x', voice, outDir: dir, fetchImpl: fakeFetch([json({ taskId: '7', status: 'FAILED', errorMessage: 'bad voice' })]).impl, pollMs: 0 }))
      .rejects.toMatchObject({ code: 'PROVIDER_FAILED', providerRequestId: '7' });
    await expect(synthesizeLine({ speechText: 'x', voice: { ...voice, model: 'nope' }, outDir: dir, fetchImpl: fakeFetch([]).impl }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    delete process.env.RUNNINGHUB_API_KEY;
    await expect(synthesizeLine({ speechText: 'x', voice, outDir: dir, fetchImpl: fakeFetch([]).impl }))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  });
});
