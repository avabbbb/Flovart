import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  diagnoseAgentSetup,
  enhancePrompt,
  initCliHost,
  listAgentModels,
  planBatchGeneration,
  searchInspiration,
} from '../tools/flovart/agent-kit.js';

describe('flovart agent kit', () => {
  it('builds host-specific CLI config without writing in dry-run mode', () => {
    const projectDir = process.cwd();

    expect(initCliHost({ host: 'opencode', projectDir, dryRun: true })).toMatchObject({
      ok: true,
      writes: [
        expect.objectContaining({
          wrapperKey: 'cliServers',
          config: { cliServers: { flovart: expect.objectContaining({ command: 'node' }) } },
        }),
      ],
    });

    expect(initCliHost({ host: 'vscode', projectDir, dryRun: true })).toMatchObject({
      ok: true,
      writes: [
        expect.objectContaining({
          wrapperKey: 'servers',
          config: { servers: { flovart: expect.objectContaining({ type: 'stdio', command: 'node' }) } },
        }),
      ],
    });
  });

  it('enhances prompts and plans batches deterministically', () => {
    expect(enhancePrompt({ prompt: 'future city', style: 'cinematic' })).toMatchObject({
      ok: true,
      prompt: 'future city',
      style: 'cinematic',
    });

    const plan = planBatchGeneration({ prompt: 'red sports car', count: 3, aspectRatio: '16:9' });
    expect(plan).toMatchObject({ ok: true, count: 3, aspectRatio: '16:9' });
    expect(plan.items).toHaveLength(3);
    expect(plan.items[0]).toEqual(expect.objectContaining({ clientShotId: 'shot-1', prompt: expect.stringContaining('red sports car') }));
  });
  it('lists Seedance 2.0 as the default agent-facing video package', () => {
    const result = listAgentModels({ purpose: 'video' });
    const seedance = result.models.video[0];

    expect(seedance).toMatchObject({
      id: 'doubao-seedance-2.0',
      provider: 'volcengine',
      capability: 'video',
      slots: { image: 9, video: 3, audio: 3 },
      durationSec: { min: 4, max: 15 },
    });
    expect(seedance.resolutions).toEqual(expect.arrayContaining(['720p', '1080p']));
  });

  it('searches local inspiration and diagnoses setup without secrets', () => {
    expect(searchInspiration({ query: 'product' })).toMatchObject({
      ok: true,
      items: expect.arrayContaining([expect.objectContaining({ id: 'product-hero-luxury' })]),
    });

    const diagnosis = diagnoseAgentSetup({ projectDir: process.cwd() });
    expect(diagnosis).toMatchObject({
      ok: true,
      checks: expect.arrayContaining([expect.objectContaining({ id: 'cli', ok: true })]),
      seedance2: expect.objectContaining({ provider: 'volcengine' }),
      surfaces: expect.objectContaining({
        canvas: expect.objectContaining({ commandSurface: true }),
        workflow: expect.objectContaining({ commandSurface: true }),
      }),
    });
    expect(JSON.stringify(diagnosis)).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it('diagnoses Seedance 2.0 readiness for Canvas and Workflow from local shadow state', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'flovart-doctor-'));
    const previousStateFile = process.env.FLOVART_SHADOW_STATE_FILE;
    const stateFile = join(tempDir, 'state.json');
    process.env.FLOVART_SHADOW_STATE_FILE = stateFile;
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify({
      provider: {
        configured: { image: false, video: false, text: false },
        selectedModels: { image: 'flux-schnell', video: 'kling-v2', text: 'gpt-4.1-mini' },
        providers: [],
      },
      elements: [{ id: 'img-1', type: 'image' }],
      workflowProjects: [{ id: 'wf-1', title: 'Launch' }],
      activeWorkflowProjectId: 'wf-1',
    }), 'utf8');

    try {
      const diagnosis = diagnoseAgentSetup({ projectDir: process.cwd() });
      expect(diagnosis).toMatchObject({
        readyForSeedance2: false,
        readyForCanvasSeedance2: false,
        readyForWorkflowSeedance2: false,
        provider: { selectedModels: { video: 'doubao-seedance-2.0' } },
        seedance2: {
          ok: false,
          checks: expect.arrayContaining([
            expect.objectContaining({ id: 'video.providerConfigured', ok: false }),
            expect.objectContaining({ id: 'video.seedance2Model', ok: true }),
            expect.objectContaining({ id: 'seedance2.multimodalLimits', ok: true, slots: { image: 9, video: 3, audio: 3 } }),
          ]),
        },
        surfaces: {
          canvas: expect.objectContaining({ commandSurface: true, providerBackedGenerationReady: false, mediaElements: 1 }),
          workflow: expect.objectContaining({ commandSurface: true, providerBackedGenerationReady: false, projectCount: 1, activeProjectId: 'wf-1' }),
        },
      });
      expect(diagnosis.nextSteps).toContain('provider.begin-setup --provider volcengine --purpose video');
      expect(JSON.stringify(diagnosis)).not.toMatch(/api[_-]?key|token|secret/i);
    } finally {
      if (previousStateFile === undefined) delete process.env.FLOVART_SHADOW_STATE_FILE;
      else process.env.FLOVART_SHADOW_STATE_FILE = previousStateFile;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
