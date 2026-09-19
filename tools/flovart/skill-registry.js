// Node-side Skill registry: scans local Skill directories, installs/uninstalls
// packages under a project-owned `.agents/skills` root, and resolves packages
// for Agent binding. Lives inside the @flovart/cli package so both the CLI and
// the local Agent service share one implementation.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  SKILL_PACKAGE_MAX_FILE_BYTES,
  SKILL_PACKAGE_MAX_TOTAL_BYTES,
  buildTrustedSkillContext,
  canonicalSkillPackageEntries,
  hashSkillPackageEntries,
  isSkillPackagePath,
  parseOpenaiAgentMetadata,
  parseProductionSkillManifest,
  parseSkillFrontmatter,
  safeSkillPackageName,
  validateSkillPackageEntries,
} from './skill-package.js';

// Bundled skills ship inside the repository and cannot be uninstalled.
export const BUNDLED_SKILL_IDS = Object.freeze(['community.vox-director']);

export function defaultSkillRoots(repoRoot) {
  const roots = [
    path.join(repoRoot, '.agents', 'skills'),          // project-owned (bundled + app-managed installs)
    path.join(os.homedir(), '.claude', 'skills'),      // Claude Code user skills
    path.join(os.homedir(), '.codex', 'skills'),       // Codex user skills
    path.join(os.homedir(), '.flovart', 'skills'),     // app-managed user skills
  ];
  const extra = String(process.env.FLOVART_SKILLS_DIRS || '')
    .split(';').map(item => item.trim()).filter(Boolean);
  return [...roots, ...extra];
}

function entryLocation(root, repoRoot) {
  const resolved = path.resolve(root);
  if (resolved === path.resolve(path.join(repoRoot, '.agents', 'skills'))) return 'project';
  if (resolved === path.resolve(path.join(os.homedir(), '.flovart', 'skills'))) return 'app';
  return 'user-coding-agent';
}

