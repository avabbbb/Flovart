// 配音、转写与对齐（docs/design/16-agent-video-pipeline.md C8 / C10 / C11）。
// - audio.tts：只读 speechText（口播稿），displayText 只进字幕；输出带实测时长与参数快照。
// - audio.transcribe：WhisperX / hypit CLI（用户自装）或 fixture 证据；统一产出 hypit.transcript@1。
// - timeline.align：脚本行 ↔ 词级证据，给出每行与每个动作词的毫秒时间。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CapabilityError, ffmpegBin, runTool } from './media.js';

export const HYPIT_TRANSCRIPT_FORMAT = 'hypit.transcript@1';

// ---------------- 分词（与 services/reverse/narrative.ts 的 normalizeToken 口径一致：小写、去标点；中日韩按字） ----------------
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;

export function normalizeToken(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function tokenize(text) {
  const tokens = [];
  for (const chunk of String(text).split(/\s+/u)) {
    let latin = '';
    for (const char of chunk) {
      if (CJK.test(char)) {
        if (normalizeToken(latin)) tokens.push(latin);
        latin = '';
        tokens.push(char);
      } else latin += char;
    }
    if (normalizeToken(latin)) tokens.push(latin);
  }
  return tokens.map(raw => ({ raw, normalized: normalizeToken(raw) })).filter(token => token.normalized);
}

// ---------------- TTS ----------------
const TTS_ROUTES = new Set(['fake', 'minimax', 'runninghub']);

export function ttsRoutes() {
  return [...TTS_ROUTES];
}

/** 粗估口播时长：中文约 4.2 字/秒，英文约 2.6 词/秒，按语速缩放。fake 路由用它生成确定性时长。 */
export function estimateSpeechMs(text, speed = 1) {
  const tokens = tokenize(text);
  const cjk = tokens.filter(token => CJK.test(token.raw)).length;
  const latin = tokens.length - cjk;
  return Math.max(600, Math.round(((cjk / 4.2 + latin / 2.6) * 1000 + 250) / (speed || 1)));
}

/** fake 路由：确定性的“干声”——按词交替的音调，词间留短停顿，足以测时长、探静音、混音与闪避。 */
async function fakeTts({ speechText, voice, outPath }) {
  const durationMs = estimateSpeechMs(speechText, voice.speed);
  const tokens = Math.max(1, tokenize(speechText).length);
  const base = 180 + ((String(voice.voiceId || 'fake').length * 37) % 120) + (voice.pitch || 0) * 10;
  // 每个 token 一个音节（响 70%、停 30%），用 sin 的正半周做门。
  const gate = `gt(sin(2*PI*${(tokens / (durationMs / 1000)).toFixed(4)}*t+0.3),-0.4)`;
  await runTool(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', `aevalsrc='0.35*${gate}*sin(2*PI*${base}*t)*(1+0.2*sin(2*PI*3*t))':s=24000:d=${(durationMs / 1000).toFixed(3)}`,
    '-ac', '1', '-c:a', 'pcm_s16le', outPath], { capability: 'ffmpeg' });
  return { costMicros: 0, providerRequestId: null };
}

/**
 * MiniMax speech（T2A v2）。Key 只从本机环境 / 密钥库进程注入，不进入 trace、artifact 元数据或日志。
 * 接口形状按 MiniMax 官方 t2a_v2 文档；真实计费与 429 行为需按 Support Matrix 做一次人工 trial。
 */
