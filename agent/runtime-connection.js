import { createRuntimeAgentTextStream } from './runtime-stream.js';

const clientModule = async () => {
  try {
    return await import('../tools/flovart/runtime-client.js');
  } catch {
    return import('../runtime-client.js');
  }
};

export const RUNTIME_AGENT_TEXT_MODEL = Object.freeze({
  id: 'runtime-agent-text',
  name: 'Flovart Runtime agent-text',
  api: 'flovart-runtime',
  provider: 'flovart',
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
      const { FlovartRuntimeClient } = await clientModule();
      client ||= new FlovartRuntimeClient();
      const discovery = await client.loadDiscovery();
      return {
        endpoint: `http://127.0.0.1:${discovery.port}`,
        token: discovery.token,
      };
    },
  });
}
