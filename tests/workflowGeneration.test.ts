import { describe, expect, it, vi } from 'vitest';
import { cancelWorkflowGeneration, runWorkflowGeneration } from '../services/workflowGeneration';
import type { UserApiKey } from '../types';
import type { WorkflowProject } from '../components/workflow/types';

const imageKey: UserApiKey = {
  id: 'image-key',
  provider: 'openai',
  capabilities: ['image'],
  key: 'secret',
  customModels: ['gpt-image-2'],
  createdAt: 1,
  updatedAt: 1,
};

const project = (): WorkflowProject => ({
  id: 'project-1',
  title: '测试工作流',
  nodes: [
    { id: 'text-1', type: 'text', title: '角色', position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { content: '银色机器人' } },
    { id: 'image-1', type: 'image', title: '参考图', position: { x: 0, y: 220 }, width: 300, height: 200, metadata: { href: 'data:image/png;base64,AA==', mimeType: 'image/png' } },
    { id: 'config-1', type: 'config', title: '生成配置', position: { x: 420, y: 80 }, width: 360, height: 260, metadata: { prompt: '电影光线', config: { mode: 'image', modelId: 'gpt-image-2' } } },
  ],
  connections: [
    { id: 'a', fromNodeId: 'text-1', toNodeId: 'config-1' },
    { id: 'b', fromNodeId: 'image-1', toNodeId: 'config-1' },
  ],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots',
  agentSessions: [],
  activeAgentSessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('workflow generation', () => {
  it('runs a text node directly with text mode and creates a connected text result', async () => {
    const source = project();
    let latest = source;
    source.nodes[0].metadata = { prompt: '写一段银色机器人的旁白', config: { mode: 'text', modelId: 'text-model' } };
    const result = await runWorkflowGeneration(source, 'text-1', {
      userApiKeys: [{ ...imageKey, id: 'text-key', capabilities: ['text'], customModels: ['text-model'] }],
      modelPreference: { textModel: 'text-model', imageModel: '', videoModel: '' },
      executeText: vi.fn().mockResolvedValue('生成的旁白'),
      onProjectChange: next => { latest = next; },
      getProject: () => latest,
      createId: (() => { let index = 0; return () => `text-result-${index++}`; })(),
    });
    expect(result.nodes.at(-1)).toMatchObject({ type: 'text', metadata: { content: '生成的旁白' } });
    expect(result.connections.at(-1)).toMatchObject({ fromNodeId: 'text-1', toNodeId: result.nodes.at(-1)?.id });
  });

  it.each([
    ['image', 'image-model', 'image'],
    ['video', 'video-model', 'video'],
  ] as const)('runs a %s node directly through the media provider', async (nodeType, model, capability) => {
    const source = project();
    source.nodes[0] = { ...source.nodes[0], type: nodeType, metadata: { prompt: `生成${nodeType}`, config: { mode: nodeType, modelId: model } } };
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'text-1', capability, mediaUrl: 'https://output/result', mimeType: nodeType === 'video' ? 'video/mp4' : 'image/png' });
    const result = await runWorkflowGeneration(source, 'text-1', {
      userApiKeys: [{ ...imageKey, capabilities: [nodeType], customModels: [model] }],
      modelPreference: { textModel: '', imageModel: nodeType === 'image' ? model : '', videoModel: nodeType === 'video' ? model : '' },
      executeMedia, fetchMedia: vi.fn().mockResolvedValue(new Blob(['result'])),
      ingestMedia: vi.fn().mockResolvedValue({ type: nodeType, storageKey: `${nodeType}-key`, name: `result.${nodeType}`, mimeType: nodeType === 'video' ? 'video/mp4' : 'image/png', bytes: 6 }),
      onProjectChange: vi.fn(),
    });
    expect(executeMedia).toHaveBeenCalledWith(expect.objectContaining({ modelId: model }));
    expect(result.nodes.at(-1)).toMatchObject({ type: nodeType, metadata: { storageKey: `${nodeType}-key`, href: undefined } });
  });

  it('uses mentioned durable media, filters unsupported references, and persists generated blobs', async () => {
    const source = project();
    source.nodes[2].metadata.mentionedNodeIds = ['image-1'];
    source.nodes[1].metadata = { storageKey: 'stored-image', mimeType: 'image/png' };
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image.png', mimeType: 'image/png' });
    const ingestMedia = vi.fn().mockResolvedValue({ type: 'image', storageKey: 'generated-key', name: 'result.png', mimeType: 'image/png', bytes: 10, naturalWidth: 640, naturalHeight: 480 });
    let latest = source;
    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey], modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' }, executeMedia,
      getProject: () => latest, loadMedia: vi.fn().mockResolvedValue(new Blob(['ref'], { type: 'image/png' })),
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['out'], { type: 'image/png' })), ingestMedia, onProjectChange: next => { latest = next; },
    });
    expect(executeMedia).toHaveBeenCalledWith(expect.objectContaining({ references: [expect.objectContaining({ type: 'image', href: expect.stringMatching(/^blob:/) })] }));
    expect(ingestMedia).toHaveBeenCalled();
  });

  it('cancels an active request and ignores its late provider result', async () => {
    const source = project();
    let resolve!: (value: any) => void;
    const pending = new Promise<any>(done => { resolve = done; });
    const updates: WorkflowProject[] = [];
    const run = runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey], modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' },
      executeMedia: () => pending, getProject: () => updates.at(-1) || source, onProjectChange: next => updates.push(next),
    });
    cancelWorkflowGeneration('project-1', 'config-1');
    resolve({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' });
    const result = await run;
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[2].metadata.status).toBe('idle');
  });

  it('creates the configured batch count without losing canonical node movement', async () => {
    const source = project();
    source.nodes[2].metadata.config!.count = 2;
    const moved = { ...source, nodes: source.nodes.map(node => node.id === 'config-1' ? { ...node, position: { x: 900, y: 400 } } : node) };
    let latest = moved;
    const result = await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey], modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' },
      executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' }),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'generated', name: 'result.png', mimeType: 'image/png', bytes: 1, naturalWidth: 100, naturalHeight: 100 }),
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['out'])), getProject: () => latest, onProjectChange: next => { latest = next; },
    });
    expect(result.nodes.filter(node => node.title === '生成图片')).toHaveLength(2);
    expect(result.nodes.find(node => node.id === 'config-1')?.position).toEqual({ x: 900, y: 400 });
  });
  it('merges direct upstream inputs and creates a connected result node', async () => {
    const executeMedia = vi.fn(async input => {
      input.onProgress?.(42, 'generating');
      return { ok: true as const, elementId: 'config-1', capability: 'image' as const, mediaUrl: 'data:image/png;base64,RESULT', mimeType: 'image/png' };
    });
    const updates: WorkflowProject[] = [];
    const saveHistory = vi.fn();

    const result = await runWorkflowGeneration(project(), 'config-1', {
      userApiKeys: [imageKey],
      modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' },
      executeMedia,
      executeText: vi.fn(),
      onProjectChange: next => updates.push(next),
      saveHistory,
      createId: () => `id-${updates.length}`,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['result'], { type: 'image/png' })),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result-key', name: 'result.png', mimeType: 'image/png', bytes: 6, naturalWidth: 1024, naturalHeight: 1024 }),
    });

    expect(executeMedia).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('银色机器人'),
      references: [expect.objectContaining({ type: 'image', elementId: 'image-1' })],
    }));
    expect(result.nodes).toHaveLength(4);
    expect(result.connections.some(connection => connection.fromNodeId === 'config-1' && connection.toNodeId === result.nodes[3].id)).toBe(true);
    expect(result.nodes[2].metadata.status).toBe('success');
    expect(updates.some(update => update.nodes[2].metadata.progress === 42)).toBe(true);
    expect(saveHistory).toHaveBeenCalledTimes(1);
  });

  it('keeps the config node retryable when the provider fails', async () => {
    const result = await runWorkflowGeneration(project(), 'config-1', {
      userApiKeys: [imageKey],
      modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' },
      executeMedia: vi.fn().mockResolvedValue({ ok: false, elementId: 'config-1', capability: 'image', errorMessage: 'provider unavailable' }),
      executeText: vi.fn(),
      onProjectChange: vi.fn(),
    });

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[2].metadata).toMatchObject({ status: 'error', error: 'provider unavailable' });
  });
});
