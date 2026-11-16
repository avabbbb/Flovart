// Judge model providers.
//
// `openai-compatible` speaks the Chat Completions shape any compatible gateway
// exposes; the key comes from FLOVART_JUDGE_API_KEY and is never written to
// evidence. `replay` answers from a JSONL file of recorded outputs, so tests,
// CI and re-grading after a parser change never spend money.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export const DEFAULT_TEMPERATURE = 0.1;

export function providerFromEnv(env = process.env) {
  const kind = env.FLOVART_JUDGE_PROVIDER ?? 'openai-compatible';
  return {
    kind,
    baseUrl: (env.FLOVART_JUDGE_BASE_URL ?? '').replace(/\/+$/, ''),
    apiKey: env.FLOVART_JUDGE_API_KEY ?? '',
    model: env.FLOVART_JUDGE_MODEL ?? '',
    replayFile: env.FLOVART_JUDGE_REPLAY ?? '',
    temperature: Number(env.FLOVART_JUDGE_TEMPERATURE ?? DEFAULT_TEMPERATURE),
  };
}

/** Build user content: text plus optional frames (data: or https: URLs) for multimodal judges. */
export function buildUserContent(text, images = []) {
  if (!images.length) return text;
  return [{ type: 'text', text }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))];
}

export function createProvider(config, { fetchImpl = globalThis.fetch } = {}) {
  if (config.kind === 'replay') return createReplayProvider(config.replayFile);
  if (config.kind !== 'openai-compatible') throw new Error(`unknown judge provider ${config.kind}`);
  if (!config.baseUrl || !config.model) {
    throw new Error('judge provider needs FLOVART_JUDGE_BASE_URL and FLOVART_JUDGE_MODEL (or FLOVART_JUDGE_PROVIDER=replay)');
  }
  return {
    id: `${config.kind}:${config.model}`,
    async complete({ system, user, images = [], temperature = config.temperature, seed }) {
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          temperature,
          ...(seed === undefined ? {} : { seed }),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: buildUserContent(user, images) },
          ],
        }),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`judge HTTP ${response.status}: ${raw.slice(0, 300)}`);
      const json = JSON.parse(raw);
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        usage: json.usage ?? null,
      };
    },
  };
}

/**
 * Replay provider. Each line: {"key": "<sampleId>[#<variant>]", "text": "<raw judge output>"}.
 * A missing key is an error, never a silent pass.
 */
export function createReplayProvider(file) {
  let table;
  return {
    id: `replay:${basename(String(file))}`,
    async complete({ key }) {
      if (!table) {
        table = new Map();
        const raw = await readFile(file, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const row = JSON.parse(line);
          table.set(row.key, row.text);
        }
      }
      if (!table.has(key)) throw new Error(`replay has no output for ${key}`);
      const text = table.get(key);
      return { text: typeof text === 'string' ? text : JSON.stringify(text), usage: null };
    },
  };
}
