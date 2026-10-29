import { describe, expect, it } from 'vitest';
import { WORKFLOW_TEMPLATES, buildWorkflowTemplate, matchWorkflowTemplate } from '../components/workflow/templates';

describe('workflow templates', () => {
  it('matches a template from one sentence', () => {
    expect(matchWorkflowTemplate('做一个 5 秒短片')).toBe('storyboard-video');
    expect(matchWorkflowTemplate('Product packshot on marble')).toBe('product-scene');
    expect(matchWorkflowTemplate('参考这张图换背景')).toBe('reference-edit');
    expect(matchWorkflowTemplate('一只猫')).toBe('text-to-image');
  });

  it('builds a connected chain for every template', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const seed = buildWorkflowTemplate(template.id, '', 'zho');
      const ids = new Set(seed.nodes.map(node => node.id));
      expect(seed.templateId).toBe(template.id);
      expect(seed.title.length).toBeGreaterThan(0);
      expect(seed.nodes.length).toBeGreaterThan(1);
      expect(seed.connections).toHaveLength(seed.nodes.length - 1);
      for (const connection of seed.connections) {
        expect(ids.has(connection.fromNodeId)).toBe(true);
        expect(ids.has(connection.toNodeId)).toBe(true);
      }
    }
  });

  it('puts the sentence into the generation prompt', () => {
    const seed = buildWorkflowTemplate('text-to-image', '雨中的灯塔', 'zho');
    expect(seed.title).toBe('雨中的灯塔');
    expect(seed.nodes.some(node => node.metadata.prompt === '雨中的灯塔')).toBe(true);
  });
});