export async function readSkillPackageEntries(packageDir) {
  const entries = [];
  let total = 0;
  async function walk(dir, relative) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    dirents.sort((left, right) => left.name.localeCompare(right.name));
    for (const dirent of dirents) {
      const childRelative = relative ? `${relative}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        await walk(path.join(dir, dirent.name), childRelative);
        continue;
      }
      if (!dirent.isFile() || !isSkillPackagePath(childRelative)) continue;
      const stat = await fs.stat(path.join(dir, dirent.name));
      if (stat.size > SKILL_PACKAGE_MAX_FILE_BYTES) continue;
      total += stat.size;
      if (total > SKILL_PACKAGE_MAX_TOTAL_BYTES) continue;
      let content;
      try {
        content = await fs.readFile(path.join(dir, dirent.name), 'utf8');
      } catch {
        continue; // binary/undecodable files are not package content
      }
      entries.push({ path: childRelative, content });
    }
  }
  await walk(packageDir, '');
  return canonicalSkillPackageEntries(entries);
}

export class SkillRegistry {
  constructor({ repoRoot, roots = defaultSkillRoots(repoRoot), installRoot = path.join(repoRoot, '.agents', 'skills') }) {
    this.repoRoot = repoRoot;
    this.roots = roots;
    this.installRoot = installRoot;
  }

  async scan() {
    const entries = [];
    for (const root of this.roots) {
      let packageDirs;
      try {
        packageDirs = await fs.readdir(root, { withFileTypes: true });
      } catch {
        continue; // missing/unreadable root is skipped
      }
      for (const dirent of packageDirs) {
        if (!dirent.isDirectory() || !safeSkillPackageName(dirent.name)) continue;
        const packageDir = path.join(root, dirent.name);
        const skill = await this.describePackage(packageDir, entryLocation(root, this.repoRoot));
        if (skill) entries.push(skill);
      }
    }
    // deterministic order: production skills first, then by id
    entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'production' ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
    return entries;
  }

  async describePackage(packageDir, location) {
    let entries;
    try {
      entries = await readSkillPackageEntries(packageDir);
    } catch {
      return null;
    }
    const hasSkillMarkdown = entries.some(entry => entry.path === 'SKILL.md');
    if (!hasSkillMarkdown) return null;
    const manifestYaml = entries.find(entry => entry.path === 'flovart.skill.yaml');
    if (manifestYaml) {
      try {
        const manifest = parseProductionSkillManifest(manifestYaml.content);
        if (!safeSkillPackageName(manifest.id)) return null;
        const openaiYaml = entries.find(entry => entry.path === 'agents/openai.yaml');
        const openai = openaiYaml ? parseOpenaiAgentMetadata(openaiYaml.content) : { displayName: '', shortDescription: '' };
        const frontmatter = parseSkillFrontmatter(entries.find(entry => entry.path === 'SKILL.md')?.content || '');
        const contentHash = await hashSkillPackageEntries(entries);
        return {
          id: manifest.id,
          name: openai.displayName || frontmatter.name || manifest.id,
          description: openai.shortDescription || frontmatter.description || '',
          version: manifest.version,
          kind: 'production',
          trustTier: manifest.trustTier,
          location,
          packageDir,
          contentHash,
          fileCount: entries.length,
          installedAt: undefined,
        };
      } catch {
        return null; // invalid production manifest: do not surface
      }
    }
    const skillMarkdown = entries.find(entry => entry.path === 'SKILL.md')?.content || '';
    const frontmatter = parseSkillFrontmatter(skillMarkdown);
    return {
      id: path.basename(packageDir),
      name: frontmatter.name || path.basename(packageDir),
      description: frontmatter.description || '',
      version: null,
      kind: 'coding-agent',
      trustTier: 'local',
      location,
      packageDir,
      contentHash: null,
      fileCount: entries.length,
      installedAt: undefined,
    };
  }

  async manifest(id) {
    if (!safeSkillPackageName(id)) throw new Error(`无效的 Skill id：${id}`);
    const skills = await this.scan();
    const skill = skills.find(item => item.id === id && item.kind === 'production');
    if (!skill) throw new Error(`Skill 不在本机注册表：${id}`);
    const entries = await readSkillPackageEntries(skill.packageDir);
    const manifestYaml = entries.find(entry => entry.path === 'flovart.skill.yaml');
    if (!manifestYaml) throw new Error(`Skill ${id} 缺少 flovart.skill.yaml`);
    const manifest = parseProductionSkillManifest(manifestYaml.content);
    return {
      id,
      version: skill.version,
      contentHash: skill.contentHash,
      displayName: skill.name,
      trustTier: skill.trustTier,
      capabilities: manifest.capabilities,
      gates: manifest.gates,
      permissions: manifest.permissions,
      files: entries.map(entry => ({ path: entry.path, size: entry.content.length })),
    };
  }

  async installPackage({ id, version, files }) {
    if (!safeSkillPackageName(id)) throw new Error(`无效的 Skill id：${id}`);
    if (BUNDLED_SKILL_IDS.includes(id)) throw new Error(`内置 Skill 不可重复安装：${id}`);
    const entries = validateSkillPackageEntries(files);
    if (!entries.some(entry => entry.path === 'SKILL.md')) throw new Error('Skill 包缺少 SKILL.md');
    const manifestYaml = entries.find(entry => entry.path === 'flovart.skill.yaml');
    if (!manifestYaml) throw new Error('Production Skill 包缺少 flovart.skill.yaml');
    const manifest = parseProductionSkillManifest(manifestYaml.content);
    if (manifest.id !== id) throw new Error(`包内 manifest id 与请求不一致：${manifest.id} ≠ ${id}`);
    if (version !== undefined && manifest.version !== version) {
      throw new Error(`包版本与请求不一致：${manifest.version} ≠ ${version}`);
    }
    const packageDir = path.join(this.installRoot, id);
    try {
      await fs.stat(packageDir);
      throw new Error(`本机已安装同名 Skill：${id}。请先卸载再安装。`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await fs.mkdir(packageDir, { recursive: true });
    try {
      for (const entry of entries) {
        const relative = entry.path.split('/');
        const safeRelative = relative.every(part => part && part !== '.' && part !== '..' && !part.includes('\\') && !part.includes(':'))
          ? relative
          : null;
        if (!safeRelative) throw new Error(`Skill 包路径非法：${entry.path}`);
        const target = path.join(packageDir, ...safeRelative);
        if (path.resolve(target).startsWith(path.resolve(packageDir) + path.sep) === false) {
          throw new Error(`Skill 包路径越界：${entry.path}`);
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, entry.content, 'utf8');
      }
    } catch (error) {
      await fs.rm(packageDir, { recursive: true, force: true });
      throw error;
    }
    const skill = await this.describePackage(packageDir, 'project');
    if (!skill) throw new Error(`安装完成但校验失败：${id}`);
    return skill;
  }

  async uninstall(id) {
    if (!safeSkillPackageName(id)) throw new Error(`无效的 Skill id：${id}`);
    if (BUNDLED_SKILL_IDS.includes(id)) throw new Error(`内置 Skill 不可卸载：${id}`);
    const packageDir = path.join(this.installRoot, id);
    let stat;
    try {
      stat = await fs.stat(packageDir);
    } catch {
      throw new Error(`本机未安装该 Skill：${id}`);
    }
    if (!stat.isDirectory()) throw new Error(`本机 Skill 路径异常：${id}`);
    if (path.resolve(packageDir).startsWith(path.resolve(this.installRoot) + path.sep) === false) {
      throw new Error(`拒绝卸载项目目录之外的 Skill：${id}`);
    }
    await fs.rm(packageDir, { recursive: true, force: true });
  }

  /** Resolve one production package by id+version across all roots (for Agent binding). */
  async resolvePackage(id, version) {
    if (!safeSkillPackageName(id)) return null;
    const skills = await this.scan();
    const skill = skills.find(item => item.id === id && item.kind === 'production' && item.version === version);
    if (!skill) return null;
    const entries = await readSkillPackageEntries(skill.packageDir);
    const manifestYaml = entries.find(entry => entry.path === 'flovart.skill.yaml');
    if (!manifestYaml) return null;
    const manifest = parseProductionSkillManifest(manifestYaml.content);
    const openaiYaml = entries.find(entry => entry.path === 'agents/openai.yaml');
    const openai = openaiYaml ? parseOpenaiAgentMetadata(openaiYaml.content) : { displayName: '', shortDescription: '' };
    return {
      manifest,
      entries,
      contentHash: await hashSkillPackageEntries(entries),
      packageDir: skill.packageDir,
      displayName: openai.displayName || skill.name,
    };
  }
}

export { buildTrustedSkillContext };
