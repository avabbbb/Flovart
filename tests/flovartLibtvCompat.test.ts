import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { executeFlovartCommand, normalizeCommandName, parseCliArgs } from '../tools/flovart/core.js';

describe('flovart LibTV-style CLI compatibility', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flovart-libtv-'));
    process.env.FLOVART_SHADOW_STATE_FILE = join(tempDir, 'state.json');
    process.env.FLOVART_CONTEXT_FILE = join(tempDir, '.flovart', 'project.json');
  });

  afterEach(() => {
    delete process.env.FLOVART_SHADOW_STATE_FILE;
    delete process.env.FLOVART_CONTEXT_FILE;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  async function runtimeForTest() {
    if (tempDir && !existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
    const modulePath = `../tools/flovart/shadow-runtime.js?case=${Date.now()}-${Math.random()}`;
    const { createShadowRuntimeFacade } = await import(modulePath);
    return createShadowRuntimeFacade();
  }

  it('parses LibTV-style short set and update flags', () => {
    const args = parseCliArgs(['create', '-t', 'image', '-n', 'hero', '-s', 'prompt=hello', '-s', 'count=2', '-u', 'x=120']);

    expect(args._).toEqual(['create']);
    expect(args.t).toBe('image');
    expect(args.n).toBe('hero');
    expect(args.s).toEqual(['prompt=hello', 'count=2']);
    expect(args.u).toEqual(['x=120']);
  });

  it('normalizes atomic CLI aliases and forwards video multimodal options', async () => {
    expect(normalizeCommandName('flovart_element_create')).toBe('element.create');
    expect(normalizeCommandName('flovart_generate_video')).toBe('generate.video');

    const calls: any[] = [];
    const runtime = {
      generate: {
        video: async (input: any) => {
          calls.push(input);
          return { ok: true, jobId: 'video-job-1' };
        },
      },
    };

    const result = await executeFlovartCommand('flovart_generate_video', {
      prompt: 'seedance multimodal scene',
      'source-image-ids': 'img-a,img-b',
      'source-video-ids': 'vid-a',
      'slots-json': '[{"kind":"audio","href":"https://example.com/ref.mp3","mimeType":"audio/mpeg","role":"reference_audio"}]',
      duration: '8',
      resolution: '1080p',
      seed: '42',
    }, runtime);

    expect(result).toEqual({ ok: true, jobId: 'video-job-1' });
    expect(calls[0]).toMatchObject({
      prompt: 'seedance multimodal scene',
      sourceImageIds: ['img-a', 'img-b'],
      sourceVideoIds: ['vid-a'],
      durationSec: 8,
      resolution: '1080p',
      seed: 42,
      slots: [{ kind: 'audio', href: 'https://example.com/ref.mp3', mimeType: 'audio/mpeg', role: 'reference_audio' }],
    });
  });

  it('returns canonical command schema with CLI aliases', async () => {
    const schema = await executeFlovartCommand('command.schema', { command: 'flovart_generate_video' }, {});

    expect(schema).toMatchObject({
      ok: true,
      command: 'generate.video',
      schema: {
        summary: expect.stringContaining('video'),
        args: expect.objectContaining({
          sourceVideoIds: 'string[]?',
          slots: 'array?',
          resolution: 'string?',
        }),
        aliases: expect.arrayContaining(['flovart_generate_video']),
      },
    });
  });

  it('creates projects and groups, then uses the active group for new nodes', async () => {
    const runtime = await runtimeForTest();

    const project = await executeFlovartCommand('project.create', { name: 'Launch Film' }, runtime);
    expect(project).toMatchObject({ ok: true, project: { name: 'Launch Film' } });

    const group = await executeFlovartCommand('group.create', { name: 'Unit Videos', use: true }, runtime);
    expect(group).toMatchObject({ ok: true, group: { name: 'Unit Videos' } });

    const context = JSON.parse(readFileSync(process.env.FLOVART_CONTEXT_FILE!, 'utf8'));
    expect(context.projectUuid).toBe(project.project.projectUuid);
    expect(context.groupNodeKey).toBe(group.group.groupNodeKey);

    const node = await executeFlovartCommand('node.create', {
      type: 'image',
      name: 'unit-01-keyframe',
      s: ['prompt=cinematic hero frame'],
    }, runtime);
    expect(node).toMatchObject({
      ok: true,
      node: {
        type: 'image',
        name: 'unit-01-keyframe',
        projectUuid: project.project.projectUuid,
        groupNodeKey: group.group.groupNodeKey,
      },
    });
    expect(node.node.generationState.promptPayload.rawText).toBe('cinematic hero frame');

    const listed = await executeFlovartCommand('node.list', {}, runtime);
    expect(listed.nodes.map((item: any) => item.id)).toContain(node.node.id);
  });

  it('updates, runs, and deletes nodes through LibTV-style node commands', async () => {
    const runtime = await runtimeForTest();

    const created = await executeFlovartCommand('node.create', { type: 'image', name: 'hero' }, runtime);
    const updated = await executeFlovartCommand('node.update', {
      id: created.node.id,
      s: ['prompt=updated prompt', 'model=flux-schnell'],
      u: ['x=240', 'y=320'],
    }, runtime);

    expect(updated).toMatchObject({ ok: true, node: { x: 240, y: 320 } });
    expect(updated.node.generationState.promptPayload.rawText).toBe('updated prompt');
    expect(updated.node.generationState.modelId).toBe('flux-schnell');

    const run = await executeFlovartCommand('node.run', { id: created.node.id }, runtime);
    expect(run).toMatchObject({ ok: true, status: 'queued', shadow: true });

    const deleted = await executeFlovartCommand('node.delete', { id: created.node.id }, runtime);
    expect(deleted).toMatchObject({ ok: true, removed: 1 });
  });

  it('exposes upload, model search, image shortcuts, and script storyboard commands', async () => {
    const runtime = await runtimeForTest();

    const upload = await executeFlovartCommand('upload', { path: join(process.cwd(), 'pic', 'LOGO.png'), name: 'logo-ref' }, runtime);
    expect(upload).toMatchObject({ ok: true, element: { type: 'image', name: 'logo-ref' } });

    const models = await executeFlovartCommand('model.search', { type: 'image', query: 'flux' }, runtime);
    expect(models.ok).toBe(true);
    expect(models.models.some((model: any) => String(model.id).includes('flux'))).toBe(true);

    const shortcut = await executeFlovartCommand('image.shortcut', { n: upload.id, _: ['product-hero'] }, runtime);
    expect(shortcut).toMatchObject({ ok: true, node: { id: upload.id } });
    expect(shortcut.node.generationState.promptPayload.rawText).toContain('premium product');

    const story = await executeFlovartCommand('script.storyboard', {
      script: 'A founder opens the box.\nThe product lights up.',
      count: 2,
      group: 'Storyboard',
    }, runtime);
    expect(story).toMatchObject({ ok: true, shots: expect.arrayContaining([expect.objectContaining({ name: 'storyboard-01' })]) });
  });
});
