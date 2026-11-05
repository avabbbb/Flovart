import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSkillDraft, evaluateSkillDraft, extractCanvasSubgraph, topologicalNodeOrder } from '../tools/flovart/skill-draft.js';
import { runSkillCommand } from '../tools/flovart/skill-commands.js';

const project = {
  id: 'proj-1',
  nodes: [
    { id: 'ref', type: 'image', title: '参考图', metadata: {} },
    { id: 'prompt', type: 'text', title: '主提示词', metadata: { content: '奶蛙表情包，扁平风格' } },
    { id: 'gen', type: 'image', title: '生成', metadata: { prompt: '按参考生成 4 张 emoji sk-abcdefghijklmnopqrstuvwx', config: { model: 'seedream-v5' } } },
    { id: 'other', type: 'video', title: '无关节点', metadata: {} },
  ],
  connections: [
    { fromNodeId: 'ref', toNodeId: 'gen' },
    { fromNodeId: 'prompt', toNodeId: 'gen' },
    { fromNodeId: 'gen', toNodeId: 'other' },
  ],
};
const receipts = [
  { kind: 'decision', title: '选 51ae 为风格参考', createdAt: 'seq-2' },
  { kind: 'task', title: '生成奶蛙 emoji 系列', summary: '图生图 4 张', createdAt: 'seq-1' },
  { kind: 'note', title: '不应出现在步骤里', createdAt: 'seq-3' },
];

describe('skill draft from session', () => {
  it('builds a package from receipts and a canvas subgraph and passes basic evaluation', () => {
    const draft = buildSkillDraft({ id: 'community.nawa-emoji', name: '奶蛙表情包', projectId: 'proj-1', project, receipts, nodeIds: ['ref', 'prompt', 'gen'] });
    expect(draft.subgraph.nodes.map(node => node.id)).toEqual(['ref', 'prompt', 'gen']);
    expect(draft.subgraph.connections).toHaveLength(2);
    expect(draft.files['SKILL.md']).toContain('1. 生成奶蛙 emoji 系列：图生图 4 张');
    expect(draft.files['SKILL.md']).toContain('2. （决策）选 51ae 为风格参考');
    expect(draft.files['SKILL.md']).not.toContain('不应出现在步骤里');
    expect(draft.files['flovart.skill.yaml']).toContain('  - image.generate');
    expect(draft.files['flovart.skill.yaml']).toContain('id: references');
    expect(draft.files['references/canvas-subgraph.json']).toContain('[redacted]');
    const evaluation = evaluateSkillDraft(draft.files, 'community.nawa-emoji');
    expect(evaluation.checks.filter(item => !item.ok)).toEqual([]);
    expect(evaluation.ok).toBe(true);
  });

  it('rejects empty, cyclic or tampered drafts', () => {
    const empty = buildSkillDraft({ id: 'community.empty', project: { nodes: [] } });
    expect(evaluateSkillDraft(empty.files).ok).toBe(false);
    const cyclic = { nodes: [{ id: 'a' }, { id: 'b' }], connections: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] };
    expect(topologicalNodeOrder(cyclic)).toBeNull();
    const draft = buildSkillDraft({ id: 'community.ok', project });
    const tampered = { ...draft.files, 'SKILL.md': draft.files['SKILL.md'] + '\napi_key: abc123' };
    const result = evaluateSkillDraft(tampered);
    expect(result.ok).toBe(false);
    expect(result.checks.find(item => item.id === 'no-secrets').ok).toBe(false);
  });

  it('keeps only connections inside the chosen nodes', () => {
    expect(extractCanvasSubgraph(project, ['gen', 'other']).connections).toEqual([{ from: 'gen', to: 'other' }]);
  });

  it('skill.draft writes the draft and installs only after evaluation passes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flovart-skill-draft-'));
    try {
      const snapshotPath = path.join(root, 'snapshot.json');
      await fs.writeFile(snapshotPath, JSON.stringify({ projectId: 'proj-1', project, receipts }), 'utf8');
      const drafted = await runSkillCommand('skill.draft', { id: 'community.nawa-emoji', projectDir: root, fromSnapshot: snapshotPath, nodes: 'ref,prompt,gen' });
      expect(drafted.ok).toBe(true);
      expect(drafted.evaluation.ok).toBe(true);
      expect(drafted.installed).toBeUndefined();
      const installed = await runSkillCommand('skill.draft', { id: 'community.nawa-emoji', projectDir: root, fromSnapshot: snapshotPath, dir: path.join(root, 'draft-2'), install: true });
      expect(installed.ok).toBe(true);
      expect(installed.installed).toBe(true);
      const listed = await runSkillCommand('skill.list', { projectDir: root });
      expect(JSON.stringify(listed)).toContain('community.nawa-emoji');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
