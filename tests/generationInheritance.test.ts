import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowGenerationConfig } from '../components/workflow/types';
import { inheritGenerationConfig } from '../services/generationInheritance';

const node = (config?: WorkflowGenerationConfig) => createWorkflowNode('n-' + (config?.modelId || 'none'), 'image', { x: 0, y: 0 }, config ? { config } : {});

describe('inheritGenerationConfig', () => {
  it('returns undefined when no same-mode candidate has a config', () => {
    expect(inheritGenerationConfig('image', [])).toBeUndefined();
    expect(inheritGenerationConfig('image', [undefined, node()])).toBeUndefined();
    expect(inheritGenerationConfig('video', [node({ mode: 'image', modelId: 'm1' })])).toBeUndefined();
  });

  it('copies model and style params from the first same-mode candidate', () => {
    const result = inheritGenerationConfig('image', [
      node({ mode: 'text', modelId: 'txt' }),
      node({ mode: 'image', modelId: 'm1', aspectRatio: '9:16', resolution: '2K', styleId: 'ink' }),
      node({ mode: 'image', modelId: 'm2' }),
    ]);
    expect(result).toEqual({ mode: 'image', modelId: 'm1', aspectRatio: '9:16', resolution: '2K', styleId: 'ink' });
  });

  it('never inherits per-run state', () => {
    const result = inheritGenerationConfig('image', [node({ mode: 'image', modelId: 'm1', count: 4, seedanceRefs: { imageRefs: ['a'], videoRefs: [], audioRefs: [] }, operationParameters: { x: 1 } })]);
    expect(result).toEqual({ mode: 'image', modelId: 'm1' });
  });
});
