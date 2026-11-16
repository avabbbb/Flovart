import { Check, Clapperboard, ExternalLink, Film, Heart, Layers, Palette, Pencil, Plus, RefreshCw, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getBundledProductionSkill, listBundledProductionSkills } from '../../services/productionSkillCatalog';
import { createLocalSkillRegistry, skillRegistryErrorMessage, type LocalSkillManifest } from '../../services/localSkillRegistry';
import { hubSkillExternalUrl } from '../../services/skillHubClient';
import { productionSkillHandle } from '../../services/productionSkillLaunch';
import { useSkillHubStore } from '../../stores/useSkillHubStore';
import { isSkillEnabled, useUserSkillsStore } from '../../stores/useUserSkillsStore';

// Skill 列表的共享部件：Composer 里的 Skill 浮层（ProductionSkillDeck）与放大的 Skills 窗口（StudioHub）共用
// 同一份目录、详情、编辑器与图标方块，保证两处的增删改查与状态完全一致。
export const SKILL_COPY = {
  en: {
    installedDescription: 'A Production Skill installed locally.',
    hubDescription: 'A Skill from an external hub.',
    missingBundled: 'Built-in Skill is unavailable',
    desktopRequired: 'Connect a desktop Managed Agent to choose a local Skill.',
    configureHub: 'Enter a Skill Hub address first.',
    welcome: 'Every Skill opens a new direction',
    recommendedSkills: 'Recommended production Skills',
    shuffle: 'Shuffle',
    useSkill: (name: string) => `Use Skill ${name}`,
    remove: (name: string) => `Remove ${name}`,
    chooseSkill: 'Choose a production Skill',
    title: 'Skills',
    create: 'New',
    close: 'Close Skill picker',
    back: 'Back to Skills',
    search: 'Search Skills',
    sectionMine: 'My Skills',
    sectionInstalled: 'Installed',
    sectionHub: 'From Skill Hub',
    mineEmpty: 'No Skills of your own yet.',
    desktopScan: 'Connect the desktop app to scan local Skill folders.',
    noMatch: 'No matching Skills found.',
    noLocal: 'No Production Skills are available locally.',
    hubAddress: 'Skill Hub address',
    syncing: 'Syncing',
    sync: 'Sync',
    hubFailed: 'Skill Hub sync failed.',
    hubEmpty: 'No Skills in this hub, or no address is configured.',
    viewHub: (name: string) => `View ${name} in Skill Hub`,
    update: 'Update',
    added: 'Added',
    inUse: 'In use',
    disabled: 'Off',
    install: (name: string) => `Install ${name}`,
    retry: 'Retry',
    installShort: 'Install',
    viewInHub: 'View in Hub',
    add: (name: string) => `Add ${name}`,
    details: (name: string) => `${name} details`,
    favorite: (name: string) => `Add ${name} to favorites`,
    unfavorite: (name: string) => `Remove ${name} from favorites`,
    use: 'Use',
    enabled: 'Enabled',
    edit: 'Edit',
    delete: 'Delete',
    uninstall: 'Uninstall',
    confirmDelete: (name: string) => `Delete “${name}”?`,
    confirmUninstall: (name: string) => `Uninstall “${name}” from this computer?`,
    cancel: 'Cancel',
    deleted: (name: string) => `Deleted “${name}”`,
    undo: 'Undo',
    sourceBundled: 'Built-in · read-only',
    sourceLocal: 'Local package',
    sourceMine: 'My Skill',
    sourceHub: 'Skill Hub',
    version: 'Version',
    capabilities: 'Capabilities',
    permissions: 'Permissions',
    files: 'Files',
    instructions: 'Instructions',
    preview: 'SKILL.md preview',
    createdAt: 'Created',
    updatedAt: 'Updated',
    recipeSteps: (count: number) => `Saved from a canvas group · ${count} steps`,
    bundledReadonly: 'Built-in Skills ship with Flovart and cannot be edited or deleted.',
    localEditHint: 'Local packages are edited in their folder; refresh to re-read them.',
    refresh: 'Refresh',
    manifestLoading: 'Reading the package…',
    hubNotInstalled: 'Not installed',
    hubInstalled: 'Installed on this computer',
    newSkill: 'New Skill',
    editSkill: 'Edit Skill',
    name: 'Name',
    slug: 'Handle',
    description: 'Description',
    prompt: 'Instructions',
    promptPlaceholder: 'What should the Agent do when this Skill is on?',
    enableSkill: 'Enabled',
    save: 'Save',
    tabAll: 'All',
    tabFavorites: 'Liked',
    tabMine: 'Mine',
    searchToggle: 'Search',
    createMenu: 'Create',
    createBlank: 'Blank Skill',
    createFromTemplate: 'From template',
    createImport: 'Import SKILL.md / JSON',
    importFailed: 'Could not read this file as a Skill.',
    more: 'More',
    viewMore: 'View more',
    like: 'Like',
    unlike: 'Unlike',
    favoritesEmpty: 'Like a Skill to keep it here.',
    hubSource: 'Skill Hub source',
    templateLabel: (name: string) => `Template: ${name}`,
  },
  zho: {
    installedDescription: '本地已安装的 Production Skill。',
    hubDescription: '来自外部 Skill Hub。',
    missingBundled: '内置 Skill 不存在',
    desktopRequired: '选择本地 Skill 需要桌面端 Managed Agent 连接。',
    configureHub: '请先配置 Skill Hub 地址。',
    welcome: '每个 Skill，都是一个开场',
    recommendedSkills: '推荐制作 Skill',
    shuffle: '换一批',
    useSkill: (name: string) => `使用 Skill ${name}`,
    remove: (name: string) => `移除 ${name}`,
    chooseSkill: '选择制作 Skill',
    title: 'Skill',
    create: '新建',
    close: '关闭 Skill',
    back: '返回 Skill 列表',
    search: '搜索技能',
    sectionMine: '我的 Skill',
    sectionInstalled: '已安装',
    sectionHub: '来自 Skill Hub',
    mineEmpty: '还没有自建 Skill',
    desktopScan: '连接桌面端后可扫描本机 Skill 目录',
    noMatch: '未找到匹配的 Skill',
    noLocal: '本机还没有可用的 Production Skill',
    hubAddress: 'Skill Hub 地址',
    syncing: '同步中',
    sync: '同步',
    hubFailed: 'Hub 同步失败',
    hubEmpty: 'Hub 暂无 Skill，或尚未配置地址',
    viewHub: (name: string) => `在 Hub 查看 ${name}`,
    update: '更新',
    added: '已添加',
    inUse: '使用中',
    disabled: '已停用',
    install: (name: string) => `安装 ${name}`,
    retry: '重试',
    installShort: '安装',
    viewInHub: '在 Hub 查看',
    add: (name: string) => `添加 ${name}`,
    details: (name: string) => `查看 ${name} 详情`,
    favorite: (name: string) => `收藏 ${name}`,
    unfavorite: (name: string) => `取消收藏 ${name}`,
    use: '使用',
    enabled: '启用',
    edit: '编辑',
    delete: '删除',
    uninstall: '卸载',
    confirmDelete: (name: string) => `删除「${name}」？`,
    confirmUninstall: (name: string) => `从本机卸载「${name}」？`,
    cancel: '取消',
    deleted: (name: string) => `已删除「${name}」`,
    undo: '撤销',
    sourceBundled: '内置 · 只读',
    sourceLocal: '本机 Skill 包',
    sourceMine: '我的 Skill',
    sourceHub: 'Skill Hub',
    version: '版本',
    capabilities: '能力',
    permissions: '权限',
    files: '文件',
    instructions: '指令',
    preview: 'SKILL.md 预览',
    createdAt: '创建于',
    updatedAt: '更新于',
    recipeSteps: (count: number) => `由画布分组保存 · ${count} 步`,
    bundledReadonly: '内置 Skill 随 Flovart 发布，不能编辑或删除。',
    localEditHint: '本机 Skill 包在其目录中修改，改完点「刷新」重新读取。',
    refresh: '刷新',
    manifestLoading: '正在读取 Skill 包…',
    hubNotInstalled: '未安装',
    hubInstalled: '已安装到本机',
    newSkill: '新建 Skill',
    editSkill: '编辑 Skill',
    name: '名称',
    slug: '触发词',
    description: '说明',
    prompt: '指令',
    promptPlaceholder: '启用这个 Skill 时，Agent 应该怎么做？',
    enableSkill: '启用',
    save: '保存',
    tabAll: '综合',
    tabFavorites: '喜欢',
    tabMine: '我的',
    searchToggle: '搜索',
    createMenu: '创建',
    createBlank: '新建空白',
    createFromTemplate: '从模板',
    createImport: '导入 SKILL.md / JSON',
    importFailed: '无法把这个文件读成 Skill。',
    more: '更多',
    viewMore: '查看更多',
    like: '喜欢',
    unlike: '取消喜欢',
    favoritesEmpty: '点 ♡ 喜欢的 Skill 会出现在这里',
    hubSource: 'Skill Hub 源',
    templateLabel: (name: string) => `模板：${name}`,
  },
} as const;

