import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_OPERATION_CAPABILITY_IDS,
  WORKFLOW_OPERATION_NODE_TOOLS,
  getWorkflowOperationCapability,
  getWorkflowOperationCapabilityByNodeTool,
  getWorkflowOperationInputRoleForNodeType,
  parseWorkflowOperationParameters,
  validateWorkflowOperationInputBindings,
} from '../components/workflow/operationRegistry';
import { createWorkflowOperationInputBinding } from '../components/workflow/operations';

describe('workflow operation capability registry', () => {
  it('exposes the closed image tracer bullet capability set', () => {
    expect(WORKFLOW_OPERATION_CAPABILITY_IDS).toEqual(['image.generate@1', 'image.crop@1', 'image.upscale@1']);
    expect(WORKFLOW_OPERATION_NODE_TOOLS).toEqual(['crop', 'upscale']);
    expect(getWorkflowOperationCapability('image.crop@1')).toMatchObject({
      executor: 'local-transform', confirmation: 'none', nodeTool: 'crop', uiKey: 'image-crop',
      inputRoles: [{ role: 'source_image', nodeTypes: ['image'], min: 1, max: 1 }],
      output: { role: 'result_image', nodeType: 'image' },
    });
    expect(getWorkflowOperationCapabilityByNodeTool('upscale')).toMatchObject({
      id: 'image.upscale@1', executor: 'provider-image-tool', confirmation: 'paid-operation-subgraph',
    });
    expect(getWorkflowOperationCapabilityByNodeTool('remove-background')).toBeUndefined();
  });

  it('normalizes known parameters and rejects invalid recipes', () => {
    expect(parseWorkflowOperationParameters('image.generate@1', {})).toEqual({ count: 1 });
    expect(parseWorkflowOperationParameters('image.upscale@1', { targetLongEdge: 2048, algorithm: 'high', ignored: true })).toEqual({ targetLongEdge: 2048, algorithm: 'high' });
    expect(() => parseWorkflowOperationParameters('image.crop@1', { x: .8, y: 0, width: .5, height: 1 })).toThrow('裁剪范围不能超出图片');
  });

  it('derives input roles and rejects recipes outside the registered contract', () => {
    expect(getWorkflowOperationInputRoleForNodeType('image.generate@1', 'image')).toBe('reference_image');
    expect(getWorkflowOperationInputRoleForNodeType('image.generate@1', 'text')).toBe('prompt_context');
    expect(getWorkflowOperationInputRoleForNodeType('image.generate@1', 'video')).toBeNull();
    expect(getWorkflowOperationInputRoleForNodeType('image.crop@1', 'image')).toBe('source_image');

    const source = createWorkflowOperationInputBinding('binding-1', 'source-1', 'source_image', 0);
    expect(() => validateWorkflowOperationInputBindings('image.generate@1', [source])).toThrow('不允许输入角色 source_image');
    expect(() => validateWorkflowOperationInputBindings('image.crop@1', [], { requireMinimum: true })).toThrow('至少需要 1 个 source_image 输入');
    expect(() => validateWorkflowOperationInputBindings('image.crop@1', [source, { ...source, id: 'binding-2', sourceNodeId: 'source-2', order: 1 }])).toThrow('最多允许 1 个 source_image 输入');
  });
});
