import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSkillDraft, evaluateSkillDraft, extractCanvasSubgraph, topologicalNodeOrder } from '../tools/flovart/skill-draft.js';
import { runSkillCommand } from '../tools/flovart/skill-commands.js';

// Token-shaped fixture assembled at runtime: the release secret audit scans source text,
// and this value only exists to prove the subgraph export redacts credentials.
const FAKE_KEY = 'sk-' + 'abcdefghijklmnopqrstuvwx';
const project = {
  id: 'proj-1',
  nodes: [
    { id: 'ref', type: 'image', title: '参考图', metadata: {} },
    { id: 'prompt', type: 'text', title: '主提示词', metadata: { content: '奶蛙表情包，扁平风格' } },
    { id: 'gen', type: 'image', title: '生成', metadata: { prompt: '按参考生成 4 张 emoji ' + FAKE_KEY, config: { model: 'seedream-v5' } } },
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
    expect(draft.files['references/canvas-subgraph.json']).not.toContain(FAKE_KEY);
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

  it('skill.draft --from-project reads any Workspace project (history canvases included) plus its receipts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flovart-skill-project-'));
    const requests = [];
    const workspace = {
      async execute(command, args) {
        requests.push({ command, args });
        return { ok: true, commandId: 'c1', result: { ...project, id: args.projectId } };
      },
      async request(url) {
        requests.push({ url });
        return { ok: true, projectId: 'proj-old', receipts: [
          { kind: 'task', title: '生成奶蛙 emoji 系列', at: '2026-11-01T00:00:01Z' },
          { kind: 'decision', title: '选 51ae 为风格参考', at: '2026-11-01T00:00:00Z' },
        ] };
      },
    };
    try {
      const drafted = await runSkillCommand('skill.draft', { id: 'community.old-canvas', projectDir: root, fromProject: 'proj-old', nodeIds: ['ref', 'prompt', 'gen'] }, { workspace });
      expect(drafted.ok).toBe(true);
      expect(drafted.evaluation.ok).toBe(true);
      expect(requests[0]).toEqual({ command: 'workflow.inspect', args: { projectId: 'proj-old' } });
      expect(String(requests[1].url)).toContain('projectId=proj-old');
      const skillMd = await fs.readFile(path.join(drafted.dir, 'SKILL.md'), 'utf8');
      expect(skillMd.indexOf('选 51ae')).toBeLessThan(skillMd.indexOf('生成奶蛙'));
      const manifest = await fs.readFile(path.join(drafted.dir, 'flovart.skill.yaml'), 'utf8');
      expect(manifest).toContain('flovart-session:proj-old');
      expect(manifest).not.toContain(FAKE_KEY);
      const receiptsResult = await runSkillCommand('receipts.list', { projectId: 'proj-old' }, { workspace });
      expect(receiptsResult.receipts).toHaveLength(2);
      const both = await runSkillCommand('skill.draft', { id: 'community.x', projectDir: root, fromProject: 'a', fromSnapshot: 'b' }, { workspace });
      expect(both.error.code).toBe('INVALID_ARGUMENT');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
