import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_OPERATION_CAPABILITY_IDS,
  WORKFLOW_OPERATION_NODE_TOOLS,
  getWorkflowOperationCapability,
  getWorkflowOperationCapabilityByNodeTool,
  getWorkflowOperationInputRoleForNodeType,
  parseWorkflowOperationParameters,
  parseWorkflowOperationNodeToolArguments,
  validateWorkflowOperationInputBindings,
  validateWorkflowOperationOutputs,
} from '../components/workflow/operationRegistry';
import { createWorkflowOperationInputBinding } from '../components/workflow/operations';

describe('workflow operation capability registry', () => {
  it('exposes image, video and audio capabilities from one closed registry', () => {
    expect(WORKFLOW_OPERATION_CAPABILITY_IDS).toEqual([
      'image.generate@1', 'image.crop@1', 'image.upscale@1',
      'image.remove-background@1', 'image.split-layers@1', 'image.edit@1', 'image.rotate@1', 'image.split-grid@1',
      'video.trim@1', 'video.av-split@1', 'video.merge@1', 'video.extract-frame@1',
      'audio.trim@1', 'audio.speed@1',
    ]);
    expect(WORKFLOW_OPERATION_NODE_TOOLS).toEqual([
      'crop', 'upscale', 'remove-background', 'split-layers', 'edit', 'rotate', 'split-grid',
      'video-trim', 'video-av-split', 'video-merge', 'video-extract-frame',
      'audio-trim', 'audio-speed',
    ]);
    expect(getWorkflowOperationCapability('image.crop@1')).toMatchObject({
      executor: 'local-transform', confirmation: 'none', nodeTool: 'crop', uiKey: 'image-crop',
      inputRoles: [{ role: 'source_image', nodeTypes: ['image'], min: 1, max: 1 }],
      outputRoles: [{ role: 'result_image', nodeType: 'image', min: 1, max: 1 }],
    });
    expect(getWorkflowOperationCapabilityByNodeTool('upscale')).toMatchObject({
      id: 'image.upscale@1', executor: 'provider-image-tool', confirmation: 'paid-operation-subgraph',
    });
    expect(getWorkflowOperationCapabilityByNodeTool('remove-background')).toMatchObject({
      id: 'image.remove-background@1', executor: 'provider-image-tool', confirmation: 'paid-operation-subgraph',
    });
    expect(getWorkflowOperationCapabilityByNodeTool('video-av-split')).toMatchObject({
      id: 'video.av-split@1', mediaType: 'video', confirmation: 'none',
      outputRoles: [
        { role: 'result_video', nodeType: 'video', min: 1, max: 1 },
        { role: 'result_audio', nodeType: 'audio', min: 1, max: 1 },
      ],
    });
  });

  it('normalizes known parameters and rejects invalid recipes', () => {
    expect(parseWorkflowOperationParameters('image.generate@1', {})).toEqual({ count: 1 });
    expect(parseWorkflowOperationParameters('image.upscale@1', { targetLongEdge: 2048, algorithm: 'high', ignored: true })).toEqual({ targetLongEdge: 2048, algorithm: 'high' });
    expect(() => parseWorkflowOperationParameters('image.crop@1', { x: .8, y: 0, width: .5, height: 1 })).toThrow('裁剪范围不能超出图片');
    expect(parseWorkflowOperationParameters('video.extract-frame@1', {})).toEqual({ position: 'first' });
    expect(() => parseWorkflowOperationParameters('video.trim@1', { startSec: 4, endSec: 2 })).toThrow('视频结束时间必须晚于开始时间');
    expect(() => parseWorkflowOperationParameters('audio.trim@1', { startSec: 4, endSec: 2 })).toThrow('音频结束时间必须晚于开始时间');
    expect(parseWorkflowOperationParameters('audio.speed@1', { speed: 1.5, ignored: true })).toEqual({ speed: 1.5 });
    expect(() => parseWorkflowOperationParameters('audio.speed@1', { speed: 5 })).toThrow();
    expect(parseWorkflowOperationParameters('image.rotate@1', {})).toEqual({ action: 'rotate-90' });
    expect(parseWorkflowOperationParameters('image.split-grid@1', {})).toEqual({ rows: 2, cols: 2 });
    expect(parseWorkflowOperationNodeToolArguments('image.edit@1', { prompt: '换成蓝天', maskNodeId: 'mask-1', ignored: true })).toEqual({ prompt: '换成蓝天', maskNodeId: 'mask-1' });
    expect(() => parseWorkflowOperationNodeToolArguments('image.edit@1', {})).toThrow();
    expect(parseWorkflowOperationNodeToolArguments('video.merge@1', { sourceNodeIds: ['video-1', 'video-2'], ignored: true })).toEqual({ sourceNodeIds: ['video-1', 'video-2'] });
    expect(() => parseWorkflowOperationNodeToolArguments('video.merge@1', { sourceNodeIds: ['video-1', 'video-1'] })).toThrow('视频拼接来源不能重复');
  });

  it('derives input roles and rejects recipes outside the registered contract', () => {
    expect(getWorkflowOperationInputRoleForNodeType('image.generate@1', 'image')).toBe('reference_image');
    expect(getWorkflowOperationInputRoleForNodeType('image.generate@1', 'text')).toBe('prompt_context');
    expect(getWorkflowOperationInputRoleForNodeType('image.generate@1', 'video')).toBeNull();
    expect(getWorkflowOperationInputRoleForNodeType('image.crop@1', 'image')).toBe('source_image');
    expect(getWorkflowOperationInputRoleForNodeType('video.merge@1', 'video')).toBe('source_video');
    expect(getWorkflowOperationInputRoleForNodeType('audio.trim@1', 'audio')).toBe('source_audio');

    const source = createWorkflowOperationInputBinding('binding-1', 'source-1', 'source_image', 0);
    expect(() => validateWorkflowOperationInputBindings('image.generate@1', [source])).toThrow('不允许输入角色 source_image');
    expect(() => validateWorkflowOperationInputBindings('image.crop@1', [], { requireMinimum: true })).toThrow('至少需要 1 个 source_image 输入');
    expect(() => validateWorkflowOperationInputBindings('image.crop@1', [source, { ...source, id: 'binding-2', sourceNodeId: 'source-2', order: 1 }])).toThrow('最多允许 1 个 source_image 输入');
    expect(() => validateWorkflowOperationOutputs('video.av-split@1', [{ role: 'result_video', nodeType: 'video' }])).toThrow('至少需要 1 个 result_audio 输出');
    expect(() => validateWorkflowOperationOutputs('video.extract-frame@1', [{ role: 'result_video', nodeType: 'video' }])).toThrow('不允许输出 result_video/video');
  });
});
