import { describe, expect, it } from 'vitest';
import { buildProjectLedger, renderProjectLedger } from '../components/workflow/projectLedger';
import type { WorkflowNode } from '../components/workflow/types';

const node = (id: string, patch: Partial<WorkflowNode> & { metadata?: Record<string, unknown> } = {}): WorkflowNode => ({
  id, type: 'image', title: id, position: { x: 0, y: 0 }, width: 100, height: 100, ...patch, metadata: { ...(patch.metadata || {}) },
} as WorkflowNode);

const project = {
  nodes: [
    node('hero', { title: '林夏', anchor: { kind: 'character', approved: true, approvedAt: '2026-11-01T00:00:00Z' }, metadata: { href: 'x', prompt: '短发少女，雨衣', generationRequestId: 'g1', alternates: [{}, {}] } }),
    node('street', { title: '雨夜街道', anchor: { kind: 'scene', approved: true, approvedAt: '2026-11-02T00:00:00Z' }, metadata: { href: 'x' } }),
    node('prop', { title: '旧相机', anchor: { kind: 'product', approved: false } }),
    node('s1', { type: 'video', title: '镜头 1', shot: { index: 1, durationSec: 5, anchorNodeIds: ['hero', 'street'] }, metadata: { storageKey: 'k', prompt: '林夏走进雨里', generationRequestId: 'g2' } }),
    node('s2', { type: 'video', title: '镜头 2', shot: { index: 2, durationSec: 5 }, metadata: { status: 'error', error: '余额不足' } }),
    node('note', { type: 'text', title: '备注', metadata: { content: '更暗' } }),
  ],
  connections: [],
};

describe('project ledger', () => {
  it('builds anchor quick-ref, shot table and asset index from the workflow', () => {
    const ledger = buildProjectLedger(project);
    expect(ledger.anchors).toEqual([
      { code: 'A01', nodeId: 'hero', title: '林夏', kind: 'character' },
      { code: 'S01', nodeId: 'street', title: '雨夜街道', kind: 'scene' },
    ]);
    expect(ledger.pendingAnchors).toEqual([{ nodeId: 'prop', title: '旧相机', kind: 'product' }]);
    expect(ledger.shots).toEqual([
      { index: 1, nodeId: 's1', title: '镜头 1', durationSec: 5, anchorCodes: ['A01', 'S01'], status: 'done' },
      { index: 2, nodeId: 's2', title: '镜头 2', durationSec: 5, anchorCodes: [], status: 'error' },
    ]);
    expect(ledger.assets.map(asset => asset.nodeId)).toEqual(['hero', 'street', 's1']);
    expect(ledger.assets[0]).toMatchObject({ anchorCode: 'A01', generated: true, alternateCount: 2, promptPreview: '短发少女，雨衣' });
    expect(ledger.assets[1].generated).toBe(false);
    expect(ledger.totals).toMatchObject({ anchors: 2, pendingAnchors: 1, shots: 2, durationSec: 10, assets: { image: 2, video: 1 }, failed: 1, running: 0 });
  });

  it('renders a compact text the model can re-read', () => {
    const text = renderProjectLedger(buildProjectLedger(project));
    expect(text).toContain('- A01 角色「林夏」→ hero');
    expect(text).toContain('待批准：道具「旧相机」(prop)');
    expect(text).toContain('- 第 1 镜「镜头 1」5s [A01+S01] done → s1');
    expect(text).toContain('已有资产（image 2，video 1）');
    expect(text).toContain('状态：失败 1，生成中 0');
    expect(renderProjectLedger(buildProjectLedger(project), { maxAssets: 1 })).toContain('还有 2 个');
    expect(renderProjectLedger(buildProjectLedger({ nodes: [] }))).toContain('没有已批准的锚点');
  });
});
