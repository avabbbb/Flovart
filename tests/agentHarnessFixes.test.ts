// Agent harness 修复（2026-11-20 trace review）：
// P0-A 改提示词静默丢参考 / 写入后不变量；P0-B 写工具返回最终 revision；P1-C reorder_connections 无操作；
// P1-D 参考用途（purpose）与显式顺序；inspect 暴露参考顺序与媒体时长。
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowDispatcher, withWorkflowHumanApproval, type WorkflowDispatcherDependencies } from '../services/workflowDispatcher';
import { checkGenerateInvariant, planWorkflowGenerate } from '../services/workflowGenerateCommand';
import { createWorkflowProject } from '../components/workflow/store';
import { createWorkflowNode } from '../components/workflow/constants';
import { extractMentions } from '../components/MediaMentionExtension';
import { buildCanonicalGenerationInput, resolveWorkflowInputs } from '../components/workflow/inputResolver';
import { describeReferencePurposes } from '../components/workflow/referencePurpose';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import type { WorkflowProject } from '../components/workflow/types';

const setup = (options: { runNode?: (deps: { bump: () => void }) => unknown } = {}) => {
  let projects: WorkflowProject[] = [createWorkflowProject('harness')];
  projects[0].nodes = [
    { ...createWorkflowNode('img-subject', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/s.png', storageKey: 's', mimeType: 'image/png' }), title: '主体' },
    { ...createWorkflowNode('img-bg', 'image', { x: 0, y: 400 }, { href: 'https://cdn.example.com/b.png', storageKey: 'b', mimeType: 'image/png' }), title: '背景' },
    { ...createWorkflowNode('clip', 'video', { x: 0, y: 800 }, { href: 'https://cdn.example.com/c.mp4', storageKey: 'c', mimeType: 'video/mp4', durationMs: 12_340, naturalWidth: 1920, naturalHeight: 1080 }), title: '源片' },
  ];
  const dependencies: WorkflowDispatcherDependencies = {
    getState: () => ({ projects, activeProjectId: projects[0].id }),
    createProject: () => { throw new Error('unused'); },
    setActiveProject: () => {},
    deleteProjects: () => {},
    updateProject: (id, patch) => { projects = projects.map(project => project.id === id ? { ...project, ...patch } : project); },
    getUserApiKeys: () => [],
  };
  // 模拟浏览器运行时：运行中挂生成记录、写回结果，各推进一次 draftVersion（prepareWorkflowImageGenerateRun / 结果写回）。
  const bump = () => { projects = projects.map(project => ({ ...project, draftVersion: (project.draftVersion || 1) + 1 })); };
  const runNode = vi.fn(async () => {
    bump();
    const out = options.runNode?.({ bump });
    bump();
    return out ?? { artifact: { artifactId: 'a', kind: 'image', mimeType: 'image/png' } };
  });
  dependencies.executor = createWorkflowExecutor({ runNode: runNode as never, stopNode: vi.fn() }, { createRunId: () => 'run-1' });
  const project = () => dependencies.getState().projects[0];
  return { dispatch: createWorkflowDispatcher(dependencies), project, runNode };
};

type GenerateBody = { nodeId: string; draftVersion: number; model: { submode: string }; references: Array<{ nodeId: string; order: number; purpose?: string }>; referenceSource: string; warnings?: Array<{ code: string }> };

async function createTwoRefNode(dispatch: ReturnType<typeof setup>['dispatch']) {
  const result = await dispatch({
    id: 'g1', command: 'workflow.generate', source: 'agent', idempotencyKey: 'g1',
    args: { type: 'image', prompt: '@图片1 站在 @图片2 的街景里', references: [{ nodeId: 'img-subject', purpose: 'subject' }, { nodeId: 'img-bg', purpose: 'background' }] },
  });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  return result.result as GenerateBody;
}

describe('P0-A: editing a prompt never silently drops references', () => {
  it('keeps the node references, order and purposes when references is omitted', async () => {
    const { dispatch, project } = setup();
    const first = await createTwoRefNode(dispatch);
    const edited = await dispatch({ id: 'g2', command: 'workflow.generate', source: 'agent', idempotencyKey: 'g2', args: { nodeId: first.nodeId, prompt: '主体换成红色外套' } });
    expect(edited.ok, JSON.stringify(edited.error)).toBe(true);
    const body = edited.result as GenerateBody;
    expect(body.model.submode).toBe('image-to-image');
    expect(body.referenceSource).toBe('inherited');
    expect(body.references.map(item => [item.nodeId, item.order, item.purpose])).toEqual([['img-subject', 1, 'subject'], ['img-bg', 2, 'background']]);
    expect(body.warnings).toBeUndefined();
    const node = project().nodes.find(item => item.id === first.nodeId)!;
    expect(node.metadata.config?.submode).toBe('image-to-image');
    expect(extractMentions(node.metadata.richTextDocument!).map(item => [item.id, item.purpose])).toEqual([['img-subject', 'subject'], ['img-bg', 'background']]);
  });

  it('warns and refuses run=true when explicit references omit existing ones; dropReferences=true disconnects them', async () => {
    const { dispatch, project, runNode } = setup();
    const first = await createTwoRefNode(dispatch);
    const partial = await dispatch({ id: 'g3', command: 'workflow.generate', source: 'agent', idempotencyKey: 'g3', args: { nodeId: first.nodeId, prompt: '只保留主体', references: ['img-subject'] } });
    expect(partial.ok).toBe(true);
    expect((partial.result as GenerateBody).warnings?.map(item => item.code)).toContain('REFERENCES_DROPPED');

    const run = await dispatch(withWorkflowHumanApproval({ id: 'g4', command: 'workflow.generate', source: 'agent', idempotencyKey: 'g4', args: { nodeId: first.nodeId, prompt: '只保留主体', references: ['img-subject'], run: true } }));
    expect(run.ok).toBe(false);
    expect(run.error?.code, JSON.stringify(run.error)).toBe('GENERATE_INVARIANT_FAILED');
    expect((run.error?.details?.issues as Array<{ code: string }>).map(item => item.code)).toContain('REFERENCES_DROPPED');
    expect(runNode).not.toHaveBeenCalled();

    const dropped = await dispatch({ id: 'g5', command: 'workflow.generate', source: 'agent', idempotencyKey: 'g5', args: { nodeId: first.nodeId, prompt: '只保留主体', references: ['img-subject'], dropReferences: true } });
    expect(dropped.ok).toBe(true);
    expect((dropped.result as GenerateBody).warnings).toBeUndefined();
    expect(project().connections.filter(item => item.toNodeId === first.nodeId).map(item => item.fromNodeId)).toEqual(['img-subject']);
  });

  it('rejects a text-to-* submode that would ignore the references before writing', async () => {
    const { dispatch, project } = setup();
    const first = await createTwoRefNode(dispatch);
    const before = project().draftVersion;
    const result = await dispatch({ id: 'g6', command: 'workflow.generate', source: 'agent', idempotencyKey: 'g6', args: { nodeId: first.nodeId, prompt: '改', submode: 'text-to-image' } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'SUBMODE_REFERENCE_MISMATCH', details: { suggestedSubmode: 'image-to-image', referenceIds: ['img-subject', 'img-bg'] } });
    expect(project().draftVersion).toBe(before);
  });

  it('the post-write invariant reports lost references, wrong submode and order with structured details', async () => {
    const { project } = setup();
    const nodes = project().nodes;
    const plan = planWorkflowGenerate({ nodes, connections: [], args: { type: 'image', prompt: 'x', references: ['img-subject', 'img-bg'] }, mutationId: 'm', keys: [], place: () => ({ x: 0, y: 0 }) });
    const target = { ...createWorkflowNode(plan.nodeId, 'image', { x: 0, y: 0 }), metadata: { prompt: 'x', config: { mode: 'image', submode: 'text-to-image', modelId: plan.model.modelId } } } as never;
    const issues = checkGenerateInvariant(plan, { nodes: [...nodes, target], connections: [{ id: 'c1', fromNodeId: 'img-bg', toNodeId: plan.nodeId }, { id: 'c2', fromNodeId: 'img-subject', toNodeId: plan.nodeId }] }, { references: ['img-subject', 'img-bg'] });
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['SUBMODE_MISMATCH', 'REFERENCE_NOT_IN_PROMPT', 'REFERENCE_ORDER_MISMATCH']));
    const lost = checkGenerateInvariant({ ...plan, references: [], model: { ...plan.model, submode: 'text-to-image' } }, { nodes: [...nodes, target], connections: [] }, { references: ['img-subject'] });
    expect(lost.map(issue => issue.code)).toContain('REFERENCES_LOST');
  });
});

