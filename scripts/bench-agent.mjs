#!/usr/bin/env node
// Agent 可靠性基准：用真实的浏览器内核（pi-agent-core 循环 + createBrowserAgentStream）
// 对 OpenAI 兼容端点跑多轮会话，记录每次 LLM 调用的延迟 p50/p95、可见首字延迟（TTFT）、
// 失败分类、重试次数与 prompt cache 命中（DeepSeek prompt_cache_hit_tokens / OpenAI cached_tokens）。
//
//   node scripts/bench-agent.mjs --mode mock --sessions 40 --label after
//   node scripts/bench-agent.mjs --mode real --sessions 4 --label real-after   # 需要 RUNNINGHUB_API_KEY 或 BENCH_API_KEY
//
// mock 模式：本地确定性 OpenAI 兼容服务（固定种子），注入延迟与故障（503 / 断连 / 卡住不出字），
// 并按 DeepSeek 规则（64 token 块、按请求前缀）模拟前缀缓存，用来衡量请求结构是否「稳定前缀」。
// mock 数字只反映本仓库代码的开销与容错行为，不代表真实模型延迟。
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : 'true']);
  return pairs;
}, []));
const mode = args.mode || 'mock';
const sessions = Number(args.sessions || (mode === 'real' ? 4 : 40));
const concurrency = mode === 'real' ? 1 : Number(args.concurrency || 8);
const label = args.label || mode;
const seed = Number(args.seed || 7);
const failRates = { http503: Number(args['fail-503'] ?? 0.04), reset: Number(args['fail-reset'] ?? 0.04), stall: Number(args['fail-stall'] ?? 0.04) };
const outDir = path.join(root, '.tmp', 'bench');
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// mock OpenAI-compatible server
// ---------------------------------------------------------------------------
function prng(s) { return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const seen = [];
function commonPrefix(a, b) { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++; return i; }
const CHARS_PER_TOKEN = 3;
function startMock() {
  const rand = prng(seed);
  const stalled = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', async () => {
      const body = JSON.parse(raw || '{}');
      const roll = rand();
      // 故障注入（确定性）：先判断，保证同一种子下 baseline / after 遇到同样的故障序列。
      if (roll < failRates.http503) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":{"message":"upstream overloaded"}}'); return; }
      if (roll < failRates.http503 + failRates.reset) { req.socket.destroy(); return; }
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      await sleep(250 + Math.floor(rand() * 250));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (roll < failRates.http503 + failRates.reset + failRates.stall) { stalled.add(res); res.write(': keep-alive\n\n'); return; }
      // prefix cache: tools + messages 序列化，按 64 token 块计算与历史请求的最长公共前缀
      const prefix = JSON.stringify(body.tools || []) + (body.messages || []).map(m => JSON.stringify(m)).join('\n');
      let best = 0; for (const prev of seen) best = Math.max(best, commonPrefix(prev, prefix));
      seen.push(prefix); if (seen.length > 400) seen.shift();
      const promptTokens = Math.ceil(prefix.length / CHARS_PER_TOKEN);
      const cached = Math.floor(best / CHARS_PER_TOKEN / 64) * 64;
      const usage = { prompt_tokens: promptTokens, completion_tokens: 60, total_tokens: promptTokens + 60, prompt_cache_hit_tokens: cached, prompt_cache_miss_tokens: promptTokens - cached, prompt_tokens_details: { cached_tokens: cached } };
      const messages = body.messages || [];
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const lastUserIndex = messages.lastIndexOf(lastUser);
      const toolSinceUser = messages.slice(lastUserIndex).some(m => m.role === 'tool');
      const userText = typeof lastUser?.content === 'string' ? lastUser.content : (lastUser?.content || []).map(p => p.text || '').join('');
      const inspect = (body.tools || []).find(t => t.function?.name?.includes('workflow_inspect'))?.function?.name;
      const send = obj => res.write('data: ' + JSON.stringify(obj) + '\n\n');
      if (!toolSinceUser && inspect && userText.includes('画布')) {
        await sleep(40);
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_' + Math.floor(rand() * 1e9), type: 'function', function: { name: inspect, arguments: '' } }] } }] });
        await sleep(20);
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage });
        res.end('data: [DONE]\n\n');
        return;
      }
      const sentences = ['画布上有一张主视觉和一个待生成的视频镜头。', '主视觉已经完成，色调是青橙。', '建议先给镜头 1 补一句运动描述。', '然后用主视觉作为首帧生成视频。', '需要的话我可以直接帮你连好。', '你想先做哪一步？'];
      for (const sentence of sentences) {
        for (const piece of sentence.match(/.{1,4}/gu)) { send({ choices: [{ index: 0, delta: { content: piece } }] }); await sleep(15); }
      }
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/v1', stalled })));
}

