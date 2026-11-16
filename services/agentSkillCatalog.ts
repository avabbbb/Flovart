// 内置 Agent 的技能来源：构建时打包的 .agents/skills/*（SKILL.md 同步、references/ 与 commands/ 按需懒加载），
// 外加本机 Agent 服务注册表里安装的技能（有 Managed Agent 连接时，经 /api/skills 与 /api/skills/:id/file 读取）。
import type { AgentSkillCatalog, AgentSkillEntry } from './agentSkills';
import { parseSkillFrontmatterBlock } from './agentSkills';
import type { LocalSkillEntry } from './localSkillRegistry';

const skillMarkdown = import.meta.glob('../.agents/skills/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const skillManifests = import.meta.glob('../.agents/skills/*/flovart.skill.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const skillFiles = import.meta.glob([
  '../.agents/skills/*/references/**/*.{md,markdown,txt,json,yaml,yml}',
  '../.agents/skills/*/commands/**/*.{md,markdown,txt,json,yaml,yml}',
], { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

const PREFIX = '../.agents/skills/';

function splitGlobPath(key: string): { dir: string; file: string } | null {
  if (!key.startsWith(PREFIX)) return null;
  const rest = key.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  return slash > 0 ? { dir: rest.slice(0, slash), file: rest.slice(slash + 1) } : null;
}

/** flovart.skill.yaml 里的 id（如 community.vox-director），用作别名；只取顶层 id 行。 */
export function manifestSkillId(yaml: string): string | null {
  const match = /^id:\s*["']?([0-9A-Za-z][0-9A-Za-z._-]*)["']?\s*$/m.exec(String(yaml || ''));
  return match ? match[1] : null;
}

/** 由 SKILL.md 原文（+ 可选 manifest）生成索引项。 */
export function skillEntryFromMarkdown(dir: string, markdown: string, manifestYaml?: string, source: AgentSkillEntry['source'] = 'project'): AgentSkillEntry {
  const frontmatter = parseSkillFrontmatterBlock(markdown);
  const aliases = new Set<string>();
  const manifestId = manifestYaml ? manifestSkillId(manifestYaml) : null;
  if (manifestId && manifestId !== dir) aliases.add(manifestId);
  if (frontmatter.name && frontmatter.name !== dir && /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(frontmatter.name)) aliases.add(frontmatter.name);
  return {
    id: dir,
    aliases: [...aliases],
    name: frontmatter.name || dir,
    description: frontmatter.description || frontmatter.name || dir,
    source: manifestId ? 'bundled' : source,
  };
}

interface BundledPackage {
  entry: AgentSkillEntry;
  markdown: string;
  files: Map<string, () => Promise<string>>;
}

function loadBundledPackages(): Map<string, BundledPackage> {
  const packages = new Map<string, BundledPackage>();
  for (const [key, markdown] of Object.entries(skillMarkdown)) {
    const parsed = splitGlobPath(key);
    if (!parsed) continue;
    const manifest = skillManifests[`${PREFIX}${parsed.dir}/flovart.skill.yaml`];
    packages.set(parsed.dir, { entry: skillEntryFromMarkdown(parsed.dir, markdown, manifest), markdown, files: new Map() });
  }
  for (const [key, load] of Object.entries(skillFiles)) {
    const parsed = splitGlobPath(key);
    const pkg = parsed && packages.get(parsed.dir);
    if (pkg) pkg.files.set(parsed!.file, load);
  }
  return packages;
}

let bundledCache: Map<string, BundledPackage> | null = null;

/** 打包进前端的技能（.agents/skills/*）。 */
export function createBundledSkillCatalog(): AgentSkillCatalog {
  bundledCache ??= loadBundledPackages();
  const packages = bundledCache;
  return {
    list: () => [...packages.values()].map(pkg => pkg.entry),
    files: id => {
      const pkg = packages.get(id);
      return pkg ? ['SKILL.md', ...[...pkg.files.keys()].sort()] : [];
    },
    read: async (id, file) => {
      const pkg = packages.get(id);
      if (!pkg) return null;
      if (file === 'SKILL.md') return pkg.markdown;
      const load = pkg.files.get(file);
      return load ? load() : null;
    },
  };
}

/** 本机注册表读取接口（ManagedSkillRegistryClient 的子集，测试可注入替身）。 */
export interface RemoteSkillSource {
  listLocalSkills(): Promise<LocalSkillEntry[]>;
  readSkillFile(id: string, path: string): Promise<string>;
}

/**
 * 合并多个来源：先到先得（打包技能优先），列表按 id / 别名去重。
 * remote 可在之后异步补充（本机注册表连接成功时）。
 */
export class MergedSkillCatalog implements AgentSkillCatalog {
  private remoteEntries: AgentSkillEntry[] = [];
  private remote: RemoteSkillSource | null = null;

  constructor(private readonly base: AgentSkillCatalog = createBundledSkillCatalog()) {}

  /** 拉取本机注册表的技能列表；失败时保持只有打包技能。 */
  async attachRemote(remote: RemoteSkillSource): Promise<void> {
    try {
      const skills = await remote.listLocalSkills();
      this.remote = remote;
      this.remoteEntries = skills.map(skill => ({
        id: skill.id,
        aliases: skill.name && skill.name !== skill.id && /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(skill.name) ? [skill.name] : [],
        name: skill.name || skill.id,
        description: skill.description || skill.name || skill.id,
        source: 'local' as const,
      }));
    } catch {
      this.remote = null;
      this.remoteEntries = [];
    }
  }

  list(): AgentSkillEntry[] {
    const base = this.base.list();
    const known = new Set(base.flatMap(entry => [entry.id, ...entry.aliases].map(key => key.toLowerCase())));
    return [...base, ...this.remoteEntries.filter(entry => ![entry.id, ...entry.aliases].some(key => known.has(key.toLowerCase())))];
  }

  files(id: string): string[] {
    return this.base.files?.(id) || [];
  }

  async read(id: string, file: string): Promise<string | null> {
    const local = await this.base.read(id, file);
    if (local != null) return local;
    if (!this.remote || !this.remoteEntries.some(entry => entry.id === id)) return null;
    try {
      return await this.remote.readSkillFile(id, file);
    } catch {
      return null;
    }
  }
}
