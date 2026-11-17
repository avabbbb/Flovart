import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowGenerationConfig, WorkflowNode } from '../components/workflow/types';
import { buildPreferenceEvent, clearPreferenceEvents, exportPreferenceEventsJsonl, listPreferenceEvents, recordPreferenceEvent } from '../services/preferenceEvents';
import { exportPreferencePairs, preferenceEventErrors } from '../eval/aigc/lib/preferences.mjs';

function owner(): WorkflowNode {
  const node = createWorkflowNode('n1', 'image', { x: 0, y: 0 }, {
    href: 'data:image/png;base64,AAAA', storageKey: 'sk-primary', prompt: '红色开业海报', config: { modelId: 'model-a' } as WorkflowGenerationConfig, status: 'success',
  });
  return {
    ...node,
    metadata: {
      ...node.metadata,
      alternates: [
        { id: 'alt-1', type: 'image', batchId: 'b1', batchIndex: 1, metadata: { href: 'blob:x', storageKey: 'sk-1', prompt: '红色开业海报', config: { modelId: 'model-a' } as WorkflowGenerationConfig } },
        { id: 'alt-2', type: 'image', batchId: 'b1', batchIndex: 2, metadata: { storageKey: 'sk-2' } },
        { id: 'alt-old', type: 'image', batchId: 'b0', metadata: { storageKey: 'sk-0' } },
      ],
    },
  };
}

describe('preference events from 设为首图', () => {
  it('records chosen, the outgoing primary and same-batch siblings, without media', () => {
    const event = buildPreferenceEvent(owner(), 'alt-1', { now: new Date('2026-11-17T03:00:00Z'), projectId: 'p1' })!;
    expect(event).toMatchObject({
      nodeId: 'n1', projectId: 'p1', batchId: 'b1', mediaType: 'image', actor: 'user',
      chosen: { id: 'alt-1', type: 'image' },
      rejected: [{ id: 'n1', type: 'image' }, { id: 'alt-2', type: 'image' }],
      prompt: '红色开业海报', model: 'model-a', time: '2026-11-17T03:00:00.000Z',
    });
    const text = JSON.stringify(event);
    expect(text).not.toMatch(/base64|blob:|sk-/);
    expect(preferenceEventErrors(event)).toEqual([]);
    expect(buildPreferenceEvent(owner(), 'missing')).toBeNull();
  });

  it('persists locally, exports JSONL that the eval exporter turns into pairs', async () => {
    await clearPreferenceEvents();
    await recordPreferenceEvent(buildPreferenceEvent(owner(), 'alt-1', { id: 'e1' })!);
    await recordPreferenceEvent(buildPreferenceEvent(owner(), 'alt-2', { id: 'e2', now: new Date(Date.now() + 1000) })!);
    expect((await listPreferenceEvents()).map(event => event.id)).toEqual(['e1', 'e2']);
    const jsonl = await exportPreferenceEventsJsonl();
    const events = jsonl.trim().split('\n').map(line => JSON.parse(line));
    const { pairs, truth } = exportPreferencePairs(events);
    // Latest choice for node n1 wins: alt-2 over n1 and alt-1.
    expect(pairs.map(pair => pair.id).sort()).toEqual(['e2:alt-1', 'e2:n1']);
    for (const pair of pairs) expect(truth[pair.id] === 'A' ? pair.refs.a : pair.refs.b).toBe('alt-2');
    await clearPreferenceEvents();
    expect(await listPreferenceEvents()).toEqual([]);
  });
});