describe('P0-B: write tools return the final revision', () => {
  it('chained generate(run) → generate → apply → node.run reuse the returned draftVersion without conflicts', async () => {
    const { dispatch, project, runNode } = setup();
    const first = await createTwoRefNode(dispatch);
    expect(first.draftVersion).toBe(project().draftVersion);

    const ran = await dispatch(withWorkflowHumanApproval({ id: 'r1', command: 'workflow.generate', source: 'agent', idempotencyKey: 'r1', args: { nodeId: first.nodeId, prompt: '雨夜', run: true, expectedRevision: first.draftVersion } }));
    expect(ran.ok, JSON.stringify(ran.error)).toBe(true);
    expect(runNode).toHaveBeenCalledTimes(1);
    const ranBody = ran.result as GenerateBody & { committedDraftVersion?: number };
    // 运行又推进了两次版本：返回的是最终版本，而不是提交提示词时的版本。
    expect(ranBody.draftVersion).toBe(project().draftVersion);
    expect(ranBody.committedDraftVersion).toBe(project().draftVersion - 2);

    const edit = await dispatch({ id: 'r2', command: 'workflow.generate', source: 'agent', idempotencyKey: 'r2', args: { nodeId: first.nodeId, prompt: '雨夜，霓虹', expectedRevision: ranBody.draftVersion } });
    expect(edit.ok, JSON.stringify(edit.error)).toBe(true);
    const editVersion = (edit.result as GenerateBody).draftVersion;
    expect(editVersion).toBe(project().draftVersion);

    const moved = await dispatch({ id: 'r3', command: 'workflow.apply', source: 'agent', args: { projectId: project().id, mutationId: 'mv', expectedRevision: editVersion, operations: [{ type: 'move_nodes', positions: [{ id: first.nodeId, position: { x: 900, y: 0 } }] }] } });
    expect(moved.ok, JSON.stringify(moved.error)).toBe(true);
    const moveVersion = (moved.result as { draftVersion: number }).draftVersion;
    expect(moveVersion).toBe(project().draftVersion);

    const rerun = await dispatch(withWorkflowHumanApproval({ id: 'r4', command: 'workflow.node.run', source: 'agent', idempotencyKey: 'r4', args: { projectId: project().id, nodeId: first.nodeId, expectedRevision: moveVersion } }));
    expect(rerun.ok, JSON.stringify(rerun.error)).toBe(true);
    // node.run 以前不带版本号；现在带最终版本，下一次写入可以直接用。
    expect((rerun.result as { draftVersion: number }).draftVersion).toBe(project().draftVersion);
    const after = await dispatch({ id: 'r5', command: 'workflow.apply', source: 'agent', args: { projectId: project().id, mutationId: 'mv2', expectedRevision: (rerun.result as { draftVersion: number }).draftVersion, operations: [{ type: 'move_nodes', positions: [{ id: first.nodeId, position: { x: 950, y: 0 } }] }] } });
    expect(after.ok, JSON.stringify(after.error)).toBe(true);
  });
});

