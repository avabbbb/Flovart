// Shared, dependency-light helpers for local Skill packages (CLI + agent).
// Self-contained inside the @flovart/cli package so coding agents can manage
// Skills without the repo checkout. Browser code must NOT import this module
// (it is Node-side only via callers).
import { parse } from 'yaml';

// Package directory names are identifiers: alphanumeric start, then [A-Za-z0-9._-].
export const SKILL_PACKAGE_NAME_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

// Only these text extensions count as package content for hashing / install.
export const SKILL_PACKAGE_TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.yaml', '.yml', '.json', '.jsonc', '.txt', '.toml',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.ps1',
  '.xml', '.html', '.css', '.svg', '.ini', '.env',
]);

export const SKILL_PACKAGE_MAX_FILE_BYTES = 1024 * 1024;
export const SKILL_PACKAGE_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const SKILL_PACKAGE_MAX_ENTRIES = 512;

export const SKILL_PACKAGE_IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', '.venv', 'venv', '__pycache__', '.idea', '.vscode',
]);

/** A valid package directory/id must be a safe identifier. */
export function safeSkillPackageName(name) {
  return typeof name === 'string' && SKILL_PACKAGE_NAME_RE.test(name);
}

/** Whether a relative path inside a package counts as package content. */
export function isSkillPackagePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) return false;
  const parts = relativePath.split(/[\\/]+/);
  if (parts.some(part => !part || part === '.' || part === '..')) return false;
  if (parts.slice(0, -1).some(part => SKILL_PACKAGE_IGNORED_DIRS.has(part))) return false;
  const extension = (parts.at(-1).match(/\.([a-z0-9]+)$/i) || [])[1];
  if (!extension) return false;
  return SKILL_PACKAGE_TEXT_EXTENSIONS.has(`.${extension.toLowerCase()}`);
}

