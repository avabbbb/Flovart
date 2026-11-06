import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { buildCanonicalGenerationInput, resolveWorkflowInputs } from '../components/workflow/inputResolver';
import { createPromptIntent } from '../components/workflow/promptIntent';
import { executeUnifiedIgnition } from '../services/aiGateway';
import type { ProviderMaterializedReference } from '../services/providerGenerationAdapter';
import { getProviderCapabilities, serializeProviderGenerationRequest, validateCanonicalProviderInput } from '../services/providerGenerationAdapter';

function canonicalVideo(
  productModelId: 'flovart:veo-3.1' | 'flovart:kling-video-3',
  submode: 'image-to-video' | 'reference-to-video',
  sources: Array<{ id: string; type: 'image' | 'audio'; role?: 'source_image' | 'source_audio' }>,
) {
  const sourceNodes = sources.map(source => createWorkflowNode(source.id, source.type, { x: 0, y: 0 }, {
    href: source.type === 'image' ? `https://cdn.example.com/${source.id}.png` : `https://cdn.example.com/${source.id}.mp3`,
    mimeType: source.type === 'image' ? 'image/png' : 'audio/mpeg',
  }));
  const target = createWorkflowNode('target', 'video', { x: 420, y: 0 }, { config: { mode: 'video', submode: submode, modelId: productModelId } });
  const connections = sources.map(source => ({ id: `${source.id}-edge`, fromNodeId: source.id, toNodeId: target.id, role: source.role }));
  const inputs = resolveWorkflowInputs(target, [...sourceNodes, target], connections);
  return buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: '让画面动起来', mode: 'video', submode });
}

