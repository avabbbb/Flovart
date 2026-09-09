// @vitest-environment node
import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import { expect, it } from 'vitest';
import { createWorkBuddySkillPackage } from '../services/agentSkillPackage';

it('creates a readable official-shape Connector archive with its complete Skill reference', async () => {
  const blob = await createWorkBuddySkillPackage();
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const entry = entries.find(file => file.filename === 'flovart-workbuddy/skills/flovart/SKILL.md');
    const reference = entries.find(file => file.filename === 'flovart-workbuddy/skills/flovart/references/workflow.md');
    for (const file of ['connector-meta.json', 'cli.json', 'icon.svg']) {
      expect(entries.find(entry => entry.filename === `flovart-workbuddy/${file}`)?.directory).toBe(false);
    }
    expect(entry?.directory).toBe(false);
    expect(reference?.directory).toBe(false);
    if (!entry || !('getData' in entry) || !reference || !('getData' in reference)) throw new Error('Skill archive is missing its files');
    const skill = await entry.getData(new TextWriter());
    expect(skill).toMatch(/^---\r?\nname: flovart/);
    expect(skill).toContain('(references/workflow.md)');
    expect(skill).toContain('--agent-identity workbuddy');
    const workflow = await reference.getData(new TextWriter());
    expect(workflow).toContain('workflow.apply');
    expect(workflow).not.toContain('WorkBuddy is a future');
  } finally { await reader.close(); }
});