export type SkillCopy = (typeof SKILL_COPY)[keyof typeof SKILL_COPY];
type Copy = SkillCopy;
export type SkillSource = 'bundled' | 'local' | 'hub' | 'mine';
type SkillTone = 'mint' | 'sun' | 'coral' | 'ink';

const TONES: readonly SkillTone[] = ['mint', 'sun', 'coral', 'ink'];
const GLYPHS = [Sparkles, Clapperboard, WandSparkles, Layers, Film, Palette] as const;

export interface DeckSkill {
  key: string;
  id: string;
  name: string;
  description: string;
  version: string | null;
  handle: string;
  cover?: string;
  seed: number;
  source: SkillSource;
  installed: boolean;
  updateAvailable: boolean;
  enabled: boolean;
}

export type DeckView =
  | { type: 'list' }
  | { type: 'detail'; key: string }
  | { type: 'edit'; id: string | null };

export interface EditorDraft {
  name: string;
  slug: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

export function handleFor(id: string): string {
  return `$${id.split('.').at(-1) || id}`;
}

export function seedOf(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash;
}

export function formatDate(value: string | undefined, language: 'en' | 'zho'): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(language === 'zho' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
}


type ManifestState = { status: 'idle' | 'loading' } | { status: 'ready'; manifest: LocalSkillManifest } | { status: 'error'; message: string };

export function SkillDetail({
  skill, copy, language, attached, hubUrl, installing,
  onUse, onToggleEnabled, onEdit, onDelete, onUninstall, onInstall, onRefresh, favorite, onToggleFavorite,
}: {
  skill: DeckSkill;
  copy: Copy;
  language: 'en' | 'zho';
  attached: boolean;
  hubUrl: string;
  installing: boolean;
  onUse: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onUninstall: () => Promise<void>;
  onInstall: () => void;
  onRefresh: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ManifestState>({ status: 'idle' });
  const record = useUserSkillsStore(state => (skill.source === 'mine' ? state.skills.find(item => item.id === skill.id) : undefined));
  const bundled = skill.source === 'bundled' ? getBundledProductionSkill(skill.id) : null;
  const hubSummary = useSkillHubStore(state => (skill.source === 'hub' ? state.hubSkills.find(item => item.id === skill.id) : undefined));
  const localEntry = useSkillHubStore(state => state.localSkills.find(item => item.id === skill.id));
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const canReadManifest = skill.source === 'local' || (skill.source === 'hub' && skill.installed);
  useEffect(() => {
    if (!canReadManifest) return;
    let active = true;
    setManifest({ status: 'loading' });
    void (async () => {
      try {
        const registry = await createLocalSkillRegistry();
        if (!registry) throw new Error(copy.desktopRequired);
        const result = await registry.getSkillManifest(skill.id);
        if (active) setManifest({ status: 'ready', manifest: result });
      } catch (cause) {
        if (active) setManifest({ status: 'error', message: skillRegistryErrorMessage(cause) });
      }
    })();
    return () => { active = false; };
  }, [canReadManifest, skill.id, copy.desktopRequired]);

  const sourceLabel = skill.source === 'bundled' ? copy.sourceBundled : skill.source === 'local' ? copy.sourceLocal : skill.source === 'mine' ? copy.sourceMine : copy.sourceHub;
  const canUse = skill.source !== 'hub' || skill.installed;
  const removable = skill.source === 'mine' || skill.source === 'local' || (skill.source === 'hub' && skill.installed);
  const ready = manifest.status === 'ready' ? manifest.manifest : null;
  const capabilities = bundled?.capabilities || ready?.capabilities || [];
  const permissions = bundled?.permissions || ready?.permissions;
  const files = bundled ? bundled.packageEntries.map(entry => entry.path) : ready?.files.map(file => file.path) || [];

  const confirmRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      if (skill.source === 'mine') onDelete();
      else await onUninstall();
    } catch (cause) {
      if (mounted.current) setError(skillRegistryErrorMessage(cause));
    } finally {
      if (mounted.current) { setBusy(false); setConfirming(false); }
    }
  };

