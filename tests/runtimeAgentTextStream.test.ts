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

async function startToolRuntimeStub() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('event: start\ndata: {"provider":"runtime","model":"agent-text"}\n\n');
    response.write('event: toolcall-start\ndata: {"index":0,"id":"call-1","name":"flovart_workflow_inspect"}\n\n');
    response.write('event: toolcall-delta\ndata: {"index":0,"id":"call-1","name":"flovart_workflow_inspect","delta":"{"}\n\n');
    response.write('event: toolcall-delta\ndata: {"index":0,"delta":"\\"projectId\\":\\"project-1\\"}"}\n\n');
    response.write('event: toolcall-end\ndata: {"index":0,"id":"call-1","name":"flovart_workflow_inspect","arguments":"{\\"projectId\\":\\"project-1\\"}"}\n\n');
    response.end('event: done\ndata: {"finishReason":"toolUse"}\n\n');
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('runtime stub did not bind');
  return `http://127.0.0.1:${address.port}`;
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

  it('normalizes Runtime tool-call events into a PI toolUse message', async () => {
    const endpoint = await startToolRuntimeStub();
    const streamFn = createRuntimeAgentTextStream({ endpoint, token: 'runtime-token' });
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
        messages: [{ role: 'user', content: '读取当前 Workflow', timestamp: 1 }],
        tools: [{
          name: 'flovart_workflow_inspect',
          description: '读取 Workflow',
          parameters: { type: 'object', properties: { projectId: { type: 'string' } } },
        }],
      },
    );

    const events = [];
    for await (const event of stream) events.push(event);

    expect(events.map(event => event.type)).toEqual([
      'start',
      'toolcall_start',
      'toolcall_delta',
      'toolcall_delta',
      'toolcall_end',
      'done',
    ]);
    expect(await stream.result()).toMatchObject({
      stopReason: 'toolUse',
      content: [{
        type: 'toolCall',
        id: 'call-1',
        name: 'flovart_workflow_inspect',
        arguments: { projectId: 'project-1' },
      }],
    });
  });
});
