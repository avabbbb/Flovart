import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const IMAGE_FIXTURE = join(ROOT, '..', 'public', 'favicon.png');
const VIDEO_FIXTURE = join(ROOT, '..', 'tests', 'fixtures', 'fake-provider-video.mp4');
const DEFAULT_MODELS = [
  { id: 'gpt-image-2', name: 'GPT Image 2', categoryName: 'image' },
  { id: 'grok-imagine-video', name: 'Grok Imagine Video', categoryName: 'video' },
];
const VALID_MODES = new Set(['success', 'slow', 'timeout', 'unauthorized', 'rate_limit', 'invalid_request', 'provider_error', 'polling_timeout', 'malformed_response']);

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': typeof body === 'string' ? 'application/json; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error('request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(buffer) {
  if (!buffer.length) return null;
  try { return JSON.parse(buffer.toString('utf8')); } catch { return null; }
}

function redactHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    /authorization|api[-_]?key|token|secret/i.test(key) ? '[redacted]' : String(value),
  ]));
}

function requestSummary(req, body) {
  const json = parseJson(body);
  const text = body.toString('utf8');
  const references = Array.isArray(json?.images) ? json.images : Array.isArray(json?.input_images) ? json.input_images : [];
  const multipartReferenceCount = (text.match(/name="image"/g) || []).length;
  return {
    method: req.method,
    path: new URL(req.url, 'http://127.0.0.1').pathname,
    headers: redactHeaders(req.headers),
    bodyBytes: body.length,
    model: typeof json?.model === 'string' ? json.model : undefined,
    prompt: typeof json?.prompt === 'string' ? json.prompt : undefined,
    referenceCount: references.length || multipartReferenceCount,
    referenceRoles: Array.isArray(json?.reference_roles) ? json.reference_roles.map(String).slice(0, 16) : [],
    hasMask: /name="mask"/.test(text) || typeof json?.mask === 'string',
    bodyType: json ? 'json' : req.headers['content-type']?.split(';')[0] || 'unknown',
  };
}

function errorForMode(mode) {
  if (mode === 'unauthorized') return [401, { error: { message: 'invalid api key' } }];
  if (mode === 'rate_limit') return [429, { error: { message: 'rate limit exceeded' } }];
  if (mode === 'invalid_request') return [400, { error: { message: 'invalid request fixture' } }];
  if (mode === 'provider_error') return [500, { error: { message: 'provider error fixture' } }];
  return null;
}