async function minimaxTts({ speechText, voice, outPath, signal }) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new CapabilityError('minimax-speech', '未配置 MiniMax API Key', '在 Flovart 设置里保存 MiniMax Key，或设置 MINIMAX_API_KEY');
  const baseUrl = (process.env.FLOVART_MINIMAX_BASE_URL || 'https://api.minimax.io').replace(/\/$/, '');
  const groupId = process.env.MINIMAX_GROUP_ID;
  const response = await fetch(`${baseUrl}/v1/t2a_v2${groupId ? `?GroupId=${encodeURIComponent(groupId)}` : ''}`, {
    method: 'POST',
    signal,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: voice.model || 'speech-2.8-hd',
      text: speechText,
      stream: false,
      voice_setting: { voice_id: voice.voiceId, speed: voice.speed ?? 1, vol: 1, pitch: voice.pitch ?? 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 429) throw Object.assign(new Error('MiniMax 限流（429）'), { code: 'PROVIDER_RATE_LIMITED', retryable: true });
  if (!response.ok || body?.base_resp?.status_code) {
    throw Object.assign(new Error(`MiniMax TTS 失败：${body?.base_resp?.status_msg || response.status}`), { code: 'PROVIDER_FAILED' });
  }
  const hex = body?.data?.audio;
  if (!hex) throw Object.assign(new Error('MiniMax 没有返回音频'), { code: 'PROVIDER_FAILED' });
  writeFileSync(outPath, Buffer.from(hex, 'hex'));
  const microsPerChar = Number(process.env.FLOVART_MINIMAX_MICROS_PER_CHAR || 0);
  return { costMicros: Math.round([...speechText].length * microsPerChar), providerRequestId: body?.trace_id || null };
}

const RUNNINGHUB_TTS_MODELS = new Set(['speech-2.8-turbo', 'speech-2.8-hd', 'speech-2.6-turbo', 'speech-2.6-hd', 'speech-02-turbo', 'speech-02-hd']);
const RUNNINGHUB_DONE = new Set(['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'FINISHED']);
const RUNNINGHUB_FAILED = new Set(['FAILED', 'FAIL', 'ERROR', 'CANCELLED', 'CANCELED']);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('已取消'), { code: 'CANCELLED' })); }, { once: true });
});

/** RunningHub 的金额字段（元）换成微单位；拿不到就记 0，由 trial 校对。 */
function runningHubCostMicros(usage) {
  const money = Number(usage?.consumeMoney ?? usage?.thirdPartyConsumeMoney);
  return Number.isFinite(money) && money > 0 ? Math.round(money * 1_000_000) : 0;
}

/**
 * RunningHub 标准模型 API 上的 MiniMax speech：提交拿 taskId，再轮询 /openapi/v2/query 取音频 URL。
 * Key 只从本机环境 / 密钥库进程注入（RUNNINGHUB_API_KEY），不进入 trace、artifact 元数据或日志。
 * 提交后网络中断时返回 PROVIDER_UNKNOWN_SUBMIT（带 taskId 时可查询），不自动重提。
 */
