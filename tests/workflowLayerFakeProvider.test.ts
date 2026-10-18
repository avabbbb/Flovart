/** @vitest-environment node */

import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowProject } from '../components/workflow/types';
import type { UserApiKey } from '../types';
import { editImageWithProvider } from '../services/aiGateway';
import { runWorkflowLayerOperation } from '../services/workflowImageOperations';
import { createFakeProviderServer } from '../scripts/fake-provider-server.mjs';

interface FakeRequest { method: string; path: string; referenceCount?: number; hasMask?: boolean }
interface FakeProviderServer extends Server {
  getState(): { mode: string; requests: FakeRequest[] };
  setMode(mode: string): void;
}

const servers: FakeProviderServer[] = [];

async function startFakeProvider() {
  // The fixture server is plain JS; its extra methods are declared by FakeProviderServer above.
  const server = createFakeProviderServer() as unknown as FakeProviderServer;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake provider did not expose a port');
  return { server, origin: 'http' + '://127.0.0.1:' + address.port };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

function fakeKey(origin: string): UserApiKey {
  return {
    id: 'fake-key', provider: 'custom', capabilities: ['image'], key: 'fake-secret', baseUrl: origin + '/v1',
    models: [{ id: 'gpt-image-2', name: 'GPT Image 2', capability: 'image' }], defaultModel: 'gpt-image-2',
    routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' }, routeId: 'gpt-image-2', order: 0 }],
    createdAt: 1, updatedAt: 1,
  };
}

function project(): WorkflowProject {
  return {
    id: 'project-1', title: '叠加层 fixture',
    nodes: [
      createWorkflowNode('source-1', 'image', { x: 0, y: 0 }, { storageKey: 'source-key', mimeType: 'image/png', status: 'success', config: { mode: 'image', modelId: 'flovart:gpt-image-2', submode: 'image-to-image' } }),
      createWorkflowNode('mask-1', 'image', { x: 0, y: 480 }, { storageKey: 'mask-key', mimeType: 'image/png', status: 'success' }),
    ],
    connections: [], selectedNodeIds: ['source-1'], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
    createdAt: new Date(Date.UTC(2026, 7, 5)).toISOString(), updatedAt: new Date(Date.UTC(2026, 7, 5)).toISOString(), draftVersion: 1,
  };
}

function runtime(key: UserApiKey) {
  let current = project();
  let index = 0;
  return {
    get current() { return current; },
    deps: {
      userApiKeys: [key],
      getProject: () => current,
      onProjectChange: vi.fn((next: WorkflowProject) => { current = next; }),
      loadMedia: vi.fn().mockResolvedValue(new Blob(['source'], { type: 'image/png' })),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result-key', name: 'result.png', mimeType: 'image/png', bytes: 6, naturalWidth: 640, naturalHeight: 360 }),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,U09VUkNF'),
      createId: () => 'id-' + index++,
    },
  };
}

const edits = (server: FakeProviderServer) => server.getState().requests.filter(request => request.method === 'POST' && request.path === '/v1/images/edits');

describe('image.layer@1 against the fake provider over real HTTP', () => {
  it('commits four sequential provider edits as one 2x2 Take', async () => {
    const { server, origin } = await startFakeProvider();
    const state = runtime(fakeKey(origin));
    const outcome = await runWorkflowLayerOperation('project-1', 'source-1', { prompt: '在天空画一颗发光星星', style: 'glow' }, state.deps);

    expect(outcome.status).toBe('committed');
    const requests = edits(server);
    expect(requests).toHaveLength(4);
    expect(requests.every(request => request.referenceCount === 1 && !request.hasMask)).toBe(true);
    const operation = state.current.nodes.find(node => node.type === 'operation');
    const take = operation?.metadata.operation?.takes[0];
    expect(take).toMatchObject({ status: 'success', snapshot: { routeId: 'gpt-image-2' } });
    const outputs = state.current.nodes.filter(node => node.metadata.sourceOperationNodeId === operation?.id);
    expect(outputs.map(node => node.id)).toEqual(take?.outputNodeIds);
    expect(new Set(outputs.map(node => node.position.x)).size).toBe(2);
    expect(new Set(outputs.map(node => node.position.y)).size).toBe(2);
  });

  it('sends the lasso mask with every candidate request', async () => {
    const { server, origin } = await startFakeProvider();
    const state = runtime(fakeKey(origin));
    await runWorkflowLayerOperation('project-1', 'source-1', { prompt: '加贴纸', style: 'sticker', count: 2, mask: { nodeId: 'mask-1' } }, state.deps);

    const requests = edits(server);
    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.hasMask)).toBe(true);
  });

  it('fails the whole Take when a later candidate is rate limited', async () => {
    const { server, origin } = await startFakeProvider();
    let calls = 0;
    const executeEdit: typeof editImageWithProvider = (...args) => {
      calls += 1;
      if (calls === 2) server.setMode('rate_limit');
      return editImageWithProvider(...args);
    };
    const state = runtime(fakeKey(origin));

    await expect(runWorkflowLayerOperation('project-1', 'source-1', { prompt: '加标题', style: 'title' }, { ...state.deps, executeEdit })).rejects.toThrow();
    expect(edits(server)).toHaveLength(2);
    const operation = state.current.nodes.find(node => node.type === 'operation');
    expect(operation?.metadata.operation?.takes[0]).toMatchObject({ status: 'error' });
    expect(state.current.nodes.filter(node => node.metadata.sourceOperationNodeId === operation?.id)).toHaveLength(0);
    expect(JSON.stringify(server.getState())).not.toContain('fake-secret');
  });
});