describe('P1-C: reorder_connections', () => {
  it('an already-ordered reorder is a no-op success (dryRun too), not 「ops 至少包含一个 Document Operation」', async () => {
    const { dispatch, project } = setup();
    const first = await createTwoRefNode(dispatch);
    const op = { type: 'reorder_connections', targetNodeId: first.nodeId, orderedSourceIds: ['img-subject', 'img-bg'] };
    const dry = await dispatch({ id: 'o1', command: 'workflow.apply', source: 'agent', args: { projectId: project().id, mutationId: 'o1', expectedRevision: first.draftVersion, dryRun: true, operations: [op] } });
    expect(dry.ok, JSON.stringify(dry.error)).toBe(true);
    expect(dry.result).toMatchObject({ noop: true, applied: false, dryRun: true, noopOperations: [{ index: 0, targetNodeId: first.nodeId }] });
    const real = await dispatch({ id: 'o2', command: 'workflow.apply', source: 'agent', args: { projectId: project().id, mutationId: 'o2', expectedRevision: first.draftVersion, operations: [op] } });
    expect(real.ok, JSON.stringify(real.error)).toBe(true);
    expect(real.result).toMatchObject({ noop: true, draftVersion: first.draftVersion });
  });

  it('dryRun previews the new order; real run swaps chip order; connection ids get a clear hint', async () => {
    const { dispatch, project } = setup();
    const first = await createTwoRefNode(dispatch);
    const op = { type: 'reorder_connections', targetNodeId: first.nodeId, orderedSourceIds: ['img-bg', 'img-subject'] };
    const dry = await dispatch({ id: 'o3', command: 'workflow.apply', source: 'agent', args: { projectId: project().id, mutationId: 'o3', expectedRevision: first.draftVersion, dryRun: true, operations: [op] } });
    expect(dry.ok, JSON.stringify(dry.error)).toBe(true);
    expect((dry.result as { referenceOrder: Record<string, string[]> }).referenceOrder[first.nodeId]).toEqual(['img-bg', 'img-subject']);
    const real = await dispatch({ id: 'o4', command: 'workflow.apply', source: 'agent', args: { projectId: project().id, mutationId: 'o4', expectedRevision: first.draftVersion, operations: [op] } });
    expect(real.ok, JSON.stringify(real.error)).toBe(true);
    expect(project().connections.filter(item => item.toNodeId === first.nodeId).map(item => item.fromNodeId)).toEqual(['img-bg', 'img-subject']);

    const connectionIds = project().connections.filter(item => item.toNodeId === first.nodeId).map(item => item.id);
    const wrong = await dispatch({ id: 'o5', command: 'workflow.apply', source: 'agent', args: { projectId: project().id, mutationId: 'o5', expectedRevision: project().draftVersion, dryRun: true, operations: [{ type: 'reorder_connections', targetNodeId: first.nodeId, orderedSourceIds: connectionIds }] } });
    expect(wrong.ok).toBe(false);
    expect(wrong.error?.message).toMatch(/上游节点 id，不是连接 id/);

    // ids 写法只需列出目标节点的入边，不必列出全画布的连接。
    const byIds = await dispatch({ id: 'o6', command: 'workflow.apply', source: 'agent', args: { projectId: project().id, mutationId: 'o6', expectedRevision: project().draftVersion, operations: [{ type: 'reorder_connections', ids: [...connectionIds].reverse() }] } });
    expect(byIds.ok, JSON.stringify(byIds.error)).toBe(true);
    expect(project().connections.filter(item => item.toNodeId === first.nodeId).map(item => item.fromNodeId)).toEqual(['img-subject', 'img-bg']);
  });
});

