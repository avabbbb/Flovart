// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Validator, type Schema } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';

import extensionSchema from '../.agents/skills/vox-director/schemas/extension.schema.json';
import {
  getBundledProductionSkill,
  listBundledProductionSkills,
} from '../services/productionSkillCatalog';
import { auditVoxProductionSpec } from '../tools/flovart/vox-director-quality.js';

describe('bundled Production Skill catalog', () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../.agents/skills/vox-director');

  it('discovers the provider-neutral VOX package as an official example', () => {
    const skills = listBundledProductionSkills();
    const vox = getBundledProductionSkill('community.vox-director');

    expect(skills.map(skill => skill.id)).toContain('community.vox-director');
    expect(vox).toMatchObject({
      id: 'community.vox-director',
      version: '1.0.0',
      displayName: 'VOX Skill',
      trustTier: 'bundled-example',
      license: 'MIT',
      permissions: {
        network: 'none',
        secrets: 'none',
        filesystem: 'package-readonly',
      },
    });
    expect(vox?.capabilities).toEqual(expect.arrayContaining([
      'image.generate',
      'video.generate',
      'audio.tts',
      'audio.music',
      'media.render',
      'media.verify',
    ]));
  });

  it('ships a quality-gated example using the canonical Skill extension id', () => {
    const vox = getBundledProductionSkill('community.vox-director');
    const example = vox?.exampleSpec as { extensions?: Record<string, unknown> } | undefined;
    const result = auditVoxProductionSpec(vox?.exampleSpec);
    const extension = example?.extensions?.['community.vox-director'];
    const schemaResult = new Validator(extensionSchema as Schema, '2020-12').validate(extension);

    expect(example?.extensions).toHaveProperty('community.vox-director');
    expect(schemaResult.valid).toBe(true);
    expect(result).toMatchObject({
      passed: true,
      score: 100,
      metrics: {
        durationSec: 30,
        shotCount: 8,
        directedShotCount: 8,
      },
    });
  });

  it('does not embed the upstream Provider execution path or a user secret', () => {
    const packageText = [
      'SKILL.md',
      'flovart.skill.yaml',
      'agents/openai.yaml',
      'references/creative-direction.md',
      'evals/cases.json',
      'examples/production-spec.json',
    ].map(path => readFileSync(resolve(packageRoot, path), 'utf8')).join('\n');

    expect(packageText).not.toMatch(/ATLASCLOUD_API_KEY|api\.atlascloud\.ai/);
  });
});
