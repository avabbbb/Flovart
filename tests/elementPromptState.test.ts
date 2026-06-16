import { describe, expect, it } from 'vitest';
import type { CanvasElement, ElementGenerationState } from '../types';
import { buildElementPromptGenerationState } from '../utils/elementPromptState';

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
});
