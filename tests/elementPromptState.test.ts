import { describe, expect, it } from 'vitest';
import type { CanvasElement, ElementGenerationState } from '../types';
import { buildAttachmentIgnitionReferences, buildElementIgnitionReferences, buildElementPromptGenerationState } from '../utils/elementPromptState';

const elements: CanvasElement[] = [
  {
    id: 'target',
    type: 'image',
    name: 'Target',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    href: 'data:image/png;base64,target',
    mimeType: 'image/png',
  },
  {
    id: 'ref',
    type: 'image',
    name: 'Reference',
    x: 360,
    y: 0,
    width: 320,
    height: 180,
    href: 'data:image/png;base64,ref',
    mimeType: 'image/png',
  },
  {
    id: 'ref_duplicate',
    type: 'video',
    name: 'Reference',
    x: 720,
    y: 0,
    width: 320,
    height: 180,
    href: 'data:video/mp4;base64,ref',
    mimeType: 'video/mp4',
  },
  {
    id: 'role_text',
    type: 'text',
    name: '角色设定',
    x: 0,
    y: 240,
    width: 240,
    height: 120,
    text: '角色A穿红色夹克，角色B穿蓝色外套。',
    fontSize: 16,
    fontColor: '#111827',
  },
];

const baseState: ElementGenerationState = {
  promptPayload: { rawText: '', resolvedReferences: [] },
  provider: 'openrouter',
  modelId: 'gpt-image-1',
  aspectRatio: '16:9',
  status: 'idle',
};

describe('buildElementPromptGenerationState', () => {
  it('updates node prompt text, rich document, and @ references atomically', () => {
    const richTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Extend ' },
            {
              type: 'canvasMention',
              attrs: {
                id: 'ref',
                label: 'Reference',
                thumbnail: 'data:image/png;base64,ref',
                elementType: 'image',
              },
            },
          ],
        },
      ],
    };

    const next = buildElementPromptGenerationState({
      currentState: baseState,
      target: elements[0],
      allElements: elements,
      modelId: 'gpt-image-1',
      aspectRatio: '16:9',
      rawText: 'Extend @Reference',
      richTextDocument,
    });

    expect(next.promptPayload.rawText).toBe('Extend @Reference');
    expect(next.promptPayload.richTextDocument).toBe(richTextDocument);
    expect(next.promptPayload.resolvedReferences).toEqual([
      { token: '@Reference', targetElementId: 'ref', targetType: 'image' },
    ]);
  });

  it('prefers rich mention ids over ambiguous @ labels', () => {
    const richTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Animate ' },
            {
              type: 'canvasMention',
              attrs: {
                id: 'ref_duplicate',
                label: 'Reference',
                thumbnail: '',
                elementType: 'video',
              },
            },
          ],
        },
      ],
    };

    const next = buildElementPromptGenerationState({
      currentState: baseState,
      target: elements[0],
      allElements: elements,
      modelId: 'gpt-image-1',
      aspectRatio: '16:9',
      rawText: 'Animate @Reference',
      richTextDocument,
    });

    expect(next.promptPayload.resolvedReferences).toEqual([
      { token: '@Reference', targetElementId: 'ref_duplicate', targetType: 'video' },
    ]);
  });

  it('packages @角色A and @文本 references with labels for model binding', () => {
    const promptPayload = {
      rawText: '让 @Reference 按照 @角色设定 的身份生成',
      resolvedReferences: [
        { token: '@Reference', targetElementId: 'ref', targetType: 'image' as const },
        { token: '@角色设定', targetElementId: 'role_text', targetType: 'text' as const },
      ],
    };

    expect(buildElementIgnitionReferences(promptPayload, elements)).toEqual([
      {
        type: 'image',
        href: 'data:image/png;base64,ref',
        mimeType: 'image/png',
        slotRole: 'unassigned',
        label: 'Reference',
        sourceName: 'Reference',
        elementId: 'ref',
      },
      {
        type: 'text',
        slotRole: 'unassigned',
        label: '角色设定',
        sourceName: '角色设定',
        text: '角色A穿红色夹克，角色B穿蓝色外套。',
        elementId: 'role_text',
      },
    ]);
  });

  it('converts node prompt uploads into ignition references for image, video, and audio', async () => {
    const refs = await buildAttachmentIgnitionReferences(
      [
        { id: 'img', name: 'ref.png', href: 'cold-media:image-ref', mimeType: 'image/png', source: 'upload' },
        { id: 'vid', name: 'ref.mp4', href: 'cold-media:video-ref', mimeType: 'video/mp4', source: 'upload' },
        { id: 'aud', name: 'ref.mp3', href: 'cold-media:audio-ref', mimeType: 'audio/mpeg', source: 'upload' },
      ],
      async href => href.replace('cold-media:', 'resolved:'),
    );

    expect(refs).toEqual([
      { type: 'image', href: 'resolved:image-ref', mimeType: 'image/png', slotRole: 'reference_image', label: 'ref.png', sourceName: 'ref.png', elementId: 'img' },
      { type: 'video', href: 'resolved:video-ref', mimeType: 'video/mp4', slotRole: 'reference_video', label: 'ref.mp4', sourceName: 'ref.mp4', elementId: 'vid' },
      { type: 'audio', href: 'resolved:audio-ref', mimeType: 'audio/mpeg', slotRole: 'reference_audio', label: 'ref.mp3', sourceName: 'ref.mp3', elementId: 'aud' },
    ]);
  });
});
