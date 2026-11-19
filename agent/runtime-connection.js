import { createRuntimeAgentTextStream } from './runtime-stream.js';

const clientModule = async () => {
  try {
    return await import('../tools/iris/runtime-client.js');
  } catch {
    return import('../runtime-client.js');
  }
};

export const RUNTIME_AGENT_TEXT_MODEL = Object.freeze({
  id: 'runtime-agent-text',
  name: 'Iris Runtime agent-text',
  api: 'iris-runtime',
  provider: 'iris',
  baseUrl: '',
  reasoning: false,
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_384,
});

export function createProductionRuntimeStream() {
  let client;
  return createRuntimeAgentTextStream({
    connection: async () => {
      const { IrisRuntimeClient } = await clientModule();
      client ||= new IrisRuntimeClient();
      const discovery = await client.loadDiscovery();
      return {
        endpoint: `http://127.0.0.1:${discovery.port}`,
        token: discovery.token,
      };
    },
  });
}
