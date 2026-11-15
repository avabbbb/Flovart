import { describe, expect, it, vi } from 'vitest';
import { canvasSkillDraftPayload, canvasSkillId, ManagedSkillRegistryClient } from '../services/localSkillRegistry';

const project = {
  id: 'proj-old',
  nodes: [
    { id: 'a', type: 'text', title: '主题', metadata: { content: '奶蛙表情包' } },
    { id: 'b', type: 'image', title: '生成', metadata: { prompt: '扁平风格', href: 'data:image/png;base64,AAAA', storageKey: 'k1', config: { model: 'seedream' } } },
    { id: 'c', type: 'image', title: '无关', metadata: { prompt: 'blob:http://x/1' } },
  ],
  connections: [
    { id: 'e1', fromNodeId: 'a', toNodeId: 'b' },
    { id: 'e2', fromNodeId: 'b', toNodeId: 'c' },
  ],
};

describe('canvas → Skill draft payload', () => {
  it('sends only prompts, titles and config for the chosen nodes, never media or storage keys', () => {
    const payload = canvasSkillDraftPayload(project, ['a', 'b']);
    expect(payload.nodes.map(node => node.id)).toEqual(['a', 'b']);
    expect(payload.connections).toEqual([{ fromNodeId: 'a', toNodeId: 'b' }]);
    expect(JSON.stringify(payload)).not.toMatch(/data:|storageKey|k1|blob:/);
    expect(payload.nodes[1].metadata.config).toEqual({ model: 'seedream' });
    expect(canvasSkillId(0)).toMatch(/^community\.canvas-[0-9a-z]+$/);
  });

  it('posts the draft to the local Agent and returns its evaluation', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
      ok: true,
      installed: true,
      evaluation: { ok: true, checks: [] },
      draft: { id: 'community.canvas-1', handle: 'canvas-1', files: ['SKILL.md'] },
      skill: { id: 'community.canvas-1' },
      echo: JSON.parse(String(init?.body)),
    })));
    const client = new ManagedSkillRegistryClient({ url: 'http://127.0.0.1:1', token: 't' } as never, fetcher as never);
    const result = await client.draftFromCanvas({ id: 'community.canvas-1', name: '奶蛙', install: true, ...canvasSkillDraftPayload(project) });
    expect(result.installed).toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:1/api/skills/draft');
    const sent = JSON.parse(String(init?.body));
    expect(sent.project.id).toBe('proj-old');
    expect(sent.project.nodes).toHaveLength(3);
    expect(sent.install).toBe(true);
  });
});
