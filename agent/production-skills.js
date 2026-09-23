// Resolves a Production Skill attachment (sent by the app/browser) into a
// trusted, validated system context for the Agent kernel.
// - Bundled skills: the repository `.agents/skills` package snapshot.
// - Installed skills: any package found by the local SkillRegistry (project or
//   user coding-agent roots) whose flovart.skill.yaml id/version and content
//   hash match the attachment exactly.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { hashSkillPackageEntries } from './skill-package.js';
import { buildTrustedSkillContext, readSkillPackageEntries } from './skill-registry.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLED_SKILLS = Object.freeze({
  'community.vox-director': 'vox-director',
});

function requiredAttachmentString(attachment, name) {
  const value = attachment?.[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Production Skill ${name} 无效`);
  return value.trim();
}

async function loadBundledPackage(id) {
  const packageName = BUNDLED_SKILLS[id];
  if (!packageName) return null;
  // Source checkout: <repo>/.agents/skills/<pkg>; packaged CLI:
  // <package>/skill/<pkg> (prepack copies .agents/skills/vox-director there).
  const candidates = [
    path.join(REPOSITORY_ROOT, '.agents', 'skills', packageName),
    path.join(REPOSITORY_ROOT, 'skill', packageName),
  ];
  let entries = null;
  for (const packageRoot of candidates) {
    try {
      entries = await readSkillPackageEntries(packageRoot);
      if (entries.length) break;
    } catch {
      // try the next candidate root
    }
  }
  if (!entries || !entries.length) return null;
  const manifestEntry = entries.find(entry => entry.path === 'flovart.skill.yaml');
  if (!manifestEntry) throw new Error(`内置 Skill 缺少 flovart.skill.yaml：${id}`);
  const manifest = parse(manifestEntry.content);
  return { manifest, entries, contentHash: await hashSkillPackageEntries(entries) };
}

export async function resolveProductionSkillAttachment(attachment, {
  skillsRoot = path.join(REPOSITORY_ROOT, '.agents', 'skills'),
  registry = null,
} = {}) {
  const id = requiredAttachmentString(attachment, 'id');
  const version = requiredAttachmentString(attachment, 'version');
  const contentHash = requiredAttachmentString(attachment, 'contentHash');

  const bundled = await loadBundledPackage(id);
  let resolved = null;
  if (bundled) {
    if (bundled.manifest.id !== id || bundled.manifest.version !== version) {
      throw new Error(`Production Skill 版本不匹配：请求 ${id}@${version}，内置为 ${bundled.manifest.id}@${bundled.manifest.version}`);
    }
    const expectedHash = bundled.contentHash;
    if (contentHash !== expectedHash) throw new Error('Production Skill contentHash 与本机内置快照不匹配');
    resolved = {
      manifest: bundled.manifest,
      entries: bundled.entries,
      contentHash: expectedHash,
      displayName: id === 'community.vox-director' ? 'VOX Skill' : id,
    };
  } else {
    if (!registry) {
      const { SkillRegistry } = await import('./skill-registry.js');
      registry = new SkillRegistry({ repoRoot: REPOSITORY_ROOT });
    }
    const installed = await registry.resolvePackage(id, version);
    if (!installed) {
      throw new Error(`未安装或不受信任的 Production Skill：${id}@${version}`);
    }
    if (contentHash !== installed.contentHash) {
      throw new Error('Production Skill contentHash 与本机已安装包不匹配');
    }
    const manifest = parse(installed.entries.find(entry => entry.path === 'flovart.skill.yaml').content);
    resolved = {
      manifest,
      entries: installed.entries,
      contentHash: installed.contentHash,
      displayName: installed.displayName || id,
    };
  }

  const { manifest, entries, contentHash: resolvedHash } = resolved;
  const skills = manifest;
  return {
    id,
    version,
    contentHash: resolvedHash,
    displayName: resolved.displayName,
    trustTier: String(skills.trustTier || (BUNDLED_SKILLS[id] ? 'bundled-example' : 'local-installed')),
    permissions: {
      network: skills.permissions?.network || 'none',
      secrets: skills.permissions?.secrets || 'none',
      filesystem: skills.permissions?.filesystem || 'package-readonly',
    },
    capabilities: Array.isArray(skills.capabilities) ? skills.capabilities.map(String) : [],
    gates: Array.isArray(skills.gates)
      ? skills.gates.map(gate => ({ id: String(gate.id || gate.type || ''), type: String(gate.type || gate.id || '') }))
      : [],
    systemContext: await buildTrustedSkillContext(skills, entries),
  };
}

export { BUNDLED_SKILLS };