describe('P1-D: reference purpose and explicit order', () => {
  it('orders references by explicit order and sends a purpose legend to the provider prompt', async () => {
    const { dispatch, project } = setup();
    const result = await dispatch({
      id: 'p1', command: 'workflow.generate', source: 'agent', idempotencyKey: 'p1',
      args: { type: 'image', prompt: '海报', references: [{ nodeId: 'img-bg', purpose: 'background', order: 2 }, { nodeId: 'img-subject', purpose: 'subject', order: 1 }] },
    });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const body = result.result as GenerateBody;
    expect(body.references.map(item => item.nodeId)).toEqual(['img-subject', 'img-bg']);
    const target = project().nodes.find(node => node.id === body.nodeId)!;
    const inputs = resolveWorkflowInputs(target, project().nodes, project().connections);
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: target.metadata.prompt || '', mode: 'image', submode: 'image-to-image' });
    expect(canonical.references.map(item => [item.resource.sourceNodeId, item.purpose])).toEqual([['img-subject', 'subject'], ['img-bg', 'background']]);
    expect(canonical.prompt).toContain('参考说明：图片1=主体，图片2=背景');
    expect(canonical.prompt).toContain('image 1 = main subject');

    const inspected = await dispatch({ id: 'p2', command: 'workflow.inspect', source: 'agent', args: { projectId: project().id, nodeId: body.nodeId } });
    expect((inspected.result as { references: unknown[] }).references).toEqual([
      expect.objectContaining({ order: 1, nodeId: 'img-subject', label: '图片1', purpose: 'subject' }),
      expect.objectContaining({ order: 2, nodeId: 'img-bg', label: '图片2', purpose: 'background' }),
    ]);
  });

  it('keeps old prompts unchanged when no purpose is declared and rejects unknown purposes', async () => {
    expect(describeReferencePurposes([{ kind: 'image' }, { kind: 'image' }])).toBe('');
    expect(describeReferencePurposes([{ kind: 'image' }, { kind: 'video', purpose: 'style' }])).toContain('视频1=风格');
    const { dispatch } = setup();
    const bad = await dispatch({ id: 'p3', command: 'workflow.generate', source: 'agent', idempotencyKey: 'p3', args: { type: 'image', prompt: 'x', references: [{ nodeId: 'img-bg', purpose: 'mood' }] } });
    expect(bad.ok).toBe(false);
    expect(bad.error?.message).toMatch(/purpose 不支持/);
  });
});