export function createFakeProviderServer(options = {}) {
  let mode = VALID_MODES.has(options.mode) ? options.mode : 'success';
  const models = options.models || DEFAULT_MODELS;
  const slowDelayMs = options.slowDelayMs ?? 180;
  const timeoutDelayMs = options.timeoutDelayMs ?? 12_000;
  const omitModelsEndpoint = options.omitModelsEndpoint === true;
  let taskCounter = 0;
  const tasks = new Map();
  const requests = [];

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '');
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const body = req.method === 'GET' ? Buffer.alloc(0) : await readBody(req);
      const path = url.pathname;

      if (path === '/__test__/state' && req.method === 'GET') {
        return send(res, 200, { mode, requests: requests.map(item => ({ ...item })) });
      }
      if (path === '/__test__/mode' && req.method === 'POST') {
        const requested = parseJson(body)?.mode;
        if (!VALID_MODES.has(requested)) return send(res, 400, { error: { message: 'unknown fake provider mode' } });
        mode = requested;
        return send(res, 200, { ok: true, mode });
      }
      if (path === '/__test__/reset' && req.method === 'POST') {
        requests.length = 0;
        tasks.clear();
        mode = options.mode && VALID_MODES.has(options.mode) ? options.mode : 'success';
        return send(res, 200, { ok: true, mode });
      }

      if (path === '/fixtures/image.png' && req.method === 'GET') {
        requests.push({ method: req.method, path, headers: redactHeaders(req.headers), bodyBytes: 0, bodyType: 'artifact-download' });
        const image = await readFile(IMAGE_FIXTURE);
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        return res.end(image);
      }
      if ((path === '/fixtures/video.mp4' || /^\/v1\/videos\/[^/]+\/content$/.test(path)) && req.method === 'GET') {
        requests.push({ method: req.method, path, headers: redactHeaders(req.headers), bodyBytes: 0, bodyType: 'artifact-download' });
        const video = await readFile(VIDEO_FIXTURE);
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Content-Type': 'video/mp4', 'Content-Length': video.length, 'Cache-Control': 'no-store' });
        return res.end(video);
      }

      if (!path.startsWith('/v1/') && !path.startsWith('/v2/')) return send(res, 404, { error: { message: 'not found' } });
      const summary = requestSummary(req, body);
      requests.push(summary);

      if (mode === 'slow') await sleep(slowDelayMs);
      if (mode === 'timeout') await sleep(timeoutDelayMs);
      const failure = errorForMode(mode);
      if (failure) return send(res, failure[0], failure[1]);
      if (mode === 'malformed_response' && path !== '/v1/videos/' && !path.endsWith('/content')) {
        return send(res, 200, '{not-json', { 'Content-Type': 'application/json; charset=utf-8' });
      }

      if (path === '/v1/models' && req.method === 'GET') {
        if (omitModelsEndpoint) return send(res, 404, { error: { message: 'models endpoint not available' } });
        return send(res, 200, { object: 'list', data: models });
      }
      if (path === '/v1/images/generations' && req.method === 'POST') {
        return send(res, 200, { created: Date.now(), data: [{ url: `${url.origin}/fixtures/image.png` }] });
      }
      if (path === '/v1/images/edits' && req.method === 'POST') {
        return send(res, 200, { created: Date.now(), data: [{ url: `${url.origin}/fixtures/image.png` }] });
      }
      if ((path === '/v1/videos' || path === '/v2/videos/generations') && req.method === 'POST') {
        const id = `fake-video-${++taskCounter}`;
        tasks.set(id, { id, pollCount: 0 });
        return send(res, 200, { id, task_id: id, status: 'queued' });
      }
      const taskMatch = path.match(/^\/(?:v1\/videos|v2\/videos\/generations)\/([^/]+)$/);
      if (taskMatch && req.method === 'GET') {
        const id = decodeURIComponent(taskMatch[1]);
        const task = tasks.get(id);
        if (!task) return send(res, 404, { error: { message: 'task not found' } });
       task.pollCount += 1;
       if (mode === 'polling_timeout') return send(res, 200, { id, status: 'processing' });
        if (mode === 'slow' && task.pollCount <= 2) return send(res, 200, { id, status: 'processing' });
       return send(res, 200, { id, status: 'succeeded', data: { output: `${url.origin}/v1/videos/${id}/content` }, output: `${url.origin}/v1/videos/${id}/content` });
      }
      return send(res, 404, { error: { message: 'unsupported fake provider endpoint' } });
    } catch (error) {
      send(res, 500, { error: { message: error instanceof Error ? error.message : 'fake provider error' } });
    }
  });

  server.getState = () => ({ mode, requests: requests.map(item => ({ ...item })) });
  server.setMode = nextMode => {
    if (!VALID_MODES.has(nextMode)) throw new Error(`unknown fake provider mode: ${nextMode}`);
    mode = nextMode;
  };
  return server;
}

async function startFromCli() {
  const port = Number(process.env.FAKE_PROVIDER_PORT || process.env.PORT || 43123);
  const server = createFakeProviderServer({ mode: process.env.FAKE_PROVIDER_MODE });
  server.listen(port, '127.0.0.1', () => {
    console.log(JSON.stringify({ event: 'ready', url: `http://127.0.0.1:${port}`, mode: server.getState().mode }));
  });
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startFromCli();
}

export const fakeProviderModuleUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