  return (
    <div className="skill-hub__detail">
      <div className="skill-hub__detail-head">
        <SkillMark seed={skill.seed} cover={skill.cover} large />
        <div className="skill-hub__text">
          <strong><span>{skill.name}</span><em>{skill.handle}</em></strong>
          <small>{sourceLabel}{(skill.version || ready?.version) ? ` · ${copy.version} ${skill.version || ready?.version}` : ''}</small>
        </div>
      </div>
      {skill.description && <p className="skill-hub__detail-desc">{skill.description}</p>}

      <div className="skill-hub__actions">
        {canUse && (
          <button type="button" className="skill-hub__primary" disabled={!skill.enabled || attached} onClick={onUse}>
            {attached ? <><Check size={13} aria-hidden="true" /><span>{copy.inUse}</span></> : <span>{copy.use}</span>}
          </button>
        )}
        {skill.source === 'hub' && (!skill.installed || skill.updateAvailable) && (
          <button type="button" className="skill-hub__primary" disabled={installing} onClick={onInstall}>
            {installing ? <RefreshCw size={12} className="is-spinning" aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
            <span>{skill.updateAvailable ? copy.update : copy.installShort}</span>
          </button>
        )}
        {canUse && (
          <label className="skill-hub__switch">
            <input type="checkbox" role="switch" checked={skill.enabled} onChange={event => onToggleEnabled(event.target.checked)} aria-label={copy.enabled} />
            <span aria-hidden="true" />
            <em>{copy.enabled}</em>
          </label>
        )}
        {onToggleFavorite && (
          <button type="button" className={`skill-hub__ghost${favorite ? ' is-liked' : ''}`} aria-pressed={Boolean(favorite)} onClick={onToggleFavorite}>
            <Heart size={12} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" /><span>{favorite ? copy.unlike : copy.like}</span>
          </button>
        )}
        {skill.source === 'mine' && <button type="button" className="skill-hub__ghost" onClick={onEdit}><Pencil size={12} aria-hidden="true" /><span>{copy.edit}</span></button>}
        {skill.source === 'local' && <button type="button" className="skill-hub__ghost" onClick={onRefresh}><RefreshCw size={12} aria-hidden="true" /><span>{copy.refresh}</span></button>}
        {skill.source === 'hub' && hubUrl && (
          <a className="skill-hub__ghost" href={hubSkillExternalUrl(hubUrl, skill.id)} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden="true" /><span>{copy.viewInHub}</span></a>
        )}
        {removable && !confirming && (
          <button type="button" className="skill-hub__ghost is-danger" onClick={() => setConfirming(true)}>
            <Trash2 size={12} aria-hidden="true" /><span>{skill.source === 'mine' ? copy.delete : copy.uninstall}</span>
          </button>
        )}
      </div>
      {confirming && (
        <div className="skill-hub__confirm" role="alertdialog" aria-label={skill.source === 'mine' ? copy.confirmDelete(skill.name) : copy.confirmUninstall(skill.name)}>
          <span>{skill.source === 'mine' ? copy.confirmDelete(skill.name) : copy.confirmUninstall(skill.name)}</span>
          <button type="button" className="skill-hub__ghost" onClick={() => setConfirming(false)}>{copy.cancel}</button>
          <button type="button" className="skill-hub__danger" disabled={busy} onClick={() => void confirmRemove()}>{skill.source === 'mine' ? copy.delete : copy.uninstall}</button>
        </div>
      )}
      {error && <div className="skill-hub__error" role="alert">{error}</div>}

      {record && (
        <>
          {record.recipe && <div className="skill-hub__hint">{copy.recipeSteps(record.recipe.steps.length)}</div>}
          <dl className="skill-hub__meta">
            <dt>{copy.createdAt}</dt><dd>{formatDate(record.createdAt, language)}</dd>
            {record.updatedAt && <><dt>{copy.updatedAt}</dt><dd>{formatDate(record.updatedAt, language)}</dd></>}
          </dl>
          <h4 className="skill-hub__label">{copy.instructions}</h4>
          <pre className="skill-hub__code">{record.prompt}</pre>
        </>
      )}
      {skill.source === 'bundled' && <div className="skill-hub__hint">{copy.bundledReadonly}</div>}
      {skill.source === 'local' && <div className="skill-hub__hint">{copy.localEditHint}</div>}
      {skill.source === 'hub' && (
        <dl className="skill-hub__meta">
          <dt>{copy.version}</dt><dd>{hubSummary?.version || '—'}</dd>
          <dt>{copy.sourceLocal}</dt><dd>{skill.installed ? `${copy.hubInstalled}${localEntry?.version ? ` · ${localEntry.version}` : ''}` : copy.hubNotInstalled}</dd>
          {hubSummary?.author && <><dt>Author</dt><dd>{hubSummary.author}</dd></>}
        </dl>
      )}
      {canReadManifest && manifest.status === 'loading' && <div className="skill-hub__hint" role="status">{copy.manifestLoading}</div>}
      {canReadManifest && manifest.status === 'error' && <div className="skill-hub__error" role="alert">{manifest.message}</div>}
      {capabilities.length > 0 && (
        <>
          <h4 className="skill-hub__label">{copy.capabilities}</h4>
          <div className="skill-hub__chips">{capabilities.map(item => <span key={item}>{item}</span>)}</div>
        </>
      )}
      {permissions && (
        <>
          <h4 className="skill-hub__label">{copy.permissions}</h4>
          <dl className="skill-hub__meta">
            <dt>network</dt><dd>{permissions.network}</dd>
            <dt>secrets</dt><dd>{permissions.secrets}</dd>
            <dt>filesystem</dt><dd>{permissions.filesystem}</dd>
          </dl>
        </>
      )}
      {files.length > 0 && (
        <>
          <h4 className="skill-hub__label">{copy.files}</h4>
          <ul className="skill-hub__files">{files.map(path => <li key={path}>{path}</li>)}</ul>
        </>
      )}
      {bundled && (
        <>
          <h4 className="skill-hub__label">{copy.preview}</h4>
          <pre className="skill-hub__code">{bundled.skillSource.slice(0, 1600)}</pre>
        </>
      )}
    </div>
  );
}

export function SkillEditor({ copy, initial, onCancel, onSave }: {
  copy: Copy;
  initial: EditorDraft;
  onCancel: () => void;
  onSave: (draft: EditorDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<EditorDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const patch = (value: Partial<EditorDraft>) => setDraft(current => ({ ...current, ...value }));
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  return (
    <form className="skill-hub__editor" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="skill-hub__field">
        <span>{copy.name}</span>
        <input autoFocus required value={draft.name} onChange={event => patch({ name: event.target.value })} />
      </label>
      <label className="skill-hub__field">
        <span>{copy.slug}</span>
        <input value={draft.slug} placeholder={draft.name ? draft.name.toLowerCase() : 'my-skill'} onChange={event => patch({ slug: event.target.value })} />
      </label>
      <label className="skill-hub__field">
        <span>{copy.description}</span>
        <input value={draft.description} onChange={event => patch({ description: event.target.value })} />
      </label>
      <label className="skill-hub__field">
        <span>{copy.prompt}</span>
        <textarea required rows={6} value={draft.prompt} placeholder={copy.promptPlaceholder} onChange={event => patch({ prompt: event.target.value })} />
      </label>
      <label className="skill-hub__switch">
        <input type="checkbox" role="switch" checked={draft.enabled} onChange={event => patch({ enabled: event.target.checked })} aria-label={copy.enableSkill} />
        <span aria-hidden="true" />
        <em>{copy.enableSkill}</em>
      </label>
      {error && <div className="skill-hub__error" role="alert">{error}</div>}
      <div className="skill-hub__actions is-end">
        <button type="button" className="skill-hub__ghost" onClick={onCancel}>{copy.cancel}</button>
        <button type="submit" className="skill-hub__primary" disabled={saving}>{copy.save}</button>
      </div>
    </form>
  );
}

export function SkillMark({ seed, cover, large = false }: { seed: number; cover?: string; large?: boolean }) {
  const Glyph = GLYPHS[seed % GLYPHS.length];
  const tone = TONES[Math.floor(seed / GLYPHS.length) % TONES.length];
  return (
    <span className={`agent-skill-mark${large ? ' is-large' : ''}`} data-tone={tone} aria-hidden="true">
      {cover ? <img src={cover} alt="" /> : <Glyph size={large ? 18 : 15} strokeWidth={2} />}
    </span>
  );
}


export interface SkillTemplate {
  id: string;
  name: string;
  slug: string;
  description: string;
  prompt: string;
}

/** 「从模板」：几个常用起点 + 内置 Skill 的 SKILL.md（复制一份成为可编辑的我的 Skill）。 */
export function skillTemplates(language: 'en' | 'zho'): SkillTemplate[] {
  const zh = language === 'zho';
  const base: SkillTemplate[] = [
    {
      id: 'storyboard',
      name: zh ? '分镜拆解' : 'Storyboard breakdown',
      slug: 'storyboard',
      description: zh ? '把一段剧本拆成镜头表，每镜写画面与提示词' : 'Split a script into shots with visuals and prompts',
      prompt: zh
        ? '把用户给的剧本拆成 4–8 个镜头。每个镜头写：时长、景别、画面描述、生成提示词。先在画布上建文本节点列出镜头表，再询问是否批量生成首帧。'
        : 'Split the script into 4–8 shots. For each: duration, framing, visual, generation prompt. Put the shot list in a text node first, then ask before generating keyframes.',
    },
    {
      id: 'voiceover',
      name: zh ? '口播脚本' : 'Voice-over script',
      slug: 'voiceover',
      description: zh ? '把卖点改写成 30 秒口语化口播' : 'Rewrite selling points as a 30-second spoken script',
      prompt: zh
        ? '把用户提供的卖点改写成 30 秒口播：开头 3 秒抓注意力，中间 3 个卖点各一句，结尾一句行动号召。口语化短句，不用书面语。'
        : 'Rewrite the selling points as a 30-second voice-over: a 3-second hook, one line per selling point, one call to action. Short spoken sentences.',
    },
    {
      id: 'poster-copy',
      name: zh ? '海报文案' : 'Poster copy',
      slug: 'poster-copy',
      description: zh ? '为海报写 3 组主副标题' : 'Write 3 headline/subline pairs for a poster',
      prompt: zh ? '为用户的主题写 3 组海报主标题 + 副标题，主标题不超过 10 个字，并给出配色与版式建议。' : 'Write 3 headline + subline pairs (headline ≤ 6 words) and suggest colours and layout.',
    },
  ];
  const bundled = listBundledProductionSkills().map(skill => ({
    id: `bundled:${skill.id}`,
    name: skill.displayName,
    slug: productionSkillHandle(skill).replace(/^\$/, ''),
    description: skill.description,
    prompt: skill.skillSource.replace(/^---[\s\S]*?---\s*/, '').trim(),
  }));
  return [...base, ...bundled];
}

export interface ImportedSkill {
  name: string;
  slug: string;
  description: string;
  prompt: string;
}

/** 导入：SKILL.md（YAML front matter 的 name / description + 正文为指令）或 JSON { name, description, prompt }。 */
export function parseSkillImport(text: string, fileName = ''): ImportedSkill | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as Partial<ImportedSkill> & { instructions?: string; displayName?: string };
      const name = String(data.name || data.displayName || '').trim();
      const prompt = String(data.prompt || data.instructions || '').trim();
      if (!name || !prompt) return null;
      return { name, slug: String(data.slug || name), description: String(data.description || ''), prompt };
    } catch {
      return null;
    }
  }
  const front = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(trimmed);
  const meta: Record<string, string> = {};
  if (front) {
    for (const line of front[1].split('\n')) {
      const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (match) meta[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  const body = (front ? trimmed.slice(front[0].length) : trimmed).trim();
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const name = meta.name || heading || fileName.replace(/\.[^.]+$/, '');
  if (!name || !body) return null;
  return { name, slug: meta.name || name, description: meta.description || '', prompt: body };
}

export interface SkillCatalog {
  mine: DeckSkill[];
  installed: DeckSkill[];
  hub: DeckSkill[];
  favoriteIds: ReadonlySet<string>;
}

/** 三个来源合成一份目录：我的（用户自建）、已安装（内置 + 本机包）、Hub。 */
export function useSkillCatalog(copy: SkillCopy): SkillCatalog {
  const hubSkills = useSkillHubStore(state => state.hubSkills);
  const localSkills = useSkillHubStore(state => state.localSkills);
  const userSkills = useUserSkillsStore(state => state.skills);
  const disabledIds = useUserSkillsStore(state => state.disabledIds);
  const favoriteIds = useUserSkillsStore(state => state.favoriteIds);
  const bundledSkills = listBundledProductionSkills();
  const bundledId = bundledSkills[0]?.id || '';
  const localProduction = useMemo(
    () => localSkills.filter(skill => skill.kind === 'production' && skill.id !== bundledId),
    [localSkills, bundledId],
  );
  const enabledState = useMemo(() => ({ skills: userSkills, disabledIds }), [userSkills, disabledIds]);

  const mine = useMemo<DeckSkill[]>(() => userSkills.map(skill => ({
    key: `mine:${skill.id}`,
    id: skill.id,
    name: skill.name,
    description: skill.description || skill.prompt.split('\n')[0] || '',
    version: null,
    handle: `$${skill.slug}`,
    seed: seedOf(skill.id),
    source: 'mine',
    installed: true,
    updateAvailable: false,
    enabled: skill.enabled !== false,
  })), [userSkills]);

  const installed = useMemo<DeckSkill[]>(() => [
    ...bundledSkills.map((skill): DeckSkill => ({
      key: `bundled:${skill.id}`,
      id: skill.id,
      name: skill.displayName,
      description: skill.description,
      version: skill.version,
      handle: productionSkillHandle(skill),
      seed: seedOf(skill.id),
      source: 'bundled',
      installed: true,
      updateAvailable: false,
      enabled: isSkillEnabled(enabledState, skill.id),
    })),
    ...localProduction.map((skill): DeckSkill => ({
      key: `local:${skill.id}`,
      id: skill.id,
      name: skill.name,
      description: skill.description || copy.installedDescription,
      version: skill.version,
      handle: handleFor(skill.id),
      seed: seedOf(skill.id),
      source: 'local',
      installed: true,
      updateAvailable: false,
      enabled: isSkillEnabled(enabledState, skill.id),
    })),
  ], [bundledSkills, localProduction, copy.installedDescription, enabledState]);

  const hub = useMemo<DeckSkill[]>(() => hubSkills.map(skill => ({
    key: `hub:${skill.id}`,
    id: skill.id,
    name: skill.name,
    description: skill.description || copy.hubDescription,
    version: skill.version,
    handle: handleFor(skill.id),
    seed: seedOf(skill.id),
    source: 'hub',
    installed: localProduction.some(item => item.id === skill.id),
    updateAvailable: localProduction.some(item => item.id === skill.id && item.version !== skill.version),
    enabled: isSkillEnabled(enabledState, skill.id),
  })), [hubSkills, localProduction, copy.hubDescription, enabledState]);

  return { mine, installed, hub, favoriteIds };
}

export function skillMatches(skill: DeckSkill, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || [skill.name, skill.id, skill.handle, skill.description].some(value => value.toLowerCase().includes(normalized));
}

/** 用文件选择器读一个文本文件（导入 Skill 用）。 */
export function pickTextFile(accept: string): Promise<{ text: string; name: string } | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      void file.text().then(text => resolve({ text, name: file.name }), () => resolve(null));
    };
    input.click();
  });
}