async function runningHubTts({ speechText, voice, outPath, signal, fetchImpl = fetch, pollMs = 1500, timeoutMs = 180_000 }) {
  const apiKey = process.env.RUNNINGHUB_API_KEY;
  if (!apiKey) throw new CapabilityError('runninghub-speech', '未配置 RunningHub API Key', '在 Flovart 设置里保存 RunningHub Key，或设置 RUNNINGHUB_API_KEY');
  const baseUrl = (process.env.FLOVART_RUNNINGHUB_BASE_URL || 'https://www.runninghub.cn').replace(/\/$/, '');
  const model = voice.model || 'speech-2.8-turbo';
  if (!RUNNINGHUB_TTS_MODELS.has(model)) throw Object.assign(new Error(`RunningHub 不支持的配音模型：${model}`), { code: 'INVALID_ARGUMENT' });
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const call = async (path, payload) => {
    const response = await fetchImpl(`${baseUrl}${path}`, { method: 'POST', signal, headers, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (response.status === 429) throw Object.assign(new Error('RunningHub 限流（429）'), { code: 'PROVIDER_RATE_LIMITED', retryable: true });
    if (response.status === 401 || response.status === 403) throw Object.assign(new Error('RunningHub Key 无效或无权限'), { code: 'PROVIDER_AUTH_FAILED' });
    if (!response.ok) throw Object.assign(new Error(`RunningHub 请求失败：${body?.errorMessage || body?.msg || response.status}`), { code: 'PROVIDER_FAILED' });
    return body;
  };
  const submitted = await call(`/openapi/v2/rhart-audio/text-to-audio/${model}`, {
    text: speechText,
    voice_id: voice.voiceId,
    speed: voice.speed ?? 1,
    volume: 1,
    pitch: voice.pitch ?? 0,
    ...(voice.emotion ? { emotion: voice.emotion } : {}),
    enable_base64_output: false,
    english_normalization: Boolean(voice.englishNormalization),
  });
  const taskId = submitted?.taskId;
  if (!taskId) throw Object.assign(new Error(`RunningHub 没有返回任务：${submitted?.errorMessage || submitted?.msg || '未知原因'}`), { code: 'PROVIDER_FAILED' });
  const deadline = Date.now() + timeoutMs;
  let state = submitted;
  for (;;) {
    const status = String(state?.status || '').toUpperCase();
    if (RUNNINGHUB_FAILED.has(status) || state?.errorCode) {
      throw Object.assign(new Error(`RunningHub 配音失败：${state?.errorMessage || state?.errorCode || status}`), { code: 'PROVIDER_FAILED', providerRequestId: taskId });
    }
    const audio = (state?.results || []).find(item => item?.url);
    if (RUNNINGHUB_DONE.has(status) && audio) {
      const download = await fetchImpl(audio.url, { signal });
      if (!download.ok) throw Object.assign(new Error(`RunningHub 音频下载失败：${download.status}`), { code: 'PROVIDER_FAILED', providerRequestId: taskId });
      writeFileSync(outPath, Buffer.from(await download.arrayBuffer()));
      return { costMicros: runningHubCostMicros(state.usage), providerRequestId: taskId };
    }
    if (RUNNINGHUB_DONE.has(status)) throw Object.assign(new Error('RunningHub 任务完成但没有音频'), { code: 'PROVIDER_FAILED', providerRequestId: taskId });
    if (Date.now() > deadline) throw Object.assign(new Error('RunningHub 配音超时，任务可能仍在进行'), { code: 'PROVIDER_UNKNOWN_SUBMIT', providerRequestId: taskId, retryable: false });
    await sleep(pollMs, signal);
    state = await call('/openapi/v2/query', { taskId });
  }
}

export async function synthesizeLine({ speechText, voice, outDir, signal, fetchImpl, pollMs }) {
  if (!TTS_ROUTES.has(voice.route)) throw Object.assign(new Error(`未知 TTS 路由：${voice.route}`), { code: 'INVALID_ARGUMENT' });
  const outPath = join(outDir, voice.route === 'fake' ? 'voice.wav' : 'voice.mp3');
  const result = voice.route === 'minimax'
    ? await minimaxTts({ speechText, voice, outPath, signal })
    : voice.route === 'runninghub'
      ? await runningHubTts({ speechText, voice, outPath, signal, ...(fetchImpl ? { fetchImpl } : {}), ...(pollMs != null ? { pollMs } : {}) })
      : await fakeTts({ speechText, voice, outPath });
  return { path: outPath, ...result };
}

// ---------------- 转写 ----------------
function wordsFromJson(raw) {
  const collect = value => {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.word_segments)) return value.word_segments;
    if (Array.isArray(value?.words)) return value.words;
    const segments = value?.segments ?? value?.passages;
    return Array.isArray(segments) ? segments.flatMap(segment => segment.words || []) : [];
  };
  return collect(raw).map(item => {
    const text = String(item.word ?? item.text ?? '').trim();
    const start = item.startMs ?? (Number.isFinite(item.start ?? item.start_seconds) ? Math.round((item.start ?? item.start_seconds) * 1000) : undefined);
    const end = item.endMs ?? (Number.isFinite(item.end ?? item.end_seconds) ? Math.round((item.end ?? item.end_seconds) * 1000) : undefined);
    return text ? { text, startMs: start, endMs: end, ...(Number.isFinite(item.score) ? { score: item.score } : {}) } : null;
  }).filter(Boolean);
}