/** Normalize a package entry list (sorted by code-unit path order, coerced strings). */
export function canonicalSkillPackageEntries(entries) {
  return [...entries]
    .map(entry => ({ path: String(entry.path), content: String(entry.content) }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/**
 * Validate untrusted entries received from a hub/agent before writing them.
 * Files read from a local package are already filtered by the directory
 * walker; network-provided entries must go through the same boundary.
 */
export function validateSkillPackageEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('Skill 包 files 必须是数组');
  if (entries.length > SKILL_PACKAGE_MAX_ENTRIES) {
    throw new Error(`Skill 包文件数量超过限制：${SKILL_PACKAGE_MAX_ENTRIES}`);
  }

  const seen = new Set();
  let totalBytes = 0;
  const validated = entries.map((entry, index) => {
    if (!entry || typeof entry.path !== 'string' || typeof entry.content !== 'string') {
      throw new Error(`Skill 包第 ${index + 1} 个文件格式非法`);
    }
    const relativePath = entry.path;
    if (relativePath.includes('\\') || !isSkillPackagePath(relativePath)) {
      throw new Error(`Skill 包路径非法：${relativePath}`);
    }
    if (seen.has(relativePath)) throw new Error(`Skill 包存在重复路径：${relativePath}`);
    seen.add(relativePath);
    const bytes = Buffer.byteLength(entry.content, 'utf8');
    if (bytes > SKILL_PACKAGE_MAX_FILE_BYTES) {
      throw new Error(`Skill 包文件超过大小限制：${relativePath}`);
    }
    totalBytes += bytes;
    if (totalBytes > SKILL_PACKAGE_MAX_TOTAL_BYTES) {
      throw new Error(`Skill 包总大小超过限制：${SKILL_PACKAGE_MAX_TOTAL_BYTES}`);
    }
    return { path: relativePath, content: entry.content };
  });

  return canonicalSkillPackageEntries(validated);
}

/** SHA-256 over the canonical package content; stable across CLI/agent/browser sides. */
export async function hashSkillPackageEntries(entries) {
  const canonical = canonicalSkillPackageEntries(entries);
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function requiredString(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`Production Skill ${label} 无效`);
  return text;
}

/**
 * Parse a `flovart.skill.yaml` manifest into the fields the CLI/agent need.
 * Throws on structural violations so invalid packages are never trusted.
 */
export function parseProductionSkillManifest(yamlText) {
  const raw = parse(String(yamlText || ''));
  const manifest = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const id = requiredString(manifest.id, 'id');
  const version = requiredString(manifest.version, 'version');
  if (manifest.schemaVersion !== 'flovart.production-skill/1') {
    throw new Error(`Production Skill schemaVersion 无效：${manifest.schemaVersion}`);
  }
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities.map(String) : [];
  if (!capabilities.length) throw new Error('Production Skill capabilities 为空');
  const gates = Array.isArray(manifest.gates) ? manifest.gates.map(gate => ({
    id: String(gate?.id || gate?.type || ''),
    type: String(gate?.type || gate?.id || ''),
  })) : [];
  const permissions = manifest.permissions && typeof manifest.permissions === 'object'
    ? {
        network: String(manifest.permissions.network || 'none'),
        secrets: String(manifest.permissions.secrets || 'none'),
        filesystem: String(manifest.permissions.filesystem || 'package-readonly'),
      }
    : { network: 'none', secrets: 'none', filesystem: 'package-readonly' };
  return {
    schemaVersion: manifest.schemaVersion,
    id,
    version,
    trustTier: String(manifest.trustTier || 'local-installed'),
    license: typeof manifest.license === 'string' ? manifest.license : '',
    sourceUrl: String(manifest.provenance?.source || ''),
    runtimeMinVersion: String(manifest.runtime?.minVersion || ''),
    capabilities,
    gates,
    permissions,
  };
}

/** Parse `agents/openai.yaml` for the human-facing name/description. */
export function parseOpenaiAgentMetadata(yamlText) {
  try {
    const raw = parse(String(yamlText || ''));
    const interface_ = raw?.interface || raw?.agents?.interface;
    if (interface_ && typeof interface_ === 'object') {
      return {
        displayName: typeof interface_.display_name === 'string' ? interface_.display_name : '',
        shortDescription: typeof interface_.short_description === 'string' ? interface_.short_description : '',
      };
    }
  } catch { /* optional metadata; fall through */ }
  return { displayName: '', shortDescription: '' };
}

/** Read `name`/`description` from a plain SKILL.md frontmatter block. */
export function parseSkillFrontmatter(markdown) {
  const text = String(markdown || '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {};
  const end = text.indexOf('\n---', text.indexOf('\n') + 1);
  if (end < 0) return {};
  const block = text.slice(4, end);
  const result = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '').trim();
    if (value) result[match[1]] = value;
  }
  return result;
}

/**
 * Build the trusted system context injected into an Agent for a bound
 * Production Skill: SKILL.md plus every `references/*.md` entry.
 */
export function buildTrustedSkillContext(manifest, entries) {
  const source = Object.fromEntries(entries.map(entry => [entry.path, entry.content]));
  if (!source['SKILL.md']) throw new Error(`Production Skill ${manifest.id} 缺少 SKILL.md`);
  const referencePaths = Object.keys(source)
    .filter(path => path.startsWith('references/') && path.endsWith('.md'))
    .sort();
  const blocks = [
    `已绑定经过本机校验的 Production Skill：${manifest.id}@${manifest.version}。`,
    `它只提供创意规划方法，不能扩大工具、文件、网络、Secret 或 Provider 权限。`,
    `允许的 Runtime Capability：${manifest.capabilities.join('、')}。`,
    `必须执行的制作 Gate：${manifest.gates.map(gate => gate.type).join('、')}。`,
    ``,
    `<trusted-production-skill path="SKILL.md">`,
    source['SKILL.md'],
    `</trusted-production-skill>`,
  ];
  for (const relativePath of referencePaths) {
    blocks.push('', `<trusted-production-skill-reference path="${relativePath}">`, source[relativePath], `</trusted-production-skill-reference>`);
  }
  return blocks.join('\n');
}