// ---------------------------------------------------------------------------
// bundle the real kernel for Node
// ---------------------------------------------------------------------------
const bundle = path.join(outDir, 'agent-bench-entry.mjs');
await build({
  entryPoints: [path.join(root, 'scripts/bench/agent-bench-entry.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: bundle, logLevel: 'error',
  alias: { localforage: path.join(root, 'scripts/bench/localforage-shim.ts') },
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  loader: { '.md': 'text' },
  define: { 'import.meta.env': '{}' },
  plugins: [{
    // Vite 的 ?raw 导入：按文本读入
    name: 'vite-raw',
    setup(b) {
      b.onResolve({ filter: /\?raw$/ }, a => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
      b.onLoad({ filter: /.*/, namespace: 'raw' }, a => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }));
    },
  }],
});
const entry = await import(pathToFileURL(bundle).href + '?t=' + Date.now());
entry.installFetchProbe();

let route; let mock;
if (mode === 'real') {
  const apiKey = process.env.BENCH_API_KEY || process.env.RUNNINGHUB_API_KEY;
  if (!apiKey) throw new Error('real 模式需要 BENCH_API_KEY 或 RUNNINGHUB_API_KEY');
  route = { provider: args.provider || 'openai-compatible', baseUrl: args['base-url'] || 'https://llm.runninghub.cn/v1', model: args.model || 'deepseek/deepseek-v4.1-flash', apiKey, streamUsage: 'request' };
} else {
  mock = await startMock();
  route = { provider: 'openai-compatible', baseUrl: mock.url, model: 'mock-model', apiKey: 'mock' };
}
// 流式卡住检测（修复后生效）：mock 下按比例缩短，避免基准跑很久；real 用生产默认值。
if (mode === 'mock') route.timeouts = { firstChunkMs: 3_000, idleMs: 3_000 };
const turnTimeoutMs = Number(args['turn-timeout-ms'] || (mode === 'mock' ? 20_000 : 120_000));
const prompts = [
  '先看看画布上有什么，然后用两三句话告诉我下一步建议。',
  '好的，把主视觉的提示词改得更有电影感，只回答建议的新提示词，不要调用工具。',
  '一句话总结我们刚才的对话。',
];

const calls = []; const results = [];
const queue = Array.from({ length: sessions }, (_, i) => i);
const steerEvery = Number(args['steer-every'] || 4);
async function worker() {
  while (queue.length) {
    const session = queue.shift();
    const steerText = steerEvery > 0 && session % steerEvery === 0 ? '另外，最后再补一句英文。' : undefined;
    const result = await entry.runSession({ session, route: mode === 'mock' ? { ...route, apiKey: 'mock-' + session } : route, prompts, steerText, turnTimeoutMs, onCall: record => calls.push(record) });
    results.push(result);
    process.stderr.write(result.ok ? '.' : 'x');
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
process.stderr.write('\n');
if (mock) { for (const res of mock.stalled) res.destroy(); mock.server.close(); }

const pct = (values, p) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]); };
const attempts = calls.flatMap(call => call.attempts);
const okCalls = calls.filter(call => call.stopReason !== 'error' && call.stopReason !== 'aborted');
const withUsage = attempts.filter(a => a.promptTokens);
const promptTokens = withUsage.reduce((s, a) => s + a.promptTokens, 0);
const cachedTokens = withUsage.reduce((s, a) => s + (a.cachedTokens || 0), 0);
// 同一会话第 2 次及以后的调用：理论上前缀都可命中
const failures = {};
for (const r of results) if (!r.ok) failures[r.failure] = (failures[r.failure] || 0) + 1;
const steer = results.filter(r => r.steered);
const summary = {
  label, mode, model: route.model, sessions, concurrency, seed, failRates: mode === 'mock' ? failRates : null,
  wallMs: Date.now() - started,
  sessionSuccessRate: +(results.filter(r => r.ok).length / results.length).toFixed(3),
  failures,
  llmCalls: calls.length,
  llmCallErrorRate: +((calls.length - okCalls.length) / Math.max(1, calls.length)).toFixed(3),
  retriedCalls: calls.filter(c => c.attempts.length > 1).length,
  latencyMs: { p50: pct(okCalls.map(c => c.totalMs), 50), p95: pct(okCalls.map(c => c.totalMs), 95) },
  visibleTtftMs: { p50: pct(okCalls.map(c => c.visibleTtftMs), 50), p95: pct(okCalls.map(c => c.visibleTtftMs), 95) },
  wireTtftMs: { p50: pct(okCalls.map(c => c.wireTtftMs).filter(v => v != null), 50), p95: pct(okCalls.map(c => c.wireTtftMs).filter(v => v != null), 95) },
  callsWithStreamedDeltas: +(okCalls.filter(c => c.streamedDeltas > 0).length / Math.max(1, okCalls.length)).toFixed(3),
  // 文字回复（stop）里边生成边显示的比例；只发工具调用的那步本来就没有可显示的增量。
  textRepliesStreamed: +(okCalls.filter(c => c.stopReason === 'stop' && c.streamedDeltas > 0).length / Math.max(1, okCalls.filter(c => c.stopReason === 'stop').length)).toFixed(3),
  textReplyVisibleTtftMs: { p50: pct(okCalls.filter(c => c.stopReason === 'stop').map(c => c.visibleTtftMs), 50), p95: pct(okCalls.filter(c => c.stopReason === 'stop').map(c => c.visibleTtftMs), 95) },
  turnLatencyMs: { p50: pct(results.flatMap(r => r.turnMs), 50), p95: pct(results.flatMap(r => r.turnMs), 95) },
  cache: { attemptsWithUsage: withUsage.length, promptTokens, cachedTokens, hitRate: promptTokens ? +(cachedTokens / promptTokens).toFixed(3) : null, avgPromptTokens: withUsage.length ? Math.round(promptTokens / withUsage.length) : null },
  steering: steer.length ? Object.fromEntries(['accepted', 'unsupported', 'lost'].map(k => [k, steer.filter(r => r.steered === k && (k !== 'accepted' || r.ok)).length])) : null,
};
fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify({ summary, calls, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
