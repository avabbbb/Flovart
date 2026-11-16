import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowOps } from '../components/workflow/ops';
import { promptDocumentMentions } from '../components/workflow/promptDocument';
import {
  buildScriptMaterializeOps,
  migrateScriptShot,
  parseScriptRows,
  scriptShotPrompt,
  ScriptMaterializeError,
} from '../components/workflow/scriptMaterialize';
import type { ScriptShot, WorkflowNode, WorkflowSnapshot } from '../components/workflow/types';

function makeScript(shots: ScriptShot[]): WorkflowNode {
  const node = createWorkflowNode('script-1', 'script', { x: 0, y: 0 });
  return { ...node, metadata: { ...node.metadata, scriptBreakdown: { assets: [], shots } } };
}

const hero = { ...createWorkflowNode('anchor-hero', 'image', { x: -600, y: 0 }), title: '女主' };
const street = { ...createWorkflowNode('anchor-street', 'image', { x: -600, y: 400 }), title: '街景' };
const note = { ...createWorkflowNode('note-1', 'text', { x: -600, y: 800 }), metadata: { content: '备注' } };

const shots: ScriptShot[] = [
  { id: 's1', index: 0, action: '女主推门', shotSize: '中景', lighting: '黄昏逆光', characterRefs: ['anchor-hero'], imagePrompt: 'hero opens the door', videoPrompt: 'hero pushes the door open slowly' },
  { id: 's2', index: 1, scene: '街道', action: '回头', imagePromptOverride: 'legacy image prompt @ref:anchor-street', videoPromptOverride: 'legacy video prompt' },
  { id: 's3', index: 2, action: '', scene: '' },
  { id: 's4', index: 3, action: '奔跑', characterRefs: ['anchor-hero', 'note-1', 'missing'] },
];

let counter = 0;
const createId = () => 'id' + (++counter);
const snapshotOf = (nodes: WorkflowNode[]): WorkflowSnapshot => ({ projectId: 'p', title: 't', nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } });

describe('parseScriptRows', () => {
  it('parses ranges, lists and defaults to all rows', () => {
    expect(parseScriptRows(undefined, 3)).toEqual([1, 2, 3]);
    expect(parseScriptRows('all', 2)).toEqual([1, 2]);
    expect(parseScriptRows('1-3,5', 6)).toEqual([1, 2, 3, 5]);
    expect(parseScriptRows('3，1', 6)).toEqual([1, 3]);
    expect(parseScriptRows([2, 2, 1], 3)).toEqual([1, 2]);
    expect(() => parseScriptRows('0-2', 3)).toThrow(ScriptMaterializeError);
    expect(() => parseScriptRows('7', 3)).toThrow(/超出范围/);
    expect(() => parseScriptRows('a', 3)).toThrow(/看不懂/);
  });
});

describe('script shot prompt + migration', () => {
  it('reads new fields first, then legacy overrides, then composes a draft', () => {
    expect(scriptShotPrompt(shots[0], 'image')).toBe('hero opens the door');
    expect(scriptShotPrompt(shots[1], 'video')).toBe('legacy video prompt');
    expect(scriptShotPrompt({ id: 'x', index: 0, shotSize: '特写', scene: '雨夜', action: '点烟', camera: '推镜' }, 'image')).toBe('特写, 雨夜, 点烟');
    expect(scriptShotPrompt({ id: 'x', index: 0, shotSize: '特写', scene: '雨夜', action: '点烟', camera: '推镜' }, 'video')).toBe('特写, 推镜, 雨夜, 点烟');
  });

  it('migrates *Override into imagePrompt / videoPrompt and drops the legacy keys', () => {
    const migrated = migrateScriptShot(shots[1]);
    expect(migrated.imagePrompt).toBe('legacy image prompt @ref:anchor-street');
    expect(migrated.videoPrompt).toBe('legacy video prompt');
    expect('imagePromptOverride' in migrated).toBe(false);
    expect(migrateScriptShot({ id: 'y', index: 0, imagePrompt: 'new', imagePromptOverride: 'old' }).imagePrompt).toBe('new');
  });
});

