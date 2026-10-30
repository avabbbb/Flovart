import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSkillCommand } from '../tools/flovart/skill-commands.js';

const dirs: string[] = [];
async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flovart-skill-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('skill authoring commands', () => {
  it('scaffolds a package that validates, and refuses to overwrite', async () => {
    const projectDir = await tempDir();
    const init = await runSkillCommand('skill.init', { id: 'community.demo-skill', projectDir, name: 'Demo' });
    expect(init.ok).toBe(true);
    const dir = path.join(projectDir, '.agents', 'skills', 'demo-skill');
    expect(init.dir).toBe(dir);
    const validate = await runSkillCommand('skill.validate', { fromDir: dir, projectDir });
    expect(validate.ok).toBe(true);
    expect(validate.manifest.id).toBe('community.demo-skill');
    expect(validate.manifest.inputs.map((slot: { id: string }) => slot.id)).toEqual(['topic']);
    expect(validate.warnings).toEqual([]);
    const again = await runSkillCommand('skill.init', { id: 'community.demo-skill', projectDir });
    expect(again.ok).toBe(false);
    expect(again.error.code).toBe('ALREADY_EXISTS');
  });

  it('rejects an invalid manifest and a missing argument', async () => {
    const projectDir = await tempDir();
    const init = await runSkillCommand('skill.init', { id: 'community.bad', projectDir });
    const manifestPath = path.join(init.dir, 'flovart.skill.yaml');
    const yaml = await fs.readFile(manifestPath, 'utf8');
    await fs.writeFile(manifestPath, yaml.replace('kind: longtext', 'kind: gif'), 'utf8');
    const validate = await runSkillCommand('skill.validate', { fromDir: init.dir });
    expect(validate.ok).toBe(false);
    expect(validate.error.code).toBe('PACKAGE_REJECTED');
    expect((await runSkillCommand('skill.validate', {})).error.code).toBe('INVALID_ARGUMENT');
  });
});
