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
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='), createVideoPoster: vi.fn().mockResolvedValue(null),
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

  it('filters an actual unsupported video and audio reference from image generation', async () => {
    const source = project();
    source.nodes.push(
      { id: 'video-ref', type: 'video', title: '视频参考', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { href: 'data:video/mp4;base64,AA==', mimeType: 'video/mp4' } },
      { id: 'audio-ref', type: 'audio', title: '音频参考', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { href: 'data:audio/mp3;base64,AA==', mimeType: 'audio/mp3' } },
    );
    source.connections.push({ id: 'video-link', fromNodeId: 'video-ref', toNodeId: 'config-1' }, { id: 'audio-link', fromNodeId: 'audio-ref', toNodeId: 'config-1' });
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' });
    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [imageKey], modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' }, executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['image'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result', name: 'result.png', mimeType: 'image/png', bytes: 5 }), onProjectChange: vi.fn(), encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
    });
    const references = executeMedia.mock.calls[0][0].references;
    expect(references.some((reference: any) => reference.type === 'image')).toBe(true);
    expect(references.some((reference: any) => reference.type === 'video' || reference.type === 'audio')).toBe(false);
  });

  it('passes audio references only when the selected video capability supports the audio slot', async () => {
    const source = project();
    source.nodes[2].metadata.config = { mode: 'video', modelId: 'seedance-2.0' };
    source.nodes.push({ id: 'audio-ref', type: 'audio', title: '配乐', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { href: 'data:audio/mp3;base64,AA==', mimeType: 'audio/mp3' } });
    source.connections.push({ id: 'audio-link', fromNodeId: 'audio-ref', toNodeId: 'config-1' });
    const executeMedia = vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'video', mediaUrl: 'https://output/video', mimeType: 'video/mp4' });
    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [{ ...imageKey, provider: 'volcengine', capabilities: ['video'], customModels: ['seedance-2.0'] }], modelPreference: { textModel: '', imageModel: '', videoModel: 'seedance-2.0' }, executeMedia,
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['video'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'video', storageKey: 'video', name: 'video.mp4', mimeType: 'video/mp4', bytes: 5 }), createVideoPoster: vi.fn().mockResolvedValue(null), onProjectChange: vi.fn(),
    });
    expect(executeMedia.mock.calls[0][0].references).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'audio', slotRole: 'reference_audio' })]));
  });

  it('describes connected media by label for text generation without claiming media transport', async () => {
    const source = project();
    source.nodes[0].metadata = { prompt: '写说明', config: { mode: 'text', modelId: 'text-model' }, mentionedNodeIds: ['image-1'] };
    const executeText = vi.fn().mockResolvedValue('完成');
    await runWorkflowGeneration(source, 'text-1', {
      userApiKeys: [{ ...imageKey, capabilities: ['text'], customModels: ['text-model'] }], modelPreference: { textModel: 'text-model', imageModel: '', videoModel: '' }, executeText, onProjectChange: vi.fn(),
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
      userApiKeys: [imageKey], modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' }, executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' }), fetchMedia: vi.fn().mockResolvedValue(new Blob(['image'])),
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
      userApiKeys: [imageKey], modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' },
      executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://output/image', mimeType: 'image/png' }),
      fetchMedia: vi.fn().mockResolvedValue(new Blob(['image'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result', name: 'result.png', mimeType: 'image/png', bytes: 5 }), encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='), onProjectChange: next => { updates.push(next); events.push(next.nodes.find(node => node.id === 'config-1')?.metadata.status || 'unknown'); }, saveHistory,
    });
    const successUpdates = updates.filter(update => update.nodes.find(node => node.id === 'config-1')?.metadata.status === 'success');
    expect(successUpdates).toHaveLength(1);
    expect(successUpdates[0].nodes).toHaveLength(4);
    expect(successUpdates[0].connections).toHaveLength(3);
    expect(successUpdates[0].nodes[2].metadata).toMatchObject({ progress: 100, generationRequestId: undefined });
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
      userApiKeys: [imageKey], modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' },
      executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://old', mimeType: 'image/png' }), fetchMedia: vi.fn().mockResolvedValue(new Blob(['old'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'old-key', name: 'old.png', mimeType: 'image/png', bytes: 3 }), encodeDataUrl: () => { markEncodingStarted(); return encoding; }, getProject: () => latest, onProjectChange: next => { latest = next; },
    });
    await encodingStarted;
    const second = runWorkflowGeneration(latest, 'config-1', {
      userApiKeys: [imageKey], modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' }, executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'image', mediaUrl: 'https://new', mimeType: 'image/png' }), fetchMedia: vi.fn().mockResolvedValue(new Blob(['new'])), ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'new-key', name: 'new.png', mimeType: 'image/png', bytes: 3 }), encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,NEW'), getProject: () => latest, onProjectChange: next => { latest = next; },
    });
    releaseEncoding();
    await Promise.all([first, second]);
    expect(latest.nodes.some(node => node.metadata.storageKey === 'old-key')).toBe(false);
    expect(latest.nodes.some(node => node.metadata.storageKey === 'new-key')).toBe(true);
  });

  it('uses a JPEG poster for video history and revokes provider blob URLs', async () => {
    const source = project();
    source.nodes[2].metadata.config = { mode: 'video', modelId: 'seedance-2.0' };
    const saveHistory = vi.fn();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await runWorkflowGeneration(source, 'config-1', {
      userApiKeys: [{ ...imageKey, provider: 'volcengine', capabilities: ['video'], customModels: ['seedance-2.0'] }], modelPreference: { textModel: '', imageModel: '', videoModel: 'seedance-2.0' },
      executeMedia: vi.fn().mockResolvedValue({ ok: true, elementId: 'config-1', capability: 'video', mediaUrl: 'blob:provider-result', mimeType: 'video/mp4' }), fetchMedia: vi.fn().mockResolvedValue(new Blob(['video'], { type: 'video/mp4' })), ingestMedia: vi.fn().mockResolvedValue({ type: 'video', storageKey: 'video', name: 'video.mp4', mimeType: 'video/mp4', bytes: 5 }), createVideoPoster: vi.fn().mockResolvedValue(new Blob(['poster'], { type: 'image/jpeg' })), encodeDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,POSTER'), saveHistory, onProjectChange: vi.fn(),
    });
    expect(saveHistory).toHaveBeenCalledWith(expect.objectContaining({ dataUrl: 'data:image/jpeg;base64,POSTER', mimeType: 'image/jpeg', mediaType: 'video' }));
    expect(revoke).toHaveBeenCalledWith('blob:provider-result');
    revoke.mockRestore();
  });
});
