import { describe, expect, it } from 'vitest';

import {
  buildTrustedSkillContext,
  canonicalSkillPackageEntries,
  hashSkillPackageEntries,
  isSkillPackagePath,
  parseOpenaiAgentMetadata,
  parseProductionSkillManifest,
  parseSkillFrontmatter,
  safeSkillPackageName,
  SKILL_PACKAGE_MAX_ENTRIES,
  SKILL_PACKAGE_MAX_FILE_BYTES,
  SKILL_PACKAGE_MAX_TOTAL_BYTES,
  validateSkillPackageEntries,
} from '../tools/iris/skill-package.js';
import { hashProductionSkillSnapshot } from '../services/productionSkillSnapshot.js';

describe('skillPackage shared helpers', () => {
  it('accepts safe package names and rejects path/unsafe identifiers', () => {
    expect(safeSkillPackageName('community.vox-director')).toBe(true);
    expect(safeSkillPackageName('my-skill_2')).toBe(true);
    expect(safeSkillPackageName('')).toBe(false);
    expect(safeSkillPackageName('-leading')).toBe(false);
    expect(safeSkillPackageName('../evil')).toBe(false);
    expect(safeSkillPackageName('a'.repeat(80))).toBe(false);
  });

  it('filters package content by text extension and ignored dirs', () => {
    expect(isSkillPackagePath('SKILL.md')).toBe(true);
    expect(isSkillPackagePath('references/creative-direction.md')).toBe(true);
    expect(isSkillPackagePath('scripts/assemble.py')).toBe(true);
    expect(isSkillPackagePath('.git/config')).toBe(false);
    expect(isSkillPackagePath('assets/showcase.mp4')).toBe(false);
    expect(isSkillPackagePath('node_modules/foo/index.js')).toBe(false);
    expect(isSkillPackagePath('../escape.md')).toBe(false);
    expect(isSkillPackagePath('dist/bundle.js')).toBe(false);
  });

  it('hashes canonically (sorted paths) and matches the app-side snapshot hash', async () => {
    const entries = [
      { path: 'b.md', content: 'two' },
      { path: 'a.md', content: 'one' },
    ];
    const canonical = canonicalSkillPackageEntries(entries);
    expect(canonical.map(entry => entry.path)).toEqual(['a.md', 'b.md']);
    const hash = await hashSkillPackageEntries(entries);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hash).toBe(await hashProductionSkillSnapshot(canonical));
    expect(hash).not.toBe(await hashSkillPackageEntries([...entries, { path: 'c.md', content: '' }]));
  });

  it('validates untrusted package entries before installation', () => {
    expect(validateSkillPackageEntries([
      { path: 'z.md', content: 'z' },
      { path: 'SKILL.md', content: 'skill' },
    ]).map(entry => entry.path)).toEqual(['SKILL.md', 'z.md']);
    expect(() => validateSkillPackageEntries([{ path: '../escape.md', content: 'x' }])).toThrow('路径');
    expect(() => validateSkillPackageEntries([{ path: '/absolute.md', content: 'x' }])).toThrow('路径');
    expect(() => validateSkillPackageEntries([{ path: 'C:\\absolute.md', content: 'x' }])).toThrow('路径');
    expect(() => validateSkillPackageEntries([{ path: 'assets/cover.png', content: 'x' }])).toThrow('路径');
    expect(() => validateSkillPackageEntries([{ path: 'foo\\bar.md', content: 'x' }])).toThrow('路径');
    expect(() => validateSkillPackageEntries([
      { path: 'a.md', content: 'x' },
      { path: 'a.md', content: 'y' },
    ])).toThrow('重复');
    expect(() => validateSkillPackageEntries([
      { path: 'large.md', content: 'x'.repeat(SKILL_PACKAGE_MAX_FILE_BYTES + 1) },
    ])).toThrow('大小');
    expect(() => validateSkillPackageEntries([
      ...Array.from({ length: Math.ceil(SKILL_PACKAGE_MAX_TOTAL_BYTES / SKILL_PACKAGE_MAX_FILE_BYTES) + 1 }, (_, index) => ({
        path: `total-${index}.md`,
        content: 'x'.repeat(SKILL_PACKAGE_MAX_FILE_BYTES),
      })),
    ])).toThrow('总大小');
    expect(() => validateSkillPackageEntries(
      Array.from({ length: SKILL_PACKAGE_MAX_ENTRIES + 1 }, (_, index) => ({ path: `f${index}.md`, content: '' })),
    )).toThrow('文件数量');
  });

  it('parses a valid production manifest and rejects broken ones', () => {
    const manifest = parseProductionSkillManifest(`schemaVersion: flovart.production-skill/1
id: community.example
version: 1.0.0
trustTier: local-installed
license: MIT
capabilities: [text.image]
permissions:
  network: none
  secrets: none
  filesystem: package-readonly
gates:
  - id: style-review
    type: style-reference
runtime:
  minVersion: 0.3.0
provenance:
  source: https://example.com/skill
`);
    expect(manifest).toMatchObject({
      id: 'community.example',
      version: '1.0.0',
      trustTier: 'local-installed',
      capabilities: ['text.image'],
    });
    expect(manifest.gates).toEqual([{ id: 'style-review', type: 'style-reference' }]);

    expect(() => parseProductionSkillManifest('id: x')).toThrow();
    expect(() => parseProductionSkillManifest('schemaVersion: wrong\nid: x\nversion: 1.0.0\ncapabilities: [a]')).toThrow();
    expect(() => parseProductionSkillManifest('schemaVersion: flovart.production-skill/1\nid: x\nversion: 1.0.0\ncapabilities: []')).toThrow();
  });

  it('extracts optional openai metadata and plain frontmatter', () => {
    expect(parseOpenaiAgentMetadata('interface:\n  display_name: 示例\n  short_description: 一个示例\n')).toEqual({
      displayName: '示例',
      shortDescription: '一个示例',
    });
    expect(parseOpenaiAgentMetadata('not yaml: [')).toEqual({ displayName: '', shortDescription: '' });
    expect(parseSkillFrontmatter('---\nname: demo\n---\n# Demo')).toEqual({ name: 'demo' });
    expect(parseSkillFrontmatter('# no frontmatter')).toEqual({});
  });

  it('builds trusted context from SKILL.md plus all references', () => {
    const manifest = { id: 'community.example', version: '1.0.0', capabilities: ['text.image'], gates: [{ id: 'g', type: 'style-reference' }] };
    const context = buildTrustedSkillContext(manifest, [
      { path: 'SKILL.md', content: '# Skill body' },
      { path: 'references/a.md', content: 'reference A' },
      { path: 'references/b.md', content: 'reference B' },
    ]);
    expect(context).toContain('community.example@1.0.0');
    expect(context).toContain('<trusted-production-skill path="SKILL.md">');
    expect(context).toContain('<trusted-production-skill-reference path="references/a.md">');
    expect(context).toContain('reference B');
    expect(() => buildTrustedSkillContext(manifest, [{ path: 'other.md', content: 'x' }])).toThrow('SKILL.md');
  });
});
