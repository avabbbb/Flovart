import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
  it('keeps the standard CLI help entrypoint usable', () => {
    const output = execFileSync(process.execPath, ['tools/flovart/cli.js', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(output).toContain('Commands:');
    expect(output).toContain('workflow.inspect');
  });

  it('installs the CLI-first SKILL attachment without writing any MCP config', () => {
    const projectDir = process.cwd();

    const result = initCliHost({ target: 'project-skill', projectDir, dryRun: true });
    expect(result).toMatchObject({
      ok: true,
      target: 'project-skill',
      skill: expect.objectContaining({ target: expect.stringContaining('.agents'), exists: true, dryRun: true }),
      bootstrapSkill: expect.objectContaining({ target: expect.stringContaining('open-flovart'), exists: true, dryRun: true }),
    });
    expect(result.writes).toBeUndefined();

    for (const target of ['opencode-skill', 'codebuddy-code-skill', 'codex-skill', 'claude-code-skill', 'project-skill']) {
      const single = initCliHost({ target, projectDir, dryRun: true });
      expect(single.ok).toBe(true);
      expect(single.skill.target).toContain(target === 'codebuddy-code-skill' ? '.codebuddy' : target === 'claude-code-skill' ? '.claude' : '.agents');
    }

    const codexAlias = initCliHost({ target: 'codex', projectDir, dryRun: true });
    expect(codexAlias).toMatchObject({ requestedTarget: 'codex', target: 'codex-skill' });
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

  it('writes the zero-config readiness loop from the canonical Skill source', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'flovart-codex-skill-'));
    try {
      const result = initCliHost({ target: 'codex', projectDir });
      const content = readFileSync(result.skill.target, 'utf8');
      expect(content).toContain('flovart ensure --json');
      expect(content).toContain('flovart workflow.inspect --agent-identity codex --json');
      expect(content).toContain('npm run flovart:cli -- ensure --json');
      expect(content).toContain('Do not use `npx flovart-cli` as an automatic fallback');
      expect(content).toContain('workflow.selection.get');
      expect(content).not.toContain('start --open');
      expect(content).not.toContain('command.list');
      expect(content).not.toContain('agent.json');
      expect(content).not.toContain('npx flovart-cli command.list --json\n');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('lists Seedance 2.0 as the default agent-facing video package', () => {
    const result = listAgentModels({ purpose: 'video' });
    const seedance = result.models.video.find(m => m.id === 'flovart:seedance-2');

    expect(seedance).toMatchObject({
      id: 'flovart:seedance-2',
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
        workflow: expect.objectContaining({ commandSurface: true }),
      }),
    });
    expect(JSON.stringify(diagnosis)).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it('diagnoses Seedance 2.0 readiness for Workflow from local shadow state', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'flovart-doctor-'));
    const previousStateFile = process.env.FLOVART_SHADOW_STATE_FILE;
    const stateFile = join(tempDir, 'state.json');
    process.env.FLOVART_SHADOW_STATE_FILE = stateFile;
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(stateFile, JSON.stringify({
      provider: {
        configured: { image: false, video: false, text: false },
        selectedModels: { image: 'flovart:gpt-image-2', video: 'kling-v2', text: 'gemini-3-flash-preview' },
        providers: [],
      },
      workflowProjects: [{ id: 'wf-1', title: 'Launch' }],
      activeWorkflowProjectId: 'wf-1',
    }), 'utf8');

    try {
      const diagnosis = diagnoseAgentSetup({ projectDir: process.cwd() });
      expect(diagnosis).toMatchObject({
        readyForSeedance2: false,
        readyForWorkflowSeedance2: false,
        provider: { selectedModels: { video: 'flovart:seedance-2' } },
        seedance2: {
          ok: false,
          checks: expect.arrayContaining([
            expect.objectContaining({ id: 'video.providerConfigured', ok: false }),
            expect.objectContaining({ id: 'video.seedance2Model', ok: true }),
            expect.objectContaining({ id: 'seedance2.multimodalLimits', ok: true, slots: { image: 9, video: 3, audio: 3 } }),
          ]),
        },
        surfaces: {
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
