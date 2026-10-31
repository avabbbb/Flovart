import { describe, expect, it } from 'vitest';

import type { WorkflowProject } from '../components/workflow/types';
import {
  applyAgentTurnPreamble,
  buildAgentTurnPreamble,
  normalizeSkillSlug,
  recipeFromNodes,
  skillFromRecipe,
} from '../services/canvasSkillRecipe';

const node = (id: string, type: string, title: string, x: number, y: number, metadata: Record<string, unknown> = {}) => ({
  id, type, title, position: { x, y }, width: 240, height: 200, metadata,
});

const project = {
  nodes: [
    node('video', 'video', '视频C', 0, 320, { productModelId: 'kling-3', mode: 'image-to-video', prompt: '镜头推进', duration: 5, aspectRatio: '16:9', internal: 'skip' }),
    node('image', 'image', '图片B', 400, 12, { model: 'seedream-4', prompt: '赛博城市夜景', aspectRatio: '9:16' }),
    node('outline', 'text', '大纲A', 0, 0, { text: '一个关于雨夜的故事' }),
    node('outside', 'image', '外部D', 900, 900),
  ],
  connections: [
    { id: 'c1', fromNodeId: 'outline', toNodeId: 'image' },
    { id: 'c2', fromNodeId: 'outside', toNodeId: 'video', order: 2 },
    { id: 'c3', fromNodeId: 'image', toNodeId: 'video', order: 1 },
  ],
} as unknown as Pick<WorkflowProject, 'nodes' | 'connections'>;

describe('buildAgentTurnPreamble', () => {
  it('is empty for the default mode without a preferred model', () => {
    expect(buildAgentTurnPreamble({ creationMode: 'all' })).toBe('');
    expect(applyAgentTurnPreamble('你好', { creationMode: 'all', preferredModel: null })).toBe('你好');
  });

  it('emits mode and preferred model as one bracketed line', () => {
    expect(buildAgentTurnPreamble({ creationMode: 'video', preferredModel: { capability: 'video', name: 'Kling 3.0' } }))
      .toBe('[创作模式: 视频创作] [首选视频模型: Kling 3.0]');
    expect(buildAgentTurnPreamble({ creationMode: 'all', preferredModel: { capability: 'image', name: 'Seedream 4' } }))
      .toBe('[首选图片模型: Seedream 4]');
  });

  it('prepends the preamble to the outgoing text', () => {
    expect(applyAgentTurnPreamble('做一张海报', { creationMode: 'image' })).toBe('[创作模式: 图片创作]\n做一张海报');
    expect(applyAgentTurnPreamble('', { creationMode: 'storyboard' })).toBe('[创作模式: 剧本分镜]');
  });
});

describe('recipeFromNodes', () => {
  it('orders steps by layout rows and records model, mode, params and upstream inputs', () => {
    const recipe = recipeFromNodes(project, ['video', 'image', 'outline', 'missing']);
    expect(recipe.steps.map(step => step.nodeId)).toEqual(['outline', 'image', 'video']);
    expect(recipe.layout).toEqual({ columns: 2 });
    expect(recipe.steps[0]).toMatchObject({ type: 'text', title: '大纲A', prompt: '一个关于雨夜的故事', inputs: [] });
    expect(recipe.steps[1]).toMatchObject({ model: 'seedream-4', params: { aspectRatio: '9:16' }, inputs: ['大纲A'] });
    expect(recipe.steps[2]).toEqual({
      nodeId: 'video',
      type: 'video',
      title: '视频C',
      model: 'kling-3',
      mode: 'image-to-video',
      prompt: '镜头推进',
      params: { duration: 5, aspectRatio: '16:9' },
      inputs: ['图片B', '外部D'],
    });
  });
});

describe('skillFromRecipe', () => {
  it('builds a user skill with a numbered replay prompt', () => {
    const recipe = recipeFromNodes(project, ['outline', 'image', 'video']);
    const skill = skillFromRecipe(recipe, { name: '雨夜短片', slug: '/Rain Night!', description: '三步复刻' }, { id: 'mine.test', createdAt: 'created-at-1' });
    expect(skill).toMatchObject({ id: 'mine.test', name: '雨夜短片', slug: 'rain-night', description: '三步复刻', createdAt: 'created-at-1', recipe });
    const lines = skill.prompt.split('\n');
    expect(lines[0]).toContain('雨夜短片');
    expect(lines[1].startsWith('1. 创建文本节点「大纲A」')).toBe(true);
    expect(lines[2]).toContain('模型 seedream-4');
    expect(lines[3].startsWith('3. 创建视频节点「视频C」')).toBe(true);
    expect(lines[3]).toContain('输入：图片B、外部D');
    expect(lines[4]).toContain('2 列');
  });

  it('normalizes slugs and falls back when empty', () => {
    expect(normalizeSkillSlug('  分镜 Remix  ')).toBe('分镜-remix');
    expect(normalizeSkillSlug('!!!')).toBe('skill');
  });
});
