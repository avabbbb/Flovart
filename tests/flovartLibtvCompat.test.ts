import { describe, expect, it, vi } from 'vitest';
import {
  COMMAND_REGISTRY,
  executeFlovartCommand,
  normalizeCommandName,
} from '../tools/flovart/core.js';

describe('Flovart Workflow-only CLI contract', () => {
  it('normalizes current MCP aliases without reviving removed Element commands', () => {
    expect(normalizeCommandName('flovart_workflow_node_create')).toBe('workflow.node.create');
    expect(normalizeCommandName('flovart_generate_video')).toBe('generate.video');
    expect(normalizeCommandName('flovart_element_create')).toBe('flovart_element_create');
  });

  it('publishes one canonical registry with Workflow commands and no Canvas or Element topology', async () => {
    const listed = await executeFlovartCommand('command.list');
    const names = Object.keys(listed.commands);

    expect(names).toContain('workflow.node.run');
    expect(names).toContain('provider.select-model');
    expect(names.some(name => /(^|\.)(canvas|element)(\.|$)/i.test(name))).toBe(false);
    expect(COMMAND_REGISTRY['workflow.node.run'].args).toMatchObject({ projectId: 'string?', nodeId: 'string' });
  });

  it('forwards normalized Workflow arguments through the deterministic dispatcher', async () => {
    const dispatch = vi.fn(async command => ({ ok: true, command }));
    const result = await executeFlovartCommand('flovart_workflow_node_create', {
      'project-id': 'project-1',
      id: 'image-1',
      type: 'image',
      'metadata-json': '{"prompt":"产品主图"}',
      'idempotency-key': 'create-image-1',
    }, { workflow: { dispatch } });

    expect(result.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      command: 'workflow.node.create',
      source: 'cli',
      idempotencyKey: 'create-image-1',
      args: expect.objectContaining({
        projectId: 'project-1',
        metadata: { prompt: '产品主图' },
      }),
    }));
  });

  it('forwards video multimodal slots and provider parameters without exposing a key', async () => {
    const video = vi.fn(async payload => ({ ok: true, payload }));
    const result = await executeFlovartCommand('generate.video', {
      prompt: '角色转身',
      'source-image-ids': 'image-a,image-b',
      'source-video-ids': ['video-a'],
      'slots-json': '[{"kind":"image","id":"image-a"}]',
      'duration-sec': '8',
      resolution: '1080p',
      'generate-audio': 'true',
      watermark: 'false',
      seed: '7',
    }, { generate: { video } });

    expect(result.ok).toBe(true);
    expect(video).toHaveBeenCalledWith({
      prompt: '角色转身',
      sourceImageIds: ['image-a', 'image-b'],
      sourceVideoIds: ['video-a'],
      slots: [{ kind: 'image', id: 'image-a' }],
      durationSec: 8,
      aspectRatio: undefined,
      resolution: '1080p',
      generateAudio: true,
      watermark: false,
      seed: 7,
    });
  });

  it('rejects removed legacy mutation commands instead of silently mapping them', async () => {
    await expect(executeFlovartCommand('element.create', {}, {})).rejects.toThrow('Unknown Flovart command');
    await expect(executeFlovartCommand('project.create', {}, {})).rejects.toThrow('Unknown Flovart command');
    await expect(executeFlovartCommand('upload', {}, {})).rejects.toThrow('Unknown Flovart command');
  });
});
