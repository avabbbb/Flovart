import { describe, expect, it, vi } from 'vitest';
import { cancelWorkflowGeneration, runWorkflowGeneration } from '../services/workflowGeneration';
import { getProductModel } from '../services/productModelCatalog';
import type { ProductModelMode, UserApiKey } from '../types';
import type { WorkflowProject } from '../components/workflow/types';
import { createWorkflowOperationInputBinding, createWorkflowOperationNode, workflowOperationInputConnections } from '../components/workflow/operations';

const imageKey: UserApiKey = {
  id: 'image-key',
  provider: 'openai',
  capabilities: ['image'],
  key: 'secret',
  customModels: ['gpt-image-2'],
  routeMappings: [
    { target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' as const }, routeId: 'gpt-image-2', order: 0 },
    { target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' as const }, routeId: 'gpt-image-2', order: 0 },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const mappedTextKey = (routeId = 'text-model'): UserApiKey => ({
  ...imageKey,
  id: 'text-key',
  provider: 'google',
  capabilities: ['text'],
  customModels: [routeId],
  routeMappings: [{ target: { kind: 'runtime-capability', capability: 'agent-text' }, routeId, order: 0 }],
});

const mappedMediaKey = (capability: 'image' | 'video', productModelId: string, routeId: string, provider: UserApiKey['provider'] = 'custom'): UserApiKey => {
  const product = getProductModel(productModelId);
  const modes: ProductModelMode[] = product?.capabilities.modes || (capability === 'image' ? ['text-to-image'] : ['text-to-video']);
  return {
    ...imageKey,
    id: `${capability}-key`,
    provider,
    capabilities: [capability],
    customModels: [routeId],
    routeMappings: modes.map(mode => ({ target: { kind: 'product-mode' as const, productModelId, mode }, routeId, order: 0 })),
  };
};

const project = (): WorkflowProject => ({
  id: 'project-1',
  title: '测试工作流',
  nodes: [
    { id: 'text-1', type: 'text', title: '角色', position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { content: '银色机器人' } },
    { id: 'image-1', type: 'image', title: '参考图', position: { x: 0, y: 220 }, width: 300, height: 200, metadata: { href: 'data:image/png;base64,AA==', mimeType: 'image/png' } },
    { id: 'config-1', type: 'config', title: '生成配置', position: { x: 420, y: 80 }, width: 360, height: 260, metadata: { prompt: '电影光线', config: { mode: 'image', modelId: 'flovart:gpt-image-2' } } },
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
  it('keeps an image generation Operation and appends an immutable output Take', async () => {
    const source = project();
    const operation = await createWorkflowOperationNode({
      id: 'operation-1', capabilityId: 'image.generate@1', position: { x: 420, y: 80 }, prompt: '电影光线',
      productModelId: 'flovart:gpt-image-2', parameters: { submode: 'text-to-image', count: 1 },
      inputBindings: [createWorkflowOperationInputBinding('prompt-binding', 'text-1', 'prompt_context', 0)],
      now: '2026-08-05T00:00:00.000Z',
    });
    source.nodes = [source.nodes[0], operation];
    source.connections = workflowOperationInputConnections(operation);
    let latest = source;
    const result = await runWorkflowGeneration(source, operation.id, {
      userApiKeys: [imageKey],
      executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: operation.id, capability: 'image', mediaUrl: 'https://output/result', mimeType: 'image/png' }),
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['result'])),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result-key', name: 'result.png', mimeType: 'image/png', bytes: 6, naturalWidth: 800, naturalHeight: 400 }),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
      getProject: () => latest,
      onProjectChange: next => { latest = next; },
      createId: (() => { let index = 0; return () => `generated-${index++}`; })(),
    });
    const committedOperation = result.nodes.find(node => node.id === operation.id);
    const output = result.nodes.find(node => node.metadata.sourceOperationNodeId === operation.id);
    expect(committedOperation?.type).toBe('operation');
    expect(output).toMatchObject({ type: 'image', width: 420, height: 210, metadata: { storageKey: 'result-key', operationTakeId: 'generated-0', config: { modelId: 'flovart:gpt-image-2' } } });
    expect(result.connections).toContainEqual(expect.objectContaining({ fromNodeId: operation.id, toNodeId: output?.id, kind: 'operation-output' }));
    expect(committedOperation?.metadata.operation?.takes[0]).toMatchObject({
      id: 'generated-0', status: 'success', outputNodeIds: [output?.id], snapshot: { renderedPrompt: expect.stringContaining('电影光线'), routeId: 'gpt-image-2' },
    });
    expect(committedOperation?.metadata.operation?.selectedTakeId).toBe('generated-0');
  });

  it('runs a text node directly with text mode and replaces the initiator in place', async () => {
    const source = project();
    let latest = source;
    source.nodes[0].metadata = { prompt: '写一段银色机器人的旁白', config: { mode: 'text' } };
    const result = await runWorkflowGeneration(source, 'text-1', {
      userApiKeys: [mappedTextKey()],
      executeText: vi.fn().mockResolvedValue('生成的旁白'),
      onProjectChange: next => { latest = next; },
      getProject: () => latest,
      createId: (() => { let index = 0; return () => `text-result-${index++}`; })(),
    });
    const initiator = result.nodes.find(node => node.id === 'text-1');
    expect(initiator?.type).toBe('text');
    expect(initiator?.metadata.content).toBe('生成的旁白');
    expect(result.nodes).toHaveLength(source.nodes.length);
    expect(result.connections).toHaveLength(source.connections.length);
  });

  it.each([
    ['image', 'flovart:gpt-image-2', 'image-model', 'image'],
    ['video', 'flovart:seedance-2', 'video-model', 'video'],
  ] as const)('runs a %s node directly and replaces the initiator in place', async (nodeType, productModelId, routeId, capability) => {
    const source = project();
    source.nodes[0] = { ...source.nodes[0], type: nodeType, metadata: { prompt: `生成${nodeType}`, config: { mode: nodeType, modelId: productModelId } } };
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'text-1', capability, mediaUrl: 'https://output/result', mimeType: nodeType === 'video' ? 'video/mp4' : 'image/png' });
    const result = await runWorkflowGeneration(source, 'text-1', {
      userApiKeys: [mappedMediaKey(nodeType, productModelId, routeId)],
      executeMedia, fetchMedia: vi.fn().mockResolvedValue(new Blob(['result'])),
      ingestMedia: vi.fn().mockResolvedValue({ type: nodeType, storageKey: `${nodeType}-key`, name: `result.${nodeType}`, mimeType: nodeType === 'video' ? 'video/mp4' : 'image/png', bytes: 6 }),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='), createVideoPoster: vi.fn().mockResolvedValue(null),
      onProjectChange: vi.fn(),
    });
    expect(executeMedia).toHaveBeenCalledWith(expect.objectContaining({ modelId: routeId, productModelId }));
    const initiator = result.nodes.find(node => node.id === 'text-1');
    expect(initiator?.type).toBe(nodeType);
    expect(initiator?.metadata).toMatchObject({ storageKey: `${nodeType}-key`, href: undefined });
    expect(result.nodes).toHaveLength(source.nodes.length);
    expect(result.connections).toHaveLength(source.connections.length);
  });

  it('resolves a Workflow product model to its confirmed BYOK upstream model', async () => {
    const source = project();
    source.nodes[2].metadata.config = { mode: 'image', modelId: 'flovart:gpt-image-2' };
    const mappedKey: UserApiKey = {
      ...imageKey,
      models: [{ id: 'gpt-image-2', name: 'GPT Image 2' }],
      routeMappings: [{
        target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' as const },
        routeId: 'gpt-image-2',
        order: 0,
      }],
    };
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' });

    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedKey],
      executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['result'], { type: 'image/png' })),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'mapped-image', name: 'result.png', mimeType: 'image/png', bytes: 6 }),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
      onProjectChange: vi.fn(),
    });

    expect(executeMedia).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'gpt-image-2',
      productModelId: 'flovart:gpt-image-2',
      apiKeyPayload: mappedKey,
    }));
  });

  it('rejects an unknown bare media model instead of bypassing the product catalog', async () => {
    const source = project();
    source.nodes[2].metadata.config = { mode: 'image', modelId: 'private-upstream-model' };
    const executeMedia = vi.fn();

    const result = await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedMediaKey('image', 'flovart:gpt-image-2', 'private-upstream-model')],
      executeMedia,
      onProjectChange: vi.fn(),
    });

    expect(executeMedia).not.toHaveBeenCalled();
    expect(result.nodes.find(item => item.id === 'config-1')?.metadata.error).toContain('仅支持平台预设产品模型');
  });

  it('blocks a media node that has no explicit product model', async () => {
    const source = project();
    source.nodes[2].metadata.config = { mode: 'image' };
    const executeMedia = vi.fn();

    const result = await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey], executeMedia, onProjectChange: vi.fn(),
    });

    expect(executeMedia).not.toHaveBeenCalled();
    expect(result.nodes.find(item => item.id === 'config-1')?.metadata.error).toContain('明确选择图片产品模型');
  });

  it('does not bypass the prompt-enhancement mapping when automatic optimization is enabled', async () => {
    const source = project();
    source.nodes[2].metadata.config = {
      mode: 'video',
      modelId: 'flovart:seedance-2',
      enhancePrompt: true,
    };
    const executeMedia = vi.fn();

    const result = await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedMediaKey('video', 'flovart:seedance-2', 'doubao-seedance-2-0-260128', 'volcengine')],
      executeMedia,
      onProjectChange: vi.fn(),
    });

    expect(executeMedia).not.toHaveBeenCalled();
    expect(result.nodes.find(item => item.id === 'config-1')?.metadata.error).toContain('尚未配置可用的模型映射');
  });

  it('uses mentioned durable media, filters unsupported references, and persists generated blobs', async () => {
    const source = project();
    source.nodes[2].metadata.mentionedNodeIds = ['image-1'];
    source.nodes[1].metadata = { storageKey: 'stored-image', mimeType: 'image/png' };
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image.png', mimeType: 'image/png' });
    const ingestMedia = vi.fn().mockResolvedValue({ type: 'image', storageKey: 'generated-key', name: 'result.png', mimeType: 'image/png', bytes: 10, naturalWidth: 640, naturalHeight: 480 });
    let latest = source;
    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey], executeMedia,
      getProject: () => latest, loadMedia: vi.fn().mockResolvedValue(new Blob(['ref'], { type: 'image/png' })),
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['out'], { type: 'image/png' })), ingestMedia, onProjectChange: next => { latest = next; },
    });
    expect(executeMedia).toHaveBeenCalledWith(expect.objectContaining({ references: [expect.objectContaining({ type: 'image', href: expect.stringMatching(/^blob:/) })] }));
    expect(ingestMedia).toHaveBeenCalled();
  });

  it('passes only connected @mentioned media refs, never unconnected mentions or the initiating media node itself', async () => {
    const source = project();
    source.nodes = [
      { id: 'ref-a', type: 'image', title: '参考 A', position: { x: 0, y: 0 }, width: 120, height: 90, metadata: { href: 'https://cdn.example.com/a.png', mimeType: 'image/png' } },
      { id: 'ref-b', type: 'image', title: '参考 B', position: { x: 0, y: 120 }, width: 120, height: 90, metadata: { href: 'https://cdn.example.com/b.png', mimeType: 'image/png' } },
      { id: 'ref-c', type: 'image', title: '参考 C', position: { x: 0, y: 240 }, width: 120, height: 90, metadata: { href: 'https://cdn.example.com/c.png', mimeType: 'image/png' } },
      { id: 'self-video', type: 'video', title: '当前视频节点', position: { x: 420, y: 0 }, width: 360, height: 240, metadata: { href: 'https://cdn.example.com/self.mp4', mimeType: 'video/mp4', prompt: '让画面动起来', config: { mode: 'video', modelId: 'flovart:seedance-2' } } },
    ];
    source.connections = [
      { id: 'a', fromNodeId: 'ref-a', toNodeId: 'self-video' },
      { id: 'b', fromNodeId: 'ref-b', toNodeId: 'self-video' },
    ];
    source.nodes[3].metadata.mentionedNodeIds = ['ref-a', 'ref-b', 'ref-c'];
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'self-video', capability: 'video', mediaUrl: 'https://output/video', mimeType: 'video/mp4' });

    await runWorkflowGeneration(source, 'self-video', {
      userApiKeys: [mappedMediaKey('video', 'flovart:seedance-2', 'seedance-2.0', 'volcengine')],
      executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['video'])),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'video', storageKey: 'video', name: 'video.mp4', mimeType: 'video/mp4', bytes: 5 }),
      createVideoPoster: vi.fn().mockResolvedValue(null),
      onProjectChange: vi.fn(),
    });

    const references = executeMedia.mock.calls[0][0].references;
    expect(references.map((reference: any) => reference.elementId)).toEqual(['ref-a', 'ref-b']);
    expect(references.some((reference: any) => reference.elementId === 'self-video')).toBe(false);
  });

  it('does not pass connected media unless it is explicitly @mentioned', async () => {
    const source = project();
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' });

    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey],
      executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['image'])),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result', name: 'result.png', mimeType: 'image/png', bytes: 5 }),
      onProjectChange: vi.fn(),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
    });

    const references = executeMedia.mock.calls[0][0].references;
    expect(references).toEqual([]);
  });

  it('resolves plain PromptBar text @图片1 @图片2 and sends both connected images to the Provider in text order', async () => {
    const source = project();
    const target = source.nodes.find(node => node.id === 'config-1')!;
    source.nodes.find(node => node.id === 'image-1')!.title = '图片1';
    source.nodes.push({ id: 'image-2', type: 'image', title: '图片2', position: { x: 0, y: 440 }, width: 300, height: 200, metadata: { href: 'data:image/png;base64,BB==', mimeType: 'image/png' } });
    source.connections.push({ id: 'c', fromNodeId: 'image-2', toNodeId: 'config-1' });
    target.metadata.prompt = '让 @图片2 参考 @图片1 的构图';
    target.metadata.mentionedNodeIds = undefined;
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' });

    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey],
      executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['image'])),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result', name: 'result.png', mimeType: 'image/png', bytes: 5 }),
      onProjectChange: vi.fn(),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
    });

    expect(executeMedia.mock.calls[0][0].references.map((reference: any) => reference.elementId)).toEqual(['image-2', 'image-1']);
  });

  it('preserves semantic @ aliases from the rich prompt document in the Provider reference manifest', async () => {
    const source = project();
    const target = source.nodes.find(node => node.id === 'config-1')!;
    target.metadata = {
      prompt: '@角色1向左走',
      richTextDocument: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'mediaMention', attrs: { id: 'image-1', label: '角色1', thumbnail: '', elementType: 'image' } },
            { type: 'text', text: '向左走' },
          ],
        }],
      },
      mentionedNodeIds: ['image-1'],
      config: { mode: 'video', modelId: 'flovart:seedance-2', submode: 'reference-to-video' },
    };
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'video', mediaUrl: 'https://output/video', mimeType: 'video/mp4' });

    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedMediaKey('video', 'flovart:seedance-2', 'doubao-seedance-2-0-260128', 'volcengine')],
      executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['video'])),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'video', storageKey: 'video', name: 'video.mp4', mimeType: 'video/mp4', bytes: 5 }),
      createVideoPoster: vi.fn().mockResolvedValue(null),
      onProjectChange: vi.fn(),
    });

    expect(executeMedia.mock.calls[0][0].references).toEqual([
      expect.objectContaining({ elementId: 'image-1', label: '角色1', sourceName: '参考图' }),
    ]);
  });

  it('keeps all @ images allowed by the mapped RunningHub image-to-video route', async () => {
    const source = project();
    const target = source.nodes.find(node => node.id === 'config-1')!;
    source.nodes.find(node => node.id === 'image-1')!.title = '图片1';
    source.nodes.push(
      { id: 'image-2', type: 'image', title: '图片2', position: { x: 0, y: 440 }, width: 300, height: 200, metadata: { href: 'https://cdn.example.com/2.png', mimeType: 'image/png' } },
      { id: 'image-3', type: 'image', title: '图片3', position: { x: 0, y: 660 }, width: 300, height: 200, metadata: { href: 'https://cdn.example.com/3.png', mimeType: 'image/png' } },
    );
    source.connections.push(
      { id: 'c2', fromNodeId: 'image-2', toNodeId: 'config-1' },
      { id: 'c3', fromNodeId: 'image-3', toNodeId: 'config-1' },
    );
    target.metadata = {
      prompt: '@图片1 @图片2 @图片3 作为连续镜头参考',
      mentionedNodeIds: ['image-1', 'image-2', 'image-3'],
      config: { mode: 'video', modelId: 'flovart:veo-3.1-fast', submode: 'image-to-video' },
    };
    const routeId = 'rhart-video-v3.1-fast/image-to-video';
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'video', mediaUrl: 'https://output/video', mimeType: 'video/mp4' });
    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedMediaKey('video', 'flovart:veo-3.1-fast', routeId, 'runningHub')], executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['video'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'video', storageKey: 'video', name: 'video.mp4', mimeType: 'video/mp4', bytes: 5 }), createVideoPoster: vi.fn().mockResolvedValue(null), onProjectChange: vi.fn(),
    });
    expect(executeMedia.mock.calls[0][0].references).toEqual([
      expect.objectContaining({ elementId: 'image-1', slotRole: 'first_frame' }),
      expect.objectContaining({ elementId: 'image-2', slotRole: 'reference_image' }),
      expect.objectContaining({ elementId: 'image-3', slotRole: 'reference_image' }),
    ]);
  });

  it('ignores stale hidden referenceNodeIds when there is no visible connection or @mention', async () => {
    const source = project();
    source.nodes.push({ id: 'stale', type: 'image', title: '旧隐藏引用', position: { x: 0, y: 440 }, width: 120, height: 90, metadata: { href: 'https://cdn.example.com/stale.png', mimeType: 'image/png' } });
    source.nodes[2].metadata.referenceNodeIds = ['stale'];
    source.connections = source.connections.filter(connection => connection.fromNodeId !== 'image-1');
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' });

    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey],
      executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['image'])),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result', name: 'result.png', mimeType: 'image/png', bytes: 5 }),
      onProjectChange: vi.fn(),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
    });

    const references = executeMedia.mock.calls[0][0].references;
    expect(references.map((reference: any) => reference.elementId)).toEqual([]);
  });

  it('cancels an active request and ignores its late provider result', async () => {
    const source = project();
    let resolve!: (value: any) => void;
    const pending = new Promise<any>(done => { resolve = done; });
    const updates: WorkflowProject[] = [];
    const run = runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey],
      executeMedia: () => pending, getProject: () => updates.at(-1) || source, onProjectChange: next => { updates.push(next); },
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
      userApiKeys: [imageKey],
      executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' }),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'generated', name: 'result.png', mimeType: 'image/png', bytes: 1, naturalWidth: 100, naturalHeight: 100 }),
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['out'])), getProject: () => latest, onProjectChange: next => { latest = next; },
    });
    expect(result.nodes.filter(node => node.title === '生成图片')).toHaveLength(2);
    expect(result.nodes.find(node => node.id === 'config-1')?.position).toEqual({ x: 900, y: 400 });
  });
  it('merges direct upstream inputs and creates a connected result node', async () => {
    const source = project();
    source.nodes[2].metadata.mentionedNodeIds = ['image-1'];
    const executeMedia = vi.fn(async input => {
      input.onProgress?.(42, 'generating');
      return { ok: true as const, elementId: 'config-1', capability: 'image' as const, mediaUrl: 'data:image/png;base64,RESULT', mimeType: 'image/png' };
    });
    const updates: WorkflowProject[] = [];
    const saveHistory = vi.fn();

    const result = await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey],
      executeMedia,
      executeText: vi.fn(),
      onProjectChange: next => { updates.push(next); },
      saveHistory,
      createId: () => `id-${updates.length}`,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['result'], { type: 'image/png' })),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result-key', name: 'result.png', mimeType: 'image/png', bytes: 6, naturalWidth: 1024, naturalHeight: 1024 }),
    });

    expect(executeMedia).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('银色机器人'),
      references: [expect.objectContaining({ type: 'image', elementId: 'image-1' })],
    }));
    expect(result.nodes).toHaveLength(3);
    const initiator = result.nodes.find(node => node.id === 'config-1');
    expect(initiator?.type).toBe('image');
    expect(initiator?.metadata).toMatchObject({ status: 'success', storageKey: 'result-key' });
    expect(result.connections).toHaveLength(2);
    expect(result.nodes[2].metadata.status).toBe('success');
    expect(updates.some(update => update.nodes[2].metadata.progress === 42)).toBe(true);
    expect(saveHistory).toHaveBeenCalledTimes(1);
  });

  it('keeps the config node retryable when the provider fails', async () => {
    const result = await runWorkflowGeneration(project(), 'config-1', {
      userApiKeys: [imageKey],
      executeMedia: vi.fn().mockResolvedValue({ ok: false, elementId: 'config-1', capability: 'image', errorMessage: 'provider unavailable' }),
      executeText: vi.fn(),
      onProjectChange: vi.fn(),
    });

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[2].metadata).toMatchObject({ status: 'error', error: 'provider unavailable' });
  });

  it('rejects unsupported video and audio references instead of silently dropping visible bindings', async () => {
    const source = project();
    source.nodes.push(
      { id: 'video-ref', type: 'video', title: '视频参考', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { href: 'data:video/mp4;base64,AA==', mimeType: 'video/mp4' } },
      { id: 'audio-ref', type: 'audio', title: '音频参考', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { href: 'data:audio/mp3;base64,AA==', mimeType: 'audio/mp3' } },
    );
    source.connections.push({ id: 'video-link', fromNodeId: 'video-ref', toNodeId: 'config-1' }, { id: 'audio-link', fromNodeId: 'audio-ref', toNodeId: 'config-1' });
    source.nodes[2].metadata.mentionedNodeIds = ['image-1', 'video-ref', 'audio-ref'];
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' });
    const result = await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey], executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['image'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result', name: 'result.png', mimeType: 'image/png', bytes: 5 }), onProjectChange: vi.fn(), encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
    });
    expect(executeMedia).not.toHaveBeenCalled();
    expect(result.nodes.find(node => node.id === 'config-1')?.metadata.error).toBe('当前 Provider 线路不接收 @视频 参考');
  });

  it('passes audio references only when the selected video capability supports the audio slot', async () => {
    const source = project();
    source.nodes[2].metadata.config = { mode: 'video', modelId: 'flovart:seedance-2' };
    source.nodes.push({ id: 'audio-ref', type: 'audio', title: '配乐', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { href: 'data:audio/mp3;base64,AA==', mimeType: 'audio/mp3' } });
    source.connections.push({ id: 'audio-link', fromNodeId: 'audio-ref', toNodeId: 'config-1' });
    source.nodes[2].metadata.mentionedNodeIds = ['audio-ref'];
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'video', mediaUrl: 'https://output/video', mimeType: 'video/mp4' });
    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedMediaKey('video', 'flovart:seedance-2', 'seedance-2.0', 'volcengine')], executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['video'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'video', storageKey: 'video', name: 'video.mp4', mimeType: 'video/mp4', bytes: 5 }), createVideoPoster: vi.fn().mockResolvedValue(null), onProjectChange: vi.fn(),
    });
    expect(executeMedia.mock.calls[0][0].references).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'audio', slotRole: 'reference_audio' })]));
  });

  it('describes connected media by label for text generation without claiming media transport', async () => {
    const source = project();
    source.nodes[0].metadata = { prompt: '写说明', config: { mode: 'text' }, mentionedNodeIds: ['image-1'] };
    source.connections.push({ id: 'image-to-text', fromNodeId: 'image-1', toNodeId: 'text-1' });
    const executeText = vi.fn().mockResolvedValue('完成');
    await runWorkflowGeneration(source, 'text-1', {
      userApiKeys: [mappedTextKey()], executeText, onProjectChange: vi.fn(),
    });
    expect(executeText.mock.calls[0][0]).toContain('[参考媒体: 参考图 (image)]');
  });

  it.each(['ingest', 'encode'] as const)('cancels safely during async %s preparation', async stage => {
    const source = project();
    let latest = source;
    let release!: () => void;
    let started!: () => void;
    const stageStarted = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const run = runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey], executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' }), fetchMedia: vi.fn().mockResolvedValue(new Blob(['image'])),
      ingestMedia: async () => { if (stage === 'ingest') { started(); await wait; } return { type: 'image', storageKey: 'cancelled-key', name: 'cancelled.png', mimeType: 'image/png', bytes: 5 }; },
      encodeDataUrl: async () => { if (stage === 'encode') { started(); await wait; } return 'data:image/png;base64,CANCELLED'; }, getProject: () => latest, onProjectChange: next => { latest = next; },
    });
    await stageStarted;
    cancelWorkflowGeneration(source.id, 'config-1');
    release();
    await run;
    expect(latest.nodes.some(node => node.metadata.storageKey === 'cancelled-key')).toBe(false);
    expect(latest.nodes.find(node => node.id === 'config-1')?.metadata.status).toBe('idle');
  });

  it('publishes results, connections and success atomically before history', async () => {
    const updates: WorkflowProject[] = [];
    const events: string[] = [];
    const saveHistory = vi.fn(() => { events.push('history'); });
    await runWorkflowGeneration(project(), 'config-1', {
      userApiKeys: [imageKey],
      executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' }),
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['image'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result', name: 'result.png', mimeType: 'image/png', bytes: 5 }), encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='), onProjectChange: next => { updates.push(next); events.push(next.nodes.find(node => node.id === 'config-1')?.metadata.status || 'unknown'); }, saveHistory,
    });
    const successUpdates = updates.filter(update => update.nodes.find(node => node.id === 'config-1')?.metadata.status === 'success');
    expect(successUpdates).toHaveLength(1);
    expect(successUpdates[0].nodes).toHaveLength(3);
    expect(successUpdates[0].connections).toHaveLength(2);
    expect(successUpdates[0].nodes[2].metadata).toMatchObject({ progress: 100, generationRequestId: undefined });
    expect(successUpdates[0].nodes[2].type).toBe('image');
    expect(events.indexOf('success')).toBeLessThan(events.indexOf('history'));
  });

  it('does not commit a stale result when a newer run starts during history preparation', async () => {
    const source = project();
    let latest = source;
    let releaseEncoding!: () => void;
    let markEncodingStarted!: () => void;
    const encodingStarted = new Promise<void>(resolve => { markEncodingStarted = resolve; });
    const encoding = new Promise<string>(resolve => { releaseEncoding = () => resolve('data:image/png;base64,OLD'); });
    const first = runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey],
      executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://old', mimeType: 'image/png' }), fetchMedia: vi.fn().mockResolvedValue(new Blob(['old'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'old-key', name: 'old.png', mimeType: 'image/png', bytes: 3 }), encodeDataUrl: () => { markEncodingStarted(); return encoding; }, getProject: () => latest, onProjectChange: next => { latest = next; },
    });
    await encodingStarted;
    const second = runWorkflowGeneration(latest, 'config-1', {
      userApiKeys: [imageKey], executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://new', mimeType: 'image/png' }), fetchMedia: vi.fn().mockResolvedValue(new Blob(['new'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'new-key', name: 'new.png', mimeType: 'image/png', bytes: 3 }), encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,NEW'), getProject: () => latest, onProjectChange: next => { latest = next; },
    });
    releaseEncoding();
    await Promise.all([first, second]);
    expect(latest.nodes.some(node => node.metadata.storageKey === 'old-key')).toBe(false);
    expect(latest.nodes.some(node => node.metadata.storageKey === 'new-key')).toBe(true);
  });

  it('uses a JPEG poster for video history and revokes provider blob URLs', async () => {
    const source = project();
    source.nodes[2].metadata.config = { mode: 'video', modelId: 'flovart:seedance-2' };
    const saveHistory = vi.fn();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedMediaKey('video', 'flovart:seedance-2', 'seedance-2.0', 'volcengine')],
      executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'video', mediaUrl: 'blob:provider-result', mimeType: 'video/mp4' }), fetchMedia: vi.fn().mockResolvedValue(new Blob(['video'], { type: 'video/mp4' })), ingestMedia: vi.fn().mockResolvedValue({ type: 'video', storageKey: 'video', name: 'video.mp4', mimeType: 'video/mp4', bytes: 5 }), createVideoPoster: vi.fn().mockResolvedValue(new Blob(['poster'], { type: 'image/jpeg' })), encodeDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,POSTER'), saveHistory, onProjectChange: vi.fn(),
    });
    expect(saveHistory).toHaveBeenCalledWith(expect.objectContaining({ dataUrl: 'data:image/jpeg;base64,POSTER', mimeType: 'image/jpeg', mediaType: 'video' }));
    expect(revoke).toHaveBeenCalledWith('blob:provider-result');
    revoke.mockRestore();
  });

  it('binds ordered image mentions to first and last frame roles', async () => {
    const source = project();
    source.nodes.push({ id: 'image-2', type: 'image', title: '尾帧', position: { x: 0, y: 440 }, width: 300, height: 200, metadata: { href: 'data:image/png;base64,BB==', mimeType: 'image/png' } });
    source.connections.push({ id: 'c', fromNodeId: 'image-2', toNodeId: 'config-1' });
    source.nodes[2].metadata = { prompt: '平滑转场', mentionedNodeIds: ['image-1', 'image-2'], config: { mode: 'video', submode: 'first-last-frame', modelId: 'flovart:veo-3.1' } };
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'video', mediaUrl: 'https://output/video', mimeType: 'video/mp4' });

    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedMediaKey('video', 'flovart:veo-3.1', 'veo-3.1-generate-preview', 'google')], executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['video'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'video', storageKey: 'video', name: 'video.mp4', mimeType: 'video/mp4', bytes: 5 }), createVideoPoster: vi.fn().mockResolvedValue(null), onProjectChange: vi.fn(),
    });

    expect(executeMedia.mock.calls[0][0].references).toEqual([
      expect.objectContaining({ elementId: 'image-1', slotRole: 'first_frame' }),
      expect.objectContaining({ elementId: 'image-2', slotRole: 'last_frame' }),
    ]);
  });

  it('adapts Seedance references to the selected PromptBar video mode before Provider submission', async () => {
    const run = async (submode: 'text-to-video' | 'image-to-video' | 'reference-to-video' | 'first-last-frame') => {
      const source = project();
      source.nodes.push(
        { id: 'image-2', type: 'image', title: '图片2', position: { x: 0, y: 440 }, width: 300, height: 200, metadata: { href: 'data:image/png;base64,BB==', mimeType: 'image/png' } },
        { id: 'video-1', type: 'video', title: '视频1', position: { x: 0, y: 660 }, width: 300, height: 200, metadata: { href: 'https://cdn.example.com/reference.mp4', mimeType: 'video/mp4' } },
        { id: 'audio-1', type: 'audio', title: '音频1', position: { x: 0, y: 880 }, width: 300, height: 80, metadata: { href: 'https://cdn.example.com/reference.mp3', mimeType: 'audio/mpeg' } },
      );
      source.connections.push(
        { id: 'image-2-link', fromNodeId: 'image-2', toNodeId: 'config-1' },
        { id: 'video-1-link', fromNodeId: 'video-1', toNodeId: 'config-1' },
        { id: 'audio-1-link', fromNodeId: 'audio-1', toNodeId: 'config-1' },
      );
      source.nodes[2].metadata = {
        prompt: '让角色自然运动',
        mentionedNodeIds: submode === 'text-to-video' ? []
          : submode === 'image-to-video' ? ['image-1']
            : submode === 'first-last-frame' ? ['image-1', 'image-2']
              : ['image-1', 'image-2', 'video-1', 'audio-1'],
        imageReferenceOrder: ['image-1', 'image-2', 'video-1', 'audio-1'],
        config: { mode: 'video', submode, modelId: 'flovart:seedance-2' },
      };
      const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'video', mediaUrl: 'https://output/video', mimeType: 'video/mp4' });
      await runWorkflowGeneration(source, 'config-1', {
        userApiKeys: [mappedMediaKey('video', 'flovart:seedance-2', 'doubao-seedance-2-0-260128', 'volcengine')], executeMedia,
        fetchMedia: vi.fn().mockResolvedValue(new Blob(['video'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'video', storageKey: 'video', name: 'video.mp4', mimeType: 'video/mp4', bytes: 5 }), createVideoPoster: vi.fn().mockResolvedValue(null), onProjectChange: vi.fn(),
      });
      return executeMedia.mock.calls[0]?.[0]?.references || [];
    };

    expect(await run('text-to-video')).toEqual([]);
    expect(await run('image-to-video')).toEqual([
      expect.objectContaining({ elementId: 'image-1', slotRole: 'first_frame' }),
    ]);
    expect(await run('reference-to-video')).toEqual([
      expect.objectContaining({ elementId: 'image-1', slotRole: 'reference_image' }),
      expect.objectContaining({ elementId: 'image-2', slotRole: 'reference_image' }),
      expect.objectContaining({ elementId: 'video-1', slotRole: 'reference_video' }),
      expect.objectContaining({ elementId: 'audio-1', slotRole: 'reference_audio' }),
    ]);
    expect(await run('first-last-frame')).toEqual([
      expect.objectContaining({ elementId: 'image-1', slotRole: 'first_frame' }),
      expect.objectContaining({ elementId: 'image-2', slotRole: 'last_frame' }),
    ]);
  });

  it('rejects a video PromptBar mode that the mapped Provider route cannot execute', async () => {
    const source = project();
    source.nodes[2].metadata = { prompt: '平滑转场', mentionedNodeIds: ['image-1'], config: { mode: 'video', submode: 'first-last-frame', modelId: 'flovart:kling-video-3' } };
    const executeMedia = vi.fn();
    const result = await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedMediaKey('video', 'flovart:kling-video-3', 'kling-video-3.0', 'keling')], executeMedia, onProjectChange: vi.fn(),
    });
    expect(executeMedia).not.toHaveBeenCalled();
    expect(result.nodes.find(node => node.id === 'config-1')?.metadata.error).toContain('当前 API 线路不支持首尾帧');
  });

  it('rejects first-last-frame before submission when the second image is missing', async () => {
    const source = project();
    source.nodes[2].metadata = { prompt: '平滑转场', mentionedNodeIds: ['image-1'], config: { mode: 'video', submode: 'first-last-frame', modelId: 'flovart:veo-3.1' } };
    const executeMedia = vi.fn();
    const result = await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [mappedMediaKey('video', 'flovart:veo-3.1', 'veo-3.1-generate-preview', 'google')], executeMedia, onProjectChange: vi.fn(),
    });
    expect(executeMedia).not.toHaveBeenCalled();
    expect(result.nodes.find(node => node.id === 'config-1')?.metadata.error).toContain('需要按顺序引用 2 张图片');
  });
});