describe('inspect media timing', () => {
  it('exposes a video duration and size in inspect node / summary', async () => {
    const { dispatch, project } = setup();
    const node = await dispatch({ id: 'i1', command: 'workflow.inspect', source: 'agent', args: { projectId: project().id, nodeId: 'clip' } });
    expect((node.result as { media: unknown }).media).toEqual({ durationSec: 12.3, width: 1920, height: 1080 });
    const summary = await dispatch({ id: 'i2', command: 'workflow.inspect', source: 'agent', args: { projectId: project().id, summary: true } });
    expect((summary.result as { nodes: Array<{ id: string; durationSec?: number }> }).nodes.find(item => item.id === 'clip')?.durationSec).toBe(12.3);
  });
});

import { describeSceneCuts, detectSceneCuts, frameSignatureFromRgba, planCompareLayout } from '../services/agentFrameGrid';

describe('P2-H / timing: compare layout and coarse scene cuts', () => {
  it('lays panels out side by side at one height within the max edge', () => {
    const layout = planCompareLayout([{ width: 1024, height: 1024 }, { width: 1536, height: 864 }], 2048, 8, 28);
    expect(layout.panels).toHaveLength(2);
    expect(layout.panels[0].height).toBe(layout.panels[1].height);
    expect(layout.width).toBeLessThanOrEqual(2048);
    expect(layout.panels[1].x).toBe(layout.panels[0].width + 8);
    expect(layout.height).toBe(layout.panels[0].height + 28);
  });

  it('flags a cut between sampled frames whose luma changes sharply', () => {
    const dark = frameSignatureFromRgba(new Array(64).fill([10, 10, 10, 255]).flat());
    const bright = frameSignatureFromRgba(new Array(64).fill([240, 240, 240, 255]).flat());
    const cuts = detectSceneCuts([0, 2, 4, 6], [dark, dark, bright, bright]);
    expect(cuts).toEqual([{ from: 2, to: 4, score: expect.any(Number) }]);
    expect(describeSceneCuts(6, [0, 2, 4, 6], cuts)).toMatch(/1 处疑似切镜 0:02.*0:04/);
    expect(describeSceneCuts(6, [0, 2, 4, 6], [])).toMatch(/没有明显切镜/);
  });
});

import { describeModelCost, inferCostTier, modelCostTier } from '../services/modelCostTier';
import { listWorkflowModels } from '../services/workflowGenerateCommand';
import type { UserApiKey } from '../types';

describe('P2-F: cost tiers and unknown-cost reasons', () => {
  it('gives every model a cost tier and real price ranges from configured pricing rules', () => {
    expect(modelCostTier('flovart:veo-3.1-lite')).toBe('cheap');
    expect(modelCostTier('flovart:veo-3.1')).toBe('premium');
    expect(inferCostTier('rh:wan-2.5-fast')).toBe('cheap');
    expect(inferCostTier('rh:some-model')).toBe('standard');
    const key = { id: 'k', provider: 'runningHub', capabilities: ['video'], key: 's', models: [], createdAt: 1, updatedAt: 1,
      pricingRules: [
        { id: 'p1', productModelId: 'flovart:veo-3.1', unit: 'video_second', rate: 0.2, currency: 'USD', source: 'manual', resolution: '720p' },
        { id: 'p2', productModelId: 'flovart:veo-3.1', unit: 'video_second', rate: 0.4, currency: 'USD', source: 'manual', resolution: '1080p' },
      ] } as unknown as UserApiKey;
    expect(describeModelCost('flovart:veo-3.1', [key])).toEqual({ costTier: 'premium', costTierBasis: 'family-position', priceRange: { min: 0.2, max: 0.4, currency: 'USD', unit: 'video_second', source: 'manual' } });
    const listed = listWorkflowModels({ mode: 'video', includeUnavailable: true }, []);
    expect(listed.models.every(model => ['cheap', 'standard', 'premium'].includes(model.costTier))).toBe(true);
    expect(listed.costTierNote).toMatch(/省钱档/);
  });

  it('cost.estimate explains why the amount is unknown and still reports the tier', async () => {
    const { dispatch, project } = setup();
    const first = await createTwoRefNode(dispatch);
    const estimate = await dispatch({ id: 'c1', command: 'workflow.cost.estimate', source: 'agent', args: { projectId: project().id, nodeIds: [first.nodeId] } });
    expect(estimate.ok, JSON.stringify(estimate.error)).toBe(true);
    const body = estimate.result as { items: Array<{ estimatedCost: unknown; costUnknownReason?: string; costTier: string }>; costHint?: string; total: { cost: unknown } };
    expect(body.items[0]).toMatchObject({ estimatedCost: null, costUnknownReason: 'no-key', costTier: expect.stringMatching(/cheap|standard|premium/) });
    expect(body.costHint).toMatch(/API Key/);
  });
});
