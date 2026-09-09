import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { hostSelectionReference, hostSelectionResource } from '../services/studio/studioContract';
import { buildStudioReferenceOperations } from '../services/studio/studioWorkflow';
import type { WorkflowProject } from '../components/workflow/types';

const project: WorkflowProject = {
  id: 'project-1',
  title: '广告',
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
  nodes: [createWorkflowNode('existing', 'text', { x: 0, y: 0 }, { content: 'brief' })],
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots',
  agentSessions: [],
  activeAgentSessionId: null,
  draftVersion: 4,
};

const selection = {
  host: 'photoshop' as const,
  selectionId: 'layer-7',
  label: 'Hero Layer',
  kind: 'image' as const,
  locator: { documentId: 'doc-1', layerId: 7 },
  mimeType: 'image/png',
};

describe('Studio host contract', () => {
  it('maps a host selection to the existing provider-neutral resource/reference types', () => {
    const resource = hostSelectionResource(selection);
    expect(resource.locator).toEqual({ kind: 'creative-host', host: 'photoshop', locator: selection.locator });
    expect(hostSelectionReference(selection, resource)).toMatchObject({
      resourceId: resource.resourceId,
      resourceOrigin: 'creative-host',
      sourceId: 'layer-7',
      source: 'manual',
    });
  });

  it('builds one shared Workflow mutation with a host reference and an I2I target', () => {
    let id = 0;
    const graph = buildStudioReferenceOperations(project, selection, '做成夜景产品海报', () => `fixed-${++id}`);
    expect(graph.operations).toHaveLength(2);
    expect(graph.operations[0]).toMatchObject({
      type: 'add_node',
      node: { type: 'image', metadata: { resourceLocator: { kind: 'creative-host', host: 'photoshop' } } },
    });
    expect(graph.operations[1]).toMatchObject({
      type: 'create_connected_node',
      fromNodeId: 'fixed-1',
      node: { type: 'image', metadata: { prompt: '做成夜景产品海报', config: { mode: 'image', submode: 'image-to-image' } } },
    });
  });

  it('lets a materialized frame change the resource kind without changing host selection identity', () => {
    const graph = buildStudioReferenceOperations(
      project,
      { ...selection, kind: 'video', selectionId: 'clip-1', locator: { projectId: 'project-1', clipId: 'clip-1' } },
      '生成当前帧海报',
      () => 'fixed-id',
      { ...hostSelectionResource(selection), resourceId: 'creative-host:premiere:clip-1:frame', kind: 'image', mimeType: 'image/png' },
    );
    expect(graph.operations[0]).toMatchObject({ type: 'add_node', node: { type: 'image' } });
    expect(graph.operations[0]).not.toMatchObject({ node: { type: 'video' } });
  });
});
