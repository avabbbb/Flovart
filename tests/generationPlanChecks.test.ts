import { describe, expect, it } from 'vitest';
import { applyPlanChecks, buildGenerationPlanChecks, deriveProductMode } from '../services/generationPlan';
import { getProductModel } from '../services/productModelCatalog';
import { createWorkflowNode } from '../components/workflow/constants';
import type { GenerationGateDetails } from '../services/generationGate';

const details: GenerationGateDetails = { serviceLabel: 's', modelLabel: 'm', mediaType: 'video', taskCount: 1 };

describe('deriveProductMode', () => {
  const seedance = getProductModel('flovart:seedance-2');

  it('keeps an explicit submode', () => {
    expect(deriveProductMode('video', 'first-last-frame', seedance, [{ kind: 'video' }])).toBe('first-last-frame');
  });

  it('falls back to text modes without references', () => {
    expect(deriveProductMode('video', undefined, seedance, [])).toBe('text-to-video');
    expect(deriveProductMode('image', undefined, undefined, [{ kind: 'image' }])).toBe('text-to-image');
  });

  it('uses reference-to-video for a video reference when the model supports it', () => {
    const expected = seedance?.capabilities.modes.includes('reference-to-video') ? 'reference-to-video' : 'text-to-video';
    expect(deriveProductMode('video', undefined, seedance, [{ kind: 'video' }])).toBe(expected);
  });
});

describe('buildGenerationPlanChecks', () => {
  it('blocks when no model is selected, with the runtime wording', () => {
    const node = createWorkflowNode('video', 'video', { x: 0, y: 0 }, { config: { mode: 'video' } });
    const checks = buildGenerationPlanChecks({ node, project: { nodes: [node], connections: [] }, keys: [], mode: 'video' });
    expect(checks.blockers.map(item => item.message)).toEqual(['请先在 PromptBar 明确选择视频产品模型。']);
  });

  it('warns that a Seedance retry creates a new task', () => {
    const node = createWorkflowNode('video', 'video', { x: 0, y: 0 }, { config: { mode: 'video', modelId: 'flovart:seedance-2' } });
    node.metadata.status = 'error';
    const checks = buildGenerationPlanChecks({ node, project: { nodes: [node], connections: [] }, keys: [], mode: 'video' });
    expect(checks.warnings.map(item => item.code)).toContain('retry-new-task');
    expect(checks.blockers).toEqual([]);
  });

  it('merges checks into the gate details without empty arrays', () => {
    expect(applyPlanChecks(details, { references: [], warnings: [], blockers: [] })).toEqual(details);
    const merged = applyPlanChecks(details, { references: [], warnings: [], blockers: [{ code: 'x', message: 'y' }] });
    expect(merged.blockers).toEqual([{ code: 'x', message: 'y' }]);
  });
});
