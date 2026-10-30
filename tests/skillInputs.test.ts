import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { skillInputsSchema } from '../services/skillInputs';
import { buildProductionSkillStarterPrompt } from '../services/productionSkillLaunch';
import { getBundledProductionSkill } from '../services/productionSkillCatalog';
import { parseProductionSkillManifest } from '../tools/flovart/skill-package.js';

const voxYaml = readFileSync('.agents/skills/vox-director/flovart.skill.yaml', 'utf8');

describe('skill input slots', () => {
  it('TS schema rejects duplicate ids and choice without options', () => {
    expect(skillInputsSchema.safeParse([{ id: 'topic', label: 'T', kind: 'text' }, { id: 'topic', label: 'U', kind: 'text' }]).success).toBe(false);
    expect(skillInputsSchema.safeParse([{ id: 'style', label: 'S', kind: 'choice' }]).success).toBe(false);
    expect(skillInputsSchema.safeParse([{ id: 'style', label: 'S', kind: 'choice', options: ['a'] }]).success).toBe(true);
  });

  it('starter prompt falls back to the fixed template without inputs', () => {
    const prompt = buildProductionSkillStarterPrompt({ id: 'community.vox-director', displayName: 'VOX' });
    expect(prompt).toContain('$vox-director');
    expect(prompt).toContain('未经确认');
  });

  it('starter prompt lists one line per slot with defaults and media hint', () => {
    const prompt = buildProductionSkillStarterPrompt({
      id: 'community.demo',
      displayName: 'Demo',
      inputs: [
        { id: 'topic', label: '主题', kind: 'longtext', required: true, placeholder: 'P' },
        { id: 'duration', label: '时长', kind: 'choice', options: ['15', '30'], default: '30' },
        { id: 'ref', label: '参考', kind: 'image' },
      ],
    });
    const lines = prompt.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('（必填）');
    expect(lines[2]).toContain('【30】');
    expect(lines[3]).toContain('@');
  });

  it('bundled VOX skill exposes its declared inputs', () => {
    const skill = getBundledProductionSkill('community.vox-director');
    expect(skill?.inputs.map(slot => slot.id)).toEqual(['topic', 'duration', 'language', 'references']);
  });

  it('JS manifest parser mirrors the TS contract', () => {
    expect(parseProductionSkillManifest(voxYaml).inputs.map(slot => slot.id)).toEqual(['topic', 'duration', 'language', 'references']);
    expect(() => parseProductionSkillManifest(voxYaml.replace('kind: image', 'kind: gif'))).toThrow(/kind/);
  });
});