export function toHypitTranscript(words, { language, source }) {
  return {
    format: HYPIT_TRANSCRIPT_FORMAT,
    ...(language ? { language } : {}),
    source,
    passages: [{
      words: words.map(word => ({
        text: word.text,
        ...(word.startMs === undefined ? {} : { start_seconds: word.startMs / 1000 }),
        ...(word.endMs === undefined ? {} : { end_seconds: word.endMs / 1000 }),
        ...(word.score === undefined ? {} : { score: word.score }),
      })),
    }],
  };
}

export function readEvidenceWords(path) {
  return wordsFromJson(JSON.parse(readFileSync(path, 'utf8')));
}

/** fixture 证据：已知口播稿 + 实测时长 → 按字长均分的词级时间。只用于测试与离线演示，source 明确标记 fixture。 */
export function fixtureWords(speechText, durationMs) {
  const tokens = tokenize(speechText);
  const lead = 120;
  const usable = Math.max(1, durationMs - lead * 2);
  const weights = tokens.map(token => Math.max(1, [...token.normalized].length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = lead;
  return tokens.map((token, index) => {
    const span = (usable * weights[index]) / total;
    const word = { text: token.raw, startMs: Math.round(cursor), endMs: Math.round(cursor + span * 0.85), score: 1 };
    cursor += span;
    return word;
  });
}

export async function transcribeFile({ path, engine, language, outDir, speechText, durationMs, signal }) {
  if (engine === 'fixture') {
    if (!speechText || !durationMs) {
      throw Object.assign(new Error('fixture 转写只适用于本 run 的 TTS 干声（需要 speechText 与实测时长）'), { code: 'INVALID_ARGUMENT' });
    }
    return { words: fixtureWords(speechText, durationMs), source: 'fixture', engineVersion: 'fixture-1' };
  }
  if (engine === 'whisperx') {
    const bin = process.env.FLOVART_WHISPERX || 'whisperx';
    await runTool(bin, [path, '--output_format', 'json', '--output_dir', outDir, ...(language ? ['--language', language] : [])],
      { capability: 'whisperx', signal, timeoutMs: 30 * 60 * 1000 });
    const file = readdirSync(outDir).find(name => name.endsWith('.json') && name.startsWith(basename(path).replace(/\.[^.]+$/, '')))
      || readdirSync(outDir).find(name => name.endsWith('.json'));
    if (!file) throw Object.assign(new Error('WhisperX 没有产出 JSON'), { code: 'LOCAL_TOOL_FAILED' });
    return { words: readEvidenceWords(join(outDir, file)), source: 'whisperx', engineVersion: process.env.FLOVART_WHISPERX_VERSION || 'whisperx' };
  }
  if (engine === 'hypit') {
    // 用户自装的 hypit CLI；命令模板可配置，{input} {output} {language} 占位。
    const template = process.env.FLOVART_HYPIT_TRANSCRIBE || 'hypit transcribe {input} --format json --output {output}';
    const output = join(outDir, 'transcript.json');
    const [bin, ...args] = template.split(/\s+/).map(part => part
      .replace('{input}', path).replace('{output}', output).replace('{language}', language || 'auto'));
    await runTool(bin, args, { capability: 'hypit', signal, timeoutMs: 30 * 60 * 1000 });
    return { words: readEvidenceWords(output), source: 'hypit.transcript', engineVersion: 'hypit' };
  }
  throw Object.assign(new Error(`未知转写引擎：${engine}`), { code: 'INVALID_ARGUMENT' });
}

// ---------------- 对齐 ----------------
/**
 * 单调对齐：脚本 token 序列 ↔ 证据词序列，LCS 动态规划（允许遗漏 / 插入 / 替换）。
 * 证据不是语义真相：只给脚本 token 定时，未命中的 token 在相邻实测之间按字长插值。
 */
export function alignTokens(scriptTokens, words) {
  const src = scriptTokens.map(token => token.normalized);
  // 证据词也按同一规则拆开（中文证据常是整句或多字一词）。
  const evidence = [];
  words.forEach((word, wordIndex) => {
    const parts = tokenize(word.text);
    const span = (word.endMs ?? word.startMs ?? 0) - (word.startMs ?? 0);
    parts.forEach((part, partIndex) => {
      const startMs = word.startMs === undefined ? undefined : Math.round(word.startMs + (span * partIndex) / parts.length);
      const endMs = word.startMs === undefined ? undefined : Math.round(word.startMs + (span * (partIndex + 1)) / parts.length);
      evidence.push({ normalized: part.normalized, startMs, endMs, wordIndex });
    });
  });
  const n = src.length;
  const m = evidence.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = src[i] === evidence[j].normalized ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const timings = new Array(n).fill(null);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (src[i] === evidence[j].normalized) {
      if (evidence[j].startMs !== undefined) timings[i] = { startMs: evidence[j].startMs, endMs: evidence[j].endMs, measured: true };
      i += 1; j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  const matched = timings.filter(Boolean).length;
  // 插值：缺测 token 落在前后实测之间，按字长分配。
  const lastEnd = evidence.reduce((max, item) => Math.max(max, item.endMs ?? 0), 0);
  let k = 0;
  while (k < n) {
    if (timings[k]) { k += 1; continue; }
    let end = k;
    while (end < n && !timings[end]) end += 1;
    const from = k > 0 ? timings[k - 1].endMs : 0;
    const to = end < n ? timings[end].startMs : Math.max(from, lastEnd);
    const weights = scriptTokens.slice(k, end).map(token => Math.max(1, [...token.normalized].length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = from;
    for (let index = k; index < end; index += 1) {
      const span = ((to - from) * weights[index - k]) / total;
      timings[index] = { startMs: Math.round(cursor), endMs: Math.round(cursor + span), measured: false };
      cursor += span;
    }
    k = end;
  }
  return { timings, matched, total: n };
}

/**
 * 每行：startMs/endMs（在该行音频自己的时钟上）+ offsetMs → 时间线时间；actions 是行内动作词（如“提问”“点开”）。
 */
export function alignLines(lines, segments) {
  const out = [];
  let matched = 0;
  let total = 0;
  for (const line of lines) {
    const segment = segments.find(item => item.lineId === line.id) || segments.find(item => !item.lineId);
    if (!segment) throw Object.assign(new Error(`行 ${line.id} 没有对应的转写证据`), { code: 'INVALID_ARGUMENT' });
    const tokens = tokenize(line.speechText);
    const { timings, matched: lineMatched } = alignTokens(tokens, segment.words);
    matched += lineMatched;
    total += tokens.length;
    const offset = segment.offsetMs || 0;
    const actions = (line.actions || []).map(action => {
      const actionTokens = tokenize(action).map(token => token.normalized);
      const index = tokens.findIndex((_, start) => actionTokens.every((token, offsetIndex) => tokens[start + offsetIndex]?.normalized === token));
      return index < 0
        ? { word: action, atMs: null, found: false }
        : { word: action, atMs: offset + timings[index].startMs, found: true, measured: timings[index].measured };
    });
    out.push({
      id: line.id,
      startMs: offset + (timings[0]?.startMs ?? 0),
      endMs: offset + (timings.at(-1)?.endMs ?? 0),
      voiceStartMs: offset,
      voiceEndMs: offset + (segment.durationMs ?? timings.at(-1)?.endMs ?? 0),
      matchedTokens: lineMatched,
      tokens: tokens.length,
      actions,
    });
  }
  return { lines: out, matchedRatio: total ? Math.round((matched / total) * 1000) / 1000 : 0 };
}
