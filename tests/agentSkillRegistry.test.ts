import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SkillRegistry, BUNDLED_SKILL_IDS } from '../agent/skill-registry.js';

const MANIFEST_YAML = `schemaVersion: flovart.production-skill/1
id: community.demo
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
  source: https://hub.example.com/demo
`;

function writePackage(root: string, id: string, overrides: Partial<{ version: string }> = {}) {
  const dir = join(root, id);
  for (const sub of ['references', 'agents', 'assets', '.git']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: Demo Skill\n---\n# Demo\n', 'utf8');
  writeFileSync(join(dir, 'flovart.skill.yaml'), MANIFEST_YAML.replace('version: 1.0.0', `version: ${overrides.version || '1.0.0'}`), 'utf8');
  writeFileSync(join(dir, 'agents', 'openai.yaml'), 'interface:\n  display_name: Demo Skill\n  short_description: 演示用\n', 'utf8');
  writeFileSync(join(dir, 'references', 'creative-direction.md'), '# Direction\n', 'utf8');
  writeFileSync(join(dir, 'assets', 'cover.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'utf8'); // binary: excluded
  writeFileSync(join(dir, '.git', 'config'), 'ignored', 'utf8');
  return dir;
}

describe('agent SkillRegistry', () => {
  let repoRoot: string;
  let skillsRoot: string;
  let userRoot: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'flovart-skill-repo-'));
    skillsRoot = join(repoRoot, '.agents', 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    userRoot = mkdtempSync(join(tmpdir(), 'flovart-skill-user-'));
    registry = new SkillRegistry({ repoRoot, roots: [skillsRoot, userRoot] });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(userRoot, { recursive: true, force: true });
  });

  it('scans production and coding-agent packages and ignores binaries/git dirs', async () => {
    writePackage(skillsRoot, 'community.demo');
    mkdirSync(join(skillsRoot, 'plain-agent'), { recursive: true });
    writeFileSync(join(skillsRoot, 'plain-agent', 'SKILL.md'), '---\nname: Plain\n---\n# Plain\n', 'utf8');

    const skills = await registry.scan();
    expect(skills).toHaveLength(2);
    const production = skills.find(skill => skill.id === 'community.demo')!;
    expect(production).toMatchObject({
      kind: 'production',
      name: 'Demo Skill',
      description: '演示用',
      version: '1.0.0',
      location: 'project',
      trustTier: 'local-installed',
    });
    expect(production.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(skills.find(skill => skill.id === 'plain-agent')).toMatchObject({
      kind: 'coding-agent',
      name: 'Plain',
      version: null,
      contentHash: null,
    });
  });

  it('serves a manifest with a content hash stable across scans', async () => {
    writePackage(skillsRoot, 'community.demo');
    const first = await registry.manifest('community.demo');
    const second = await registry.manifest('community.demo');
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.files.map(file => file.path)).toEqual([
      'SKILL.md',
      'agents/openai.yaml',
      'flovart.skill.yaml',
      'references/creative-direction.md',
    ]);
    expect(first.capabilities).toEqual(['text.image']);
  });

  it('installs a validated package into the project root and rejects bad ones', async () => {
    const skill = await registry.installPackage({
      id: 'community.demo',
      version: '1.0.0',
      files: [
        { path: 'SKILL.md', content: '---\nname: Demo\n---\n# Demo\n' },
        { path: 'flovart.skill.yaml', content: MANIFEST_YAML },
        { path: 'references/creative-direction.md', content: '# D\n' },
      ],
    });
    expect(skill).toMatchObject({ id: 'community.demo', kind: 'production', version: '1.0.0' });
    expect(existsSync(join(skillsRoot, 'community.demo', 'SKILL.md'))).toBe(true);

    // duplicate install rejected
    await expect(registry.installPackage({
      id: 'community.demo',
      version: '1.0.0',
      files: [{ path: 'SKILL.md', content: 'x' }, { path: 'flovart.skill.yaml', content: MANIFEST_YAML }],
    })).rejects.toThrow('已安装');

    // bundled ids are protected
    await expect(registry.installPackage({
      id: 'community.vox-director',
      version: '1.0.0',
      files: [{ path: 'SKILL.md', content: 'x' }, { path: 'flovart.skill.yaml', content: MANIFEST_YAML }],
    })).rejects.toThrow('内置 Skill');

    // missing production manifest rejected
    await expect(registry.installPackage({
      id: 'community.nomanifest',
      version: '1.0.0',
      files: [{ path: 'SKILL.md', content: 'x' }],
    })).rejects.toThrow('flovart.skill.yaml');

    // version mismatch rejected
    const mismatchedManifest = MANIFEST_YAML.replace('id: community.demo', 'id: community.versioned');
    await expect(registry.installPackage({
      id: 'community.versioned',
      version: '9.9.9',
      files: [
        { path: 'SKILL.md', content: 'x' },
        { path: 'flovart.skill.yaml', content: mismatchedManifest },
      ],
    })).rejects.toThrow('版本');

    // path traversal rejected and nothing left behind
    const traversalManifest = MANIFEST_YAML.replace('id: community.demo', 'id: community.traversal');
    await expect(registry.installPackage({
      id: 'community.traversal',
      version: '1.0.0',
      files: [
        { path: 'SKILL.md', content: 'x' },
        { path: 'flovart.skill.yaml', content: traversalManifest },
        { path: '../evil.txt', content: 'boom' },
      ],
    })).rejects.toThrow('路径');
    expect(existsSync(join(skillsRoot, 'community.traversal'))).toBe(false);
    expect(existsSync(join(repoRoot, 'evil.txt'))).toBe(false);
  });

  it('uninstalls only project-owned packages and protects bundled ids', async () => {
    await registry.installPackage({
      id: 'community.demo',
      version: '1.0.0',
      files: [{ path: 'SKILL.md', content: 'x' }, { path: 'flovart.skill.yaml', content: MANIFEST_YAML }],
    });
    await registry.uninstall('community.demo');
    expect(existsSync(join(skillsRoot, 'community.demo'))).toBe(false);

    await expect(registry.uninstall('community.vox-director')).rejects.toThrow('不可卸载');
    await expect(registry.uninstall('missing.skill')).rejects.toThrow('未安装');
  });

  it('rejects oversized, duplicate, binary, and non-canonical network entries before creating a package', async () => {
    const cases = [
      [{ path: 'SKILL.md', content: 'x' }, { path: 'SKILL.md', content: 'duplicate' }],
      [{ path: 'SKILL.md', content: 'x' }, { path: 'assets/cover.png', content: 'binary' }],
      [{ path: 'SKILL.md', content: 'x' }, { path: '../escape.md', content: 'escape' }],
    ];
    for (const [index, files] of cases.entries()) {
      const id = `community.reject${index}`;
      const manifest = MANIFEST_YAML.replace('id: community.demo', `id: ${id}`);
      await expect(registry.installPackage({
        id,
        version: '1.0.0',
        files: [...files, { path: 'flovart.skill.yaml', content: manifest }],
      })).rejects.toThrow();
      expect(existsSync(join(skillsRoot, id))).toBe(false);
    }

    const oversizedId = 'community.oversized';
    const oversizedManifest = MANIFEST_YAML.replace('id: community.demo', `id: ${oversizedId}`);
    await expect(registry.installPackage({
      id: oversizedId,
      version: '1.0.0',
      files: [
        { path: 'SKILL.md', content: 'x'.repeat(1024 * 1024 + 1) },
        { path: 'flovart.skill.yaml', content: oversizedManifest },
      ],
    })).rejects.toThrow('大小');
    expect(existsSync(join(skillsRoot, oversizedId))).toBe(false);
  });

  it('resolves an installed package for agent binding by id+version', async () => {
    writePackage(userRoot, 'community.demo');
    const resolved = await registry.resolvePackage('community.demo', '1.0.0');
    expect(resolved).not.toBeNull();
    expect(resolved!.manifest.id).toBe('community.demo');
    expect(resolved!.entries.map(entry => entry.path)).toContain('references/creative-direction.md');
    expect(resolved!.entries.some(entry => entry.path === '.git/config')).toBe(false);
    expect(await registry.resolvePackage('community.demo', '2.0.0')).toBeNull();
    expect(await registry.resolvePackage('community.missing', '1.0.0')).toBeNull();
  });

  it('bundled ids are frozen for uninstall protection', () => {
    expect(BUNDLED_SKILL_IDS).toContain('community.vox-director');
  });

  it('ignores unreadable roots and non-directory entries', async () => {
    writeFileSync(join(userRoot, 'not-a-package.txt'), 'x', 'utf8');
    writeFileSync(join(skillsRoot, 'community.demo'), 'file-not-dir', 'utf8');
    const skills = await registry.scan();
    expect(skills.every(skill => skill.kind === 'production' || skill.kind === 'coding-agent')).toBe(true);
  });
});

