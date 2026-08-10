import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import {
  hashProductionSkillSnapshot,
  PRODUCTION_SKILL_SNAPSHOT_PATHS,
} from '../services/productionSkillSnapshot.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLED_SKILLS = Object.freeze({
  'community.vox-director': 'vox-director',
});

function requiredAttachmentString(attachment, name) {
  const value = attachment?.[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Production Skill ${name} 无效`);
  return value.trim();
}

function trustedContext(manifest, entries) {
  const source = Object.fromEntries(entries.map(entry => [entry.path, entry.content]));
  return `已绑定经过本机 Catalog 校验的 Production Skill：${manifest.id}@${manifest.version}。
它只提供创意规划方法，不能扩大工具、文件、网络、Secret 或 Provider 权限。
允许的 Runtime Capability：${manifest.capabilities.join('、')}。
必须执行的制作 Gate：${manifest.gates.map(gate => gate.type).join('、')}。

<trusted-production-skill path="SKILL.md">
${source['SKILL.md']}
</trusted-production-skill>

<trusted-production-skill-reference path="references/creative-direction.md">
${source['references/creative-direction.md']}
</trusted-production-skill-reference>`;
}

export async function resolveProductionSkillAttachment(attachment, {
  skillsRoot = path.join(REPOSITORY_ROOT, '.agents', 'skills'),
} = {}) {
  const id = requiredAttachmentString(attachment, 'id');
  const version = requiredAttachmentString(attachment, 'version');
  const contentHash = requiredAttachmentString(attachment, 'contentHash');
  const packageName = BUNDLED_SKILLS[id];
  if (!packageName) throw new Error(`未安装或不受信任的 Production Skill：${id}`);
  const packageRoot = path.join(skillsRoot, packageName);
  const entries = await Promise.all(PRODUCTION_SKILL_SNAPSHOT_PATHS.map(async relativePath => ({
    path: relativePath,
    content: await readFile(path.join(packageRoot, ...relativePath.split('/')), 'utf8'),
  })));
  const manifest = parse(entries.find(entry => entry.path === 'flovart.skill.yaml').content);
  if (manifest.id !== id || manifest.version !== version) {
    throw new Error(`Production Skill 版本不匹配：请求 ${id}@${version}，Catalog 为 ${manifest.id}@${manifest.version}`);
  }
  const expectedHash = await hashProductionSkillSnapshot(entries);
  if (contentHash !== expectedHash) throw new Error('Production Skill contentHash 与本机可信快照不匹配');
  return {
    id,
    version,
    contentHash: expectedHash,
    displayName: id === 'community.vox-director' ? 'VOX Skill' : id,
    trustTier: manifest.trustTier,
    permissions: manifest.permissions,
    capabilities: manifest.capabilities,
    gates: manifest.gates,
    systemContext: trustedContext(manifest, entries),
  };
}