describe('buildScriptMaterializeOps', () => {
  it('creates one generation node per row with Prompt Bar document, anchor chips + connections, shot meta and back-links', () => {
    counter = 0;
    const script = makeScript(shots);
    const nodes = [script, hero, street, note];
    const result = buildScriptMaterializeOps(script, { kind: 'image', rows: '1-4', nodes, connections: [], createId });
    expect(result.created.map(item => item.row)).toEqual([1, 2, 4]);
    expect(result.skipped).toEqual([{ row: 3, shotId: 's3', reason: 'EMPTY_PROMPT' }]);
    expect(result.diagnostics.map(item => item.code).sort()).toEqual(['ANCHOR_IS_NOTE', 'ANCHOR_NOT_FOUND']);

    const applied = applyWorkflowOps(snapshotOf(nodes), result.operations);
    expect(applied.rejections).toEqual([]);
    const after = applied.snapshot;

    const first = after.nodes.find(node => node.id === result.created[0].nodeId)!;
    expect(first.type).toBe('image');
    expect(first.title).toBe('分镜 1');
    expect(first.metadata.prompt).toBe('hero opens the door @图片1');
    expect(promptDocumentMentions(first.metadata.richTextDocument).map(item => item.id)).toEqual(['anchor-hero']);
    expect(first.shot).toMatchObject({ index: 1, shotSize: '中景', lighting: '黄昏逆光', anchorNodeIds: ['anchor-hero'], scriptNodeId: 'script-1', scriptShotId: 's1' });
    expect(after.connections.some(c => c.fromNodeId === 'anchor-hero' && c.toNodeId === first.id)).toBe(true);
    expect(after.connections.some(c => c.fromNodeId === 'script-1' && c.toNodeId === first.id)).toBe(true);

    // 旧 Override 里的 @ref:<id> 自动连线成 chip
    const second = after.nodes.find(node => node.id === result.created[1].nodeId)!;
    expect(result.created[1].autoLinked).toEqual(['anchor-street']);
    expect(second.metadata.prompt).toBe('legacy image prompt @图片1');
    expect(after.connections.some(c => c.fromNodeId === 'anchor-street' && c.toNodeId === second.id)).toBe(true);

    // 文本节点（备注）绝不进入参考
    const fourth = after.nodes.find(node => node.id === result.created[2].nodeId)!;
    expect(after.connections.some(c => c.fromNodeId === 'note-1' && c.toNodeId === fourth.id)).toBe(false);
    expect(fourth.metadata.prompt).toBe('奔跑 @图片1');

    const breakdown = after.nodes.find(node => node.id === 'script-1')!.metadata.scriptBreakdown!;
    expect(breakdown.shots.map(shot => shot.imageNodeId)).toEqual([result.created[0].nodeId, result.created[1].nodeId, undefined, result.created[2].nodeId]);
    expect(breakdown.shots[1].imagePrompt).toBe('legacy image prompt @ref:anchor-street');
    expect('imagePromptOverride' in breakdown.shots[1]).toBe(false);

    // 默认只建不跑：节点 idle，同批成组
    expect(first.metadata.status).toBe('idle');
    expect(new Set(result.created.map(item => after.nodes.find(node => node.id === item.nodeId)!.batchId)).size).toBe(1);
  });

  it('skips rows that already have a live node of the same kind and only takes requested rows', () => {
    counter = 100;
    const existing = createWorkflowNode('img-existing', 'image', { x: 500, y: 0 });
    const script = makeScript([{ ...shots[0], imageNodeId: 'img-existing' }, shots[1]]);
    const result = buildScriptMaterializeOps(script, { kind: 'image', rows: '1-2', nodes: [script, existing, hero, street], connections: [], createId });
    expect(result.skipped).toEqual([{ row: 1, shotId: 's1', reason: 'ALREADY_MATERIALIZED', nodeId: 'img-existing' }]);
    expect(result.created.map(item => item.row)).toEqual([2]);
    expect(result.batchId).toBeUndefined();
  });

  it('video kind uses videoPrompt and accepts image anchors; image kind refuses video anchors', () => {
    counter = 200;
    const clip = createWorkflowNode('clip', 'video', { x: -600, y: 1200 });
    const script = makeScript([{ ...shots[0], characterRefs: ['anchor-hero', 'clip'] }]);
    const nodes = [script, hero, clip];
    const video = buildScriptMaterializeOps(script, { kind: 'video', nodes, connections: [], createId });
    expect(video.created[0].references).toEqual(['anchor-hero', 'clip']);
    const applied = applyWorkflowOps(snapshotOf(nodes), video.operations);
    expect(applied.rejections).toEqual([]);
    const node = applied.snapshot.nodes.find(item => item.id === video.created[0].nodeId)!;
    expect(node.type).toBe('video');
    expect(node.metadata.prompt?.startsWith('hero pushes the door open slowly')).toBe(true);
    expect(applied.snapshot.nodes.find(item => item.id === 'script-1')!.metadata.scriptBreakdown!.shots[0].videoNodeId).toBe(node.id);

    const image = buildScriptMaterializeOps(script, { kind: 'image', nodes, connections: [], createId });
    expect(image.created[0].references).toEqual(['anchor-hero']);
    expect(image.diagnostics.map(item => item.code)).toEqual(['ANCHOR_KIND_UNSUPPORTED']);
  });

  it('rejects non-script nodes and empty scripts', () => {
    expect(() => buildScriptMaterializeOps(hero, { kind: 'image', nodes: [hero], connections: [], createId })).toThrow(/不是脚本节点/);
    const empty = makeScript([]);
    expect(() => buildScriptMaterializeOps(empty, { kind: 'image', nodes: [empty], connections: [], createId })).toThrow(/没有分镜行/);
  });
});
