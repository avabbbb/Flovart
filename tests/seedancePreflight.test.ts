import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSeedanceReference, describeSeedanceFailures, isSeedanceModel, seedanceBatchPreflight, seedanceImageFormat } from '../services/seedancePreflight';
import { buildGenerationPlanChecks, seedancePreflightForNodes } from '../services/generationPlan';
import { createWorkflowDispatcher } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import { useWorkflowStore } from '../components/workflow/store';
import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';

const image = (extra: Record<string, unknown> = {}) => ({ title: 'ref', kind: 'image', mimeType: 'image/png', width: 1024, height: 768, bytes: 1_000_000, ...extra });

describe('checkSeedanceReference', () => {
  it('passes a compliant image and ignores non-image references', () => {
    expect(checkSeedanceReference(image())).toEqual([]);
    expect(checkSeedanceReference({ title: 'v', kind: 'video', width: 10, height: 10 })).toEqual([]);
  });

  it('flags each rule independently', () => {
    expect(checkSeedanceReference(image({ mimeType: 'image/heic' })).map(i => i.code)).toEqual(['SEEDANCE_FORMAT']);
    expect(checkSeedanceReference(image({ width: 299, height: 400 })).map(i => i.code)).toEqual(['SEEDANCE_SIDE_TOO_SMALL']);
    expect(checkSeedanceReference(image({ width: 6001, height: 4000 })).map(i => i.code)).toEqual(['SEEDANCE_SIDE_TOO_LARGE']);
    expect(checkSeedanceReference(image({ width: 3000, height: 1000 })).map(i => i.code)).toEqual(['SEEDANCE_ASPECT']);
    expect(checkSeedanceReference(image({ width: 390, height: 1000 })).map(i => i.code)).toEqual(['SEEDANCE_ASPECT']);
    expect(checkSeedanceReference(image({ bytes: 30 * 1024 * 1024 })).map(i => i.code)).toEqual(['SEEDANCE_TOO_LARGE']);
  });

  it('accepts the boundaries', () => {
    expect(checkSeedanceReference(image({ width: 300, height: 300 }))).toEqual([]);
    expect(checkSeedanceReference(image({ width: 6000, height: 2400 }))).toEqual([]);
    expect(checkSeedanceReference(image({ width: 400, height: 1000 }))).toEqual([]);
    expect(checkSeedanceReference(image({ bytes: 30 * 1024 * 1024 - 1 }))).toEqual([]);
  });

  it('does not judge unknown size, bytes or format', () => {
    expect(checkSeedanceReference({ title: 'x', kind: 'image' })).toEqual([]);
  });

  it('derives format from mime, data url or extension', () => {
    expect(seedanceImageFormat({ mimeType: 'image/jpg' })).toBe('jpeg');
    expect(seedanceImageFormat({ name: 'https://a/b/c.TIF?x=1' })).toBe('tiff');
    expect(seedanceImageFormat({ name: 'data:image/avif;base64,AA' })).toBe('avif');
    expect(seedanceImageFormat({})).toBeUndefined();
  });
});

describe('seedanceBatchPreflight', () => {
  it('fails the whole batch and lists every bad node', () => {
    const result = seedanceBatchPreflight([
      { nodeId: 'a', title: '镜头1', references: [image()] },
      { nodeId: 'b', title: '镜头2', references: [image({ width: 100, height: 100 })] },
      { nodeId: 'c', title: '镜头3', references: [image({ mimeType: 'image/svg+xml' })] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures.map(f => f.nodeId)).toEqual(['b', 'c']);
    const text = describeSeedanceFailures(result);
    expect(text).toContain('整批未提交');
    expect(text).toContain('「镜头2」(b)');
    expect(text).toContain('「镜头3」(c)');
  });

  it('isSeedanceModel matches catalog ids', () => {
    expect(isSeedanceModel('flovart:seedance-2-fast')).toBe(true);
    expect(isSeedanceModel('flovart:gpt-image-2')).toBe(false);
    expect(isSeedanceModel(undefined)).toBe(false);
  });
});

function seedanceProject(refMeta: Record<string, unknown>): WorkflowProject {
  return {
    id: 'p1', title: 't',
    nodes: [
      { id: 'img-ok', type: 'image', title: '好图', position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { href: 'data:image/png;base64,AA==', mimeType: 'image/png', naturalWidth: 1024, naturalHeight: 768, bytes: 1000 } },
      { id: 'img-bad', type: 'image', title: '坏图', position: { x: 0, y: 300 }, width: 300, height: 200, metadata: { href: 'data:image/png;base64,AA==', mimeType: 'image/png', ...refMeta } },
      { id: 'v1', type: 'video', title: '镜头1', position: { x: 400, y: 0 }, width: 300, height: 200, metadata: { prompt: 'a', config: { mode: 'video', modelId: 'flovart:seedance-2' } } },
      { id: 'v2', type: 'video', title: '镜头2', position: { x: 400, y: 300 }, width: 300, height: 200, metadata: { prompt: 'b', config: { mode: 'video', modelId: 'flovart:seedance-2' } } },
    ] as WorkflowNode[],
    connections: [
      { id: 'c1', fromNodeId: 'img-ok', toNodeId: 'v1' },
      { id: 'c2', fromNodeId: 'img-bad', toNodeId: 'v2' },
    ],
    selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 },
  } as unknown as WorkflowProject;
}

describe('seedance preflight integration', () => {
  afterEach(() => { useWorkflowStore.setState({ projects: [], activeProjectId: null }); });

  it('resolves references from connected nodes and blocks only the bad node', () => {
    const project = seedanceProject({ naturalWidth: 200, naturalHeight: 200 });
    const result = seedancePreflightForNodes(project.nodes.filter(n => n.type === 'video'), project);
    expect(result.failures.map(f => f.nodeId)).toEqual(['v2']);
    const checks = buildGenerationPlanChecks({ node: project.nodes[3], project, keys: [], mode: 'video' });
    expect(checks.blockers.map(b => b.code)).toContain('seedance-compliance');
    const ok = buildGenerationPlanChecks({ node: project.nodes[2], project, keys: [], mode: 'video' });
    expect(ok.blockers.map(b => b.code)).not.toContain('seedance-compliance');
  });

  it('dispatcher refuses the whole batch without running any node', async () => {
    const project = seedanceProject({ naturalWidth: 7000, naturalHeight: 4000 });
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    const runNode = vi.fn(async () => ({ status: 'completed' as const }));
    const dispatch = createWorkflowDispatcher({
      getState: () => useWorkflowStore.getState() as never,
      createProject: title => useWorkflowStore.getState().createProject(title),
      setActiveProject: id => useWorkflowStore.getState().setActiveProject(id),
      deleteProjects: ids => useWorkflowStore.getState().deleteProjects(ids),
      updateProject: (id, patch) => useWorkflowStore.getState().updateProject(id, patch),
      executor: createWorkflowExecutor({ runNode }),
    });
    const result = await dispatch({ id: 'b', command: 'workflow.node.run', args: { projectId: project.id, nodeIds: 'v1,v2' }, source: 'cli' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('SEEDANCE_PREFLIGHT_FAILED');
    expect(result.error?.message).toContain('「镜头2」(v2)');
    expect(runNode).not.toHaveBeenCalled();
  });
});