describe('provider generation adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('declares route capabilities and serializes canonical references one-to-one', () => {
    const canonical = canonicalVideo('flovart:veo-3.1', 'image-to-video', [{ id: 'first', type: 'image', role: 'source_image' }]);
    const context = { provider: 'google' as const, productModelId: 'flovart:veo-3.1', routeId: 'veo-3.1-generate-preview' };
    const capabilities = getProviderCapabilities(context, canonical.parameters.generationSubmode);
    const validation = validateCanonicalProviderInput(canonical, context);
    const references: ProviderMaterializedReference[] = canonical.references.map(reference => ({
      resourceId: reference.resource.resourceId,
      type: reference.resource.kind,
      href: `blob:${reference.resource.resourceId}`,
      mimeType: reference.resource.mimeType,
      role: reference.role,
      label: reference.label,
    }));
    const request = serializeProviderGenerationRequest(canonical, references, context);

    expect(capabilities.supportedCapabilities).toContain('image-to-video');
    expect(capabilities.maxReferences.image).toBe(1);
    expect(validation).toMatchObject({ ok: true });
    expect(request).toMatchObject({
      capability: 'image-to-video',
      modelId: 'veo-3.1-generate-preview',
      generationSubmode: 'image-to-video',
      references: [{ resourceId: 'first:output:0', type: 'image', role: 'first_frame', href: 'blob:first:output:0' }],
    });
  });

  it('rejects unsupported media instead of dropping it or falling back to text-to-video', () => {
    const canonical = canonicalVideo('flovart:veo-3.1', 'reference-to-video', [
      { id: 'image', type: 'image' },
      { id: 'audio', type: 'audio', role: 'source_audio' },
    ]);
    const validation = validateCanonicalProviderInput(canonical, { provider: 'google', productModelId: 'flovart:veo-3.1', routeId: 'veo-3.1-generate-preview' });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNSUPPORTED_REFERENCE_KIND', kind: 'audio' }),
    ]));
  });

  it('rejects a reference count that the selected route cannot consume', () => {
    const canonical = canonicalVideo('flovart:kling-video-3', 'image-to-video', [
      { id: 'first', type: 'image' },
      { id: 'second', type: 'image' },
    ]);
    const validation = validateCanonicalProviderInput(canonical, { provider: 'keling', productModelId: 'flovart:kling-video-3', routeId: 'kling-video-3.0' });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'REFERENCE_LIMIT_EXCEEDED', kind: 'image', max: 1 }),
    ]));
  });

  it('preserves first/last/reference/character roles from PromptIntent through the wire serializer', () => {
    const sourceIds = ['first', 'last', 'reference', 'character'] as const;
    const sources = sourceIds.map(id => createWorkflowNode(id, 'image', { x: 0, y: 0 }, {
      href: `https://cdn.example.com/${id}.png`,
      mimeType: 'image/png',
    }));
    const target = createWorkflowNode('target', 'video', { x: 420, y: 0 }, {
      config: { mode: 'video', submode: 'reference-to-video', modelId: 'flovart:seedance-2' },
    });
    const intent = createPromptIntent({
      targetNodeId: target.id,
      text: '角色在场景中移动',
      mentions: sourceIds.map((id, index) => ({
        id,
        elementType: 'image',
        role: (['first_frame', 'last_frame', 'reference', 'character'] as const)[index],
      })),
      requestedAction: 'generate',
    });
    const connections = sourceIds.map(id => ({ id: `${id}-edge`, fromNodeId: id, toNodeId: target.id }));
    const inputs = resolveWorkflowInputs(target, [...sources, target], connections, { promptIntent: intent });
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: inputs.prompt, mode: 'video', submode: 'reference-to-video' });
    const materialized: ProviderMaterializedReference[] = canonical.references.map(reference => ({
      resourceId: reference.resource.resourceId,
      type: reference.resource.kind,
      href: `blob:${reference.resource.resourceId}`,
      mimeType: reference.resource.mimeType,
      role: reference.role,
      label: reference.label,
      elementId: reference.resource.sourceNodeId,
      order: reference.order,
    }));
    const request = serializeProviderGenerationRequest(canonical, materialized, {
      provider: 'volcengine',
      productModelId: 'flovart:seedance-2',
      routeId: 'doubao-seedance-2-0-260128',
    });

    expect(validateCanonicalProviderInput(canonical, request)).toMatchObject({ ok: true });
    expect(request.references.map(reference => ({ role: reference.role, slotRole: reference.slotRole }))).toEqual([
      { role: 'first_frame', slotRole: 'first_frame' },
      { role: 'last_frame', slotRole: 'last_frame' },
      { role: 'reference', slotRole: 'reference_image' },
      { role: 'character', slotRole: 'reference_image' },
    ]);
    expect(request.references.every(reference => reference.href.startsWith('blob:'))).toBe(true);
  });

  it('rejects an image edit capability when the mapped image route is text-only', () => {
    const source = createWorkflowNode('source', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/source.png', mimeType: 'image/png' });
    const target = createWorkflowNode('target', 'image', { x: 420, y: 0 }, { config: { mode: 'image', submode: 'image-to-image', modelId: 'flovart:imagen-4' } });
    const inputs = resolveWorkflowInputs(target, [source, target], [{ id: 'edge', fromNodeId: source.id, toNodeId: target.id }]);
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: '修改构图', mode: 'image', submode: 'image-to-image' });
    const validation = validateCanonicalProviderInput(canonical, { provider: 'google', productModelId: 'flovart:imagen-4', routeId: 'imagen-4' });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY', capability: 'image-edit' }),
    ]));
  });

  it('blocks a canonical video input before the gateway can submit a silent fallback', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const result = await executeUnifiedIgnition({
      elementId: 'target',
      prompt: '让画面动起来',
      modelId: 'kling-video-3.0',
      productModelId: 'flovart:kling-video-3',
      generationCapability: 'image-to-video',
      generationSubmode: 'image-to-video',
      apiKeyPayload: { id: 'keling-key', provider: 'keling', capabilities: ['video'], key: 'secret', createdAt: 0, updatedAt: 0 },
      references: [
        { type: 'image', href: 'data:image/png;base64,QUJD', mimeType: 'image/png', slotRole: 'first_frame' },
        { type: 'image', href: 'data:image/png;base64,REVG', mimeType: 'image/png', slotRole: 'reference_image' },
      ],
    });

    expect(result).toMatchObject({ ok: false, errorMessage: '当前 AI 服务最多接收 1 个 @图片 参考' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries a canonical image edit through the final multipart request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [{ b64_json: 'ZmFrZQ==' }] }),
      text: () => Promise.resolve('{"data":[{"b64_json":"ZmFrZQ=="}]}'),
      headers: { get: () => 'application/json' },
    });
    globalThis.fetch = fetchMock;
    // 走 executeUnifiedIgnition 会带上进度回调；jsdom 的 XHR 绕过 fetch mock，这里去掉 XHR 让上传走 fetch。
    vi.stubGlobal('XMLHttpRequest', undefined);
    const result = await executeUnifiedIgnition({
      elementId: 'target',
      prompt: '修改构图',
      modelId: 'gpt-image-2',
      productModelId: 'flovart:gpt-image-2',
      generationCapability: 'image-edit',
      generationSubmode: 'image-to-image',
      apiKeyPayload: { id: 'openai-key', provider: 'openai', capabilities: ['image'], key: 'secret', createdAt: 0, updatedAt: 0 },
      references: [{ type: 'image', href: 'data:image/png;base64,QUJD', mimeType: 'image/png', slotRole: 'reference_image' }],
    });

    const request = fetchMock.mock.calls[0];
    const body = request?.[1]?.body as FormData;
    expect(result).toMatchObject({ ok: true, capability: 'image' });
    expect(request?.[0]).toBe('https://api.openai.com/v1/images/edits');
    expect(body).toBeInstanceOf(FormData);
    expect(body.getAll('image')).toHaveLength(1);
    expect(body.get('model')).toBe('gpt-image-2');
  });
});
