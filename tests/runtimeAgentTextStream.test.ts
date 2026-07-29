// @vitest-environment node

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeAgentTextStream } from '../agent/runtime-stream.js';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function startRuntimeStub() {
  let received: { authorization?: string; body?: unknown } = {};
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      received = {
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('event: start\ndata: {"provider":"runtime","model":"agent-text"}\n\n');
      response.write('event: text-delta\ndata: {"delta":"制作"}\n\n');
      response.write('event: text-delta\ndata: {"delta":"计划"}\n\n');
      response.end('event: done\ndata: {"finishReason":"stop"}\n\n');
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('runtime stub did not bind');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    received: () => received,
  };
}

describe('Runtime agent-text stream', () => {
  it('converts the authenticated Runtime stream into PI events without sending provider secrets', async () => {
    const runtime = await startRuntimeStub();
    const streamFn = createRuntimeAgentTextStream({
      endpoint: runtime.endpoint,
      token: 'runtime-token',
    });
    const stream = streamFn(
      {
        id: 'runtime-agent-text',
        name: 'Flovart Runtime agent-text',
        api: 'flovart-runtime',
        provider: 'flovart',
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
      {
        systemPrompt: '只规划制作任务',
        messages: [{ role: 'user', content: '做一个解释视频', timestamp: 1 }],
        tools: [],
      },
    );

    const events = [];
    for await (const event of stream) events.push(event);

    expect(events.filter(event => event.type === 'text_delta').map(event => event.delta).join('')).toBe('制作计划');
    expect((await stream.result()).content).toEqual([{ type: 'text', text: '制作计划' }]);
    expect(runtime.received()).toEqual({
      authorization: 'Bearer runtime-token',
      body: {
        systemPrompt: '只规划制作任务',
        messages: [{ role: 'user', content: '做一个解释视频', timestamp: 1 }],
        tools: [],
      },
    });
    expect(JSON.stringify(runtime.received().body)).not.toMatch(/apiKey|credential|baseUrl|provider/i);
  });

  it('rejects any attempt to pass an API key through PI stream options', () => {
    const streamFn = createRuntimeAgentTextStream({
      endpoint: 'http://127.0.0.1:1',
      token: 'runtime-token',
    });

    expect(() => streamFn(
      {
        id: 'runtime-agent-text',
        name: 'Flovart Runtime agent-text',
        api: 'flovart-runtime',
        provider: 'flovart',
        baseUrl: '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
      { messages: [] },
      { apiKey: 'must-not-leave-agent' },
    )).toThrow('API Key');
  });
});