describe('agent SkillRegistry.readFile (/api/skills/:id/file)', () => {
  let repoRoot: string;
  let skillsRoot: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'flovart-skill-file-'));
    skillsRoot = join(repoRoot, '.agents', 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    registry = new SkillRegistry({ repoRoot, roots: [skillsRoot] });
    const dir = writePackage(skillsRoot, 'community.demo');
    mkdirSync(join(dir, 'commands'), { recursive: true });
    writeFileSync(join(dir, 'commands', 'run.md'), '# Run\n', 'utf8');
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'install.md'), 'not for agents', 'utf8');
    writeFileSync(join(repoRoot, 'secret.md'), 'TOP SECRET', 'utf8');
    try { symlinkSync(join(repoRoot, 'secret.md'), join(dir, 'references', 'link.md')); } catch { /* 无符号链接权限时跳过该断言 */ }
  });

  afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

  it('reads SKILL.md and files under references/ or commands/', async () => {
    expect((await registry.readFile('community.demo')).content).toContain('# Demo');
    expect(await registry.readFile('community.demo', 'references/creative-direction.md')).toMatchObject({ path: 'references/creative-direction.md', content: '# Direction\n' });
    expect((await registry.readFile('community.demo', './commands/run.md')).content).toBe('# Run\n');
  });

  it.each([
    '../../secret.md', 'references/../../../secret.md', '/etc/passwd', 'C:/x.md', 'references\\..\\..\\secret.md',
    'scripts/install.md', 'flovart.skill.yaml', 'references/', 'assets/cover.png',
  ])('blocks %s', async path => {
    await expect(registry.readFile('community.demo', path)).rejects.toThrow(/不允许读取/);
  });

  it('blocks symlinks that leave the package and unknown ids', async () => {
    if (existsSync(join(skillsRoot, 'community.demo', 'references', 'link.md'))) {
      await expect(registry.readFile('community.demo', 'references/link.md')).rejects.toThrow(/没有文件/);
    }
    await expect(registry.readFile('community.demo', 'references/missing.md')).rejects.toThrow(/没有文件/);
    await expect(registry.readFile('../x', 'SKILL.md')).rejects.toThrow(/无效的 Skill id/);
    await expect(registry.readFile('community.missing', 'SKILL.md')).rejects.toThrow(/不在本机注册表/);
  });

  it('browser client calls /api/skills/:id/file with an encoded path', async () => {
    const { ManagedSkillRegistryClient } = await import('../services/localSkillRegistry');
    const calls: string[] = [];
    const client = new ManagedSkillRegistryClient({ url: 'http://127.0.0.1:1', token: 't' } as never, (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ ok: true, file: { path: 'references/a b.md', content: '# A' } }), { status: 200 });
    }) as never);
    expect(await client.readSkillFile('community.demo', 'references/a b.md')).toBe('# A');
    expect(calls).toEqual(['http://127.0.0.1:1/api/skills/community.demo/file?path=references%2Fa%20b.md']);
  });
});
