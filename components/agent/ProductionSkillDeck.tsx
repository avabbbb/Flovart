import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, ExternalLink, Film, Layers, Palette, Pencil, Plus, RefreshCw, Search, Shuffle, Sparkles, Star, Trash2, WandSparkles, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import localforage from 'localforage';

import '../../styles/skillHub.css';

import {
  createProductionSkillAttachment,
  createSkillAttachment,
  getBundledProductionSkill,
  listBundledProductionSkills,
  type ProductionSkillAttachment,
} from '../../services/productionSkillCatalog';
import { createLocalSkillRegistry, skillRegistryErrorMessage, type LocalSkillManifest } from '../../services/localSkillRegistry';
import { hubSkillExternalUrl } from '../../services/skillHubClient';
import { buildProductionSkillStarterPrompt, productionSkillHandle } from '../../services/productionSkillLaunch';
import type { SkillInputSlot } from '../../services/skillInputs';
import { isUserSkillAttachment, userSkillAttachment } from '../../services/userSkillContext';
import { useSkillHubStore } from '../../stores/useSkillHubStore';
import { isSkillEnabled, useUserSkillsStore, type RemovedUserSkill } from '../../stores/useUserSkillsStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

// Skill Hub 选择器（参照 Inspora「AI agent dashboard」的 Add widgets 面板，@BenceRedmond，
// https://www.inspora.design/posts/ai-agent-dashboard）：标题 + 关闭、整宽搜索、灰色分区标签、
// 扁平行 = 凸起图标方块 + 标题 + 一行说明 + 右侧状态（已添加 ✓ / 凸起「+」）。
// 同一个浮层里完成列表 → 详情 → 新建 / 编辑，窄面板也不需要第二个弹层。

const FAVORITES_KEY = 'flovart.skill.favorites.v1';
const UNDO_MS = 6000;

const COPY = {
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
  },
} as const;

type Copy = (typeof COPY)[keyof typeof COPY];
type SkillSource = 'bundled' | 'local' | 'hub' | 'mine';
type SkillTone = 'mint' | 'sun' | 'coral' | 'ink';

const TONES: readonly SkillTone[] = ['mint', 'sun', 'coral', 'ink'];
const GLYPHS = [Sparkles, Clapperboard, WandSparkles, Layers, Film, Palette] as const;

interface DeckSkill {
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

type DeckView =
  | { type: 'list' }
  | { type: 'detail'; key: string }
  | { type: 'edit'; id: string | null };

interface EditorDraft {
  name: string;
  slug: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

function handleFor(id: string): string {
  return `$${id.split('.').at(-1) || id}`;
}

function seedOf(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash;
}

function formatDate(value: string | undefined, language: 'en' | 'zho'): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(language === 'zho' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ProductionSkillDeck({
  attachment,
  onChange,
  dropTargetRef,
  onPromptChange,
  showWelcome = false,
  open: openProp,
  onOpenChange,
  searchQuery,
  keyboardRef,
}: {
  attachment?: ProductionSkillAttachment;
  onChange: (attachment?: ProductionSkillAttachment) => void;
  dropTargetRef: RefObject<HTMLElement | null>;
  onPromptChange?: (prompt: string) => void;
  showWelcome?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Text typed after "/" in the composer; drives the search and keeps focus in the composer. */
  searchQuery?: string;
  /** 输入框把方向键/Enter 转交给列表：↓ 进入列表，↑ 越过第一项回到输入框，Enter 选中高亮项。返回 true 表示已消费。 */
  keyboardRef?: { current: ((key: string) => boolean) | null };
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean | ((value: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (openProp === undefined) setOpenState(value);
    onOpenChange?.(value);
  };
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [shuffleOffset, setShuffleOffset] = useState(0);
  const [availableHeight, setAvailableHeight] = useState(380);
  const [view, setView] = useState<DeckView>({ type: 'list' });
  const [favoriteIds, setFavoriteIds] = useState<ReadonlySet<string>>(new Set());
  const [hubUrlDraft, setHubUrlDraft] = useState('');
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [failedInstallId, setFailedInstallId] = useState<string | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [undo, setUndo] = useState<RemovedUserSkill | null>(null);
  // -1 = 焦点仍在输入框，列表无高亮。
  const [highlight, setHighlight] = useState(-1);
  const reduceMotion = useReducedMotion();
  const language = useWorkspaceStore(state => state.language);
  const copy = COPY[language];

  const {
    hubUrl,
    hubStatus,
    hubError,
    hubSkills,
    localSkills,
    registryStatus,
    setHubUrl,
    syncHub,
    refreshLocal,
    installFromHub,
    uninstallSkill,
  } = useSkillHubStore();
  const userSkills = useUserSkillsStore(state => state.skills);
  const disabledIds = useUserSkillsStore(state => state.disabledIds);
  const userSkillsLoaded = useUserSkillsStore(state => state.loaded);

  useEffect(() => { setHubUrlDraft(hubUrl); }, [hubUrl]);
  useEffect(() => { if (open) void refreshLocal(); }, [open, refreshLocal]);
  useEffect(() => { if (!useUserSkillsStore.getState().loaded) void useUserSkillsStore.getState().load(); }, []);
  useEffect(() => {
    if (searchQuery === undefined) return;
    setView({ type: 'list' });
    setQuery(searchQuery);
  }, [searchQuery]);
  useEffect(() => { setHighlight(-1); }, [query, open, view.type]);
  useEffect(() => { if (!open) setView({ type: 'list' }); }, [open]);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  // 收藏持久化到本地（localforage）
  useEffect(() => {
    let active = true;
    void localforage.getItem<string[]>(FAVORITES_KEY).then(stored => {
      if (active && Array.isArray(stored)) setFavoriteIds(new Set(stored));
    });
    return () => { active = false; };
  }, []);

  const toggleFavorite = (id: string) => {
    setFavoriteIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      void localforage.setItem(FAVORITES_KEY, [...next]);
      return next;
    });
  };

  // 当前附着的 Skill 跟随它的权威：我的 Skill 被编辑 → 换成新指纹（Agent 下一轮重新绑定）；
  // 被删除或停用 → 撤掉附件，不让 Agent 继续用旧指令。
  useEffect(() => {
    if (!attachment || !userSkillsLoaded) return;
    const state = { skills: userSkills, disabledIds };
    if (isUserSkillAttachment(attachment)) {
      const record = userSkills.find(skill => skill.id === attachment.id);
      if (!record || record.enabled === false) { onChange(undefined); return; }
      const fresh = userSkillAttachment(record);
      if (fresh.contentHash !== attachment.contentHash || fresh.displayName !== attachment.displayName) onChange(fresh);
      return;
    }
    if (!isSkillEnabled(state, attachment.id)) onChange(undefined);
  }, [attachment, userSkills, disabledIds, userSkillsLoaded, onChange]);

  // 弹性高度：picker 从 composer 向上弹出，高度按可用空间比例收缩，避免顶部被面板/视口裁切。
  // 这是浮层行为几何（不是页面布局）：观察锚点自身尺寸，避免让整个 App
  // 在每个 viewport resize tick 上重渲染。
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = dropTargetRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAvailableHeight(Math.max(260, Math.min(460, Math.floor(rect.top - 64))));
    };
    measure();
    const target = dropTargetRef.current;
    const observer = typeof ResizeObserver === 'undefined' || !target
      ? null
      : new ResizeObserver(measure);
    observer?.observe(target);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [open, dropTargetRef]);

  const bundledSkills = listBundledProductionSkills();
  const bundledId = bundledSkills[0]?.id || '';
  const localProduction = useMemo(
    () => localSkills.filter(skill => skill.kind === 'production' && skill.id !== bundledId),
    [localSkills, bundledId],
  );
  const enabledState = useMemo(() => ({ skills: userSkills, disabledIds }), [userSkills, disabledIds]);

  const mineDeckSkills = useMemo<DeckSkill[]>(() => userSkills.map(skill => ({
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

  const installedDeckSkills = useMemo<DeckSkill[]>(() => {
    const bundled: DeckSkill[] = bundledSkills.map(skill => ({
      key: `bundled:${skill.id}`,
      id: skill.id,
      name: skill.displayName,
      description: skill.description,
      version: skill.version,
      handle: productionSkillHandle(skill),
      cover: undefined,
      seed: seedOf(skill.id),
      source: 'bundled',
      installed: true,
      updateAvailable: false,
      enabled: isSkillEnabled(enabledState, skill.id),
    }));
    const local: DeckSkill[] = localProduction.map(skill => ({
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
    }));
    return [...bundled, ...local];
  }, [bundledSkills, localProduction, copy.installedDescription, enabledState]);

  const hubDeckSkills = useMemo<DeckSkill[]>(() => hubSkills.map(skill => ({
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

  const normalizedQuery = query.trim().toLowerCase();
  const matches = useCallback((skill: DeckSkill) => !normalizedQuery
    || [skill.name, skill.id, skill.handle, skill.description].some(value => value.toLowerCase().includes(normalizedQuery)), [normalizedQuery]);
  const favoritesFirst = useCallback((skills: DeckSkill[]) => [
    ...skills.filter(skill => favoriteIds.has(skill.id)),
    ...skills.filter(skill => !favoriteIds.has(skill.id)),
  ], [favoriteIds]);

  const visibleMine = useMemo(() => favoritesFirst(mineDeckSkills.filter(matches)), [mineDeckSkills, matches, favoritesFirst]);
  const visibleInstalled = useMemo(() => favoritesFirst(installedDeckSkills.filter(matches)), [installedDeckSkills, matches, favoritesFirst]);
  const visibleHub = useMemo(() => hubDeckSkills.filter(matches), [hubDeckSkills, matches]);
  // 键盘只在能直接选用的 Skill 之间走：我的 + 已安装，跳过停用项。
  const navSkills = useMemo(() => [...visibleMine, ...visibleInstalled].filter(skill => skill.enabled), [visibleMine, visibleInstalled]);
  const highlightedKey = highlight >= 0 ? navSkills[highlight]?.key : undefined;

  const allDeckSkills = useMemo(() => [...mineDeckSkills, ...installedDeckSkills, ...hubDeckSkills], [mineDeckSkills, installedDeckSkills, hubDeckSkills]);
  const welcomeSource = useMemo(() => [...installedDeckSkills, ...mineDeckSkills].filter(skill => skill.enabled), [installedDeckSkills, mineDeckSkills]);
  const welcomeSkills = useMemo(() => welcomeSource.length
    ? Array.from({ length: Math.min(4, welcomeSource.length) }, (_, index) => welcomeSource[(shuffleOffset + index) % welcomeSource.length])
    : [], [shuffleOffset, welcomeSource]);

  const attach = async (skill: DeckSkill, seedPrompt = false) => {
    if (loading || !skill.enabled) return;
    setLoading(true);
    setDeckError(null);
    try {
      let inputs: readonly SkillInputSlot[] | undefined;
      if (skill.source === 'mine') {
        const record = useUserSkillsStore.getState().skills.find(item => item.id === skill.id);
        if (!record) throw new Error(copy.noMatch);
        onChange(userSkillAttachment(record));
      } else if (skill.source === 'bundled') {
        const bundled = getBundledProductionSkill(skill.id);
        if (!bundled) throw new Error(copy.missingBundled + ': ' + skill.id);
        inputs = bundled.inputs;
        onChange(await createProductionSkillAttachment(bundled));
      } else {
        const registry = await createLocalSkillRegistry();
        if (!registry) throw new Error(copy.desktopRequired);
        const manifest = await registry.getSkillManifest(skill.id);
        inputs = manifest.inputs;
        onChange(createSkillAttachment({
          id: manifest.id,
          version: manifest.version,
          contentHash: manifest.contentHash,
          displayName: manifest.displayName,
          trustTier: manifest.trustTier,
        }));
      }
      if (seedPrompt) onPromptChange?.(buildProductionSkillStarterPrompt({ id: skill.id, version: skill.version || '', displayName: skill.name, inputs }));
      setOpen(false);
      setQuery('');
    } catch (error) {
      setDeckError(skillRegistryErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!keyboardRef) return;
    keyboardRef.current = (key: string) => {
      if (!open || view.type !== 'list') return false;
      const count = navSkills.length;
      if (key === 'ArrowDown') { if (count) setHighlight(index => Math.min(index + 1, count - 1)); return true; }
      if (key === 'ArrowUp') { if (highlight < 0) return false; setHighlight(index => index - 1); return true; }
      // 未进入列表时也吞掉 Enter，避免把半截 /xxx 当消息发出去。
      if (key === 'Enter') { const skill = navSkills[highlight]; if (skill) void attach(skill); return true; }
      return false;
    };
    return () => { keyboardRef.current = null; };
  });

  const startInstall = async (skill: DeckSkill) => {
    if (!hubUrl) { setDeckError(copy.configureHub); return; }
    setInstallingId(skill.id);
    setFailedInstallId(null);
    setDeckError(null);
    try {
      await installFromHub(skill.id);
    } catch (error) {
      setFailedInstallId(skill.id);
      setDeckError(skillRegistryErrorMessage(error));
    } finally {
      setInstallingId(null);
    }
  };

  const droppedInComposer = (point: { x: number; y: number }) => {
    const rect = dropTargetRef.current?.getBoundingClientRect();
    return Boolean(rect
      && point.x >= rect.left && point.x <= rect.right
      && point.y >= rect.top && point.y <= rect.bottom);
  };

  const removeMine = async (skill: DeckSkill) => {
    const removed = await useUserSkillsStore.getState().remove(skill.id);
    setView({ type: 'list' });
    if (removed) setUndo(removed);
  };

  const undoRemove = async () => {
    if (!undo) return;
    const removed = undo;
    setUndo(null);
    await useUserSkillsStore.getState().restore(removed);
  };

  const stateFor = (skill: DeckSkill) => {
    if (!skill.enabled) return <span className="skill-hub__state is-off">{copy.disabled}</span>;
    if (attachment?.id === skill.id) return <span className="skill-hub__state is-active"><Check size={12} aria-hidden="true" /><span>{copy.inUse}</span></span>;
    return <span className="skill-hub__state is-added" title={copy.added}><Check size={12} aria-hidden="true" /><span>{copy.added}</span></span>;
  };

  const detailsButton = (skill: DeckSkill) => (
    <button type="button" className="skill-hub__icon-btn" aria-label={copy.details(skill.name)} title={copy.details(skill.name)} onClick={() => setView({ type: 'detail', key: skill.key })}>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  );

  const renderRow = (skill: DeckSkill) => {
    const highlighted = skill.key === highlightedKey;
    const favorite = favoriteIds.has(skill.id);
    return (
      <motion.div
        key={skill.key}
        whileTap={reduceMotion ? undefined : { scale: 0.99 }}
        whileDrag={reduceMotion ? undefined : { scale: 1.02 }}
        drag={skill.enabled}
        dragElastic={0.14}
        dragSnapToOrigin
        onDragEnd={(_, info) => { if (droppedInComposer(info.point)) void attach(skill); }}
        transition={{ type: 'spring', visualDuration: 0.22, bounce: 0 }}
        className={`skill-hub__row${highlighted ? ' is-highlighted' : ''}`}
        data-highlighted={highlighted || undefined}
        data-disabled={!skill.enabled || undefined}
        ref={highlighted ? (element: HTMLDivElement | null) => element?.scrollIntoView?.({ block: 'nearest' }) : undefined}
        role="group"
        aria-label={skill.name}
      >
        <button type="button" className="skill-hub__row-main" aria-label={copy.add(skill.name)} disabled={loading || !skill.enabled} onClick={() => void attach(skill)}>
          <SkillMark seed={skill.seed} cover={skill.cover} />
          <span className="skill-hub__text"><strong><span>{skill.name}</span><em>{skill.handle}</em></strong><small>{skill.description}</small></span>
        </button>
        {stateFor(skill)}
        <button type="button" className={`skill-hub__icon-btn skill-hub__favorite${favorite ? ' is-on' : ''}`} aria-label={favorite ? copy.unfavorite(skill.name) : copy.favorite(skill.name)} aria-pressed={favorite} title={favorite ? copy.unfavorite(skill.name) : copy.favorite(skill.name)}
          onClick={() => toggleFavorite(skill.id)}>
          <Star size={13} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
        {detailsButton(skill)}
      </motion.div>
    );
  };

  const hubAction = (skill: DeckSkill) => {
    if (installingId === skill.id) return <span className="skill-hub__add is-busy" role="status" aria-label={copy.syncing}><RefreshCw size={13} className="is-spinning" aria-hidden="true" /></span>;
    if (skill.installed && !skill.updateAvailable) return <span className="skill-hub__state is-added"><Check size={12} aria-hidden="true" /><span>{copy.added}</span></span>;
    if (skill.updateAvailable) return <button type="button" className="skill-hub__add is-wide" onClick={() => void startInstall(skill)}><RefreshCw size={12} aria-hidden="true" /><span>{copy.update}</span></button>;
    if (failedInstallId === skill.id) return <button type="button" className="skill-hub__add is-wide is-failed" aria-label={copy.install(skill.name)} onClick={() => void startInstall(skill)}><RefreshCw size={12} aria-hidden="true" /><span>{copy.retry}</span></button>;
    return <button type="button" className="skill-hub__add" aria-label={copy.install(skill.name)} title={copy.install(skill.name)} onClick={() => void startInstall(skill)}><Plus size={15} aria-hidden="true" /></button>;
  };

  const renderHubRow = (skill: DeckSkill) => (
    <div key={skill.key} className="skill-hub__row skill-hub__row--hub" data-busy={installingId === skill.id || undefined}>
      <div className="skill-hub__row-main is-static">
        <SkillMark seed={skill.seed} />
        <span className="skill-hub__text"><strong><span>{skill.name}</span><em>{skill.handle}</em></strong><small>{skill.description}</small></span>
      </div>
      <a className="skill-hub__icon-btn skill-hub__external" href={hubSkillExternalUrl(hubUrl, skill.id)} target="_blank" rel="noreferrer" aria-label={copy.viewHub(skill.name)} title={copy.viewHub(skill.name)}>
        <ExternalLink size={13} aria-hidden="true" />
      </a>
      {hubAction(skill)}
      {detailsButton(skill)}
    </div>
  );

  const nothingMatches = !visibleMine.length && !visibleInstalled.length && !visibleHub.length && Boolean(normalizedQuery);

  const listBody = (
    <>
      <label className="skill-hub__search">
        <Search size={14} aria-hidden="true" />
        <input autoFocus={searchQuery === undefined} aria-label={copy.search} placeholder={copy.search} value={query} onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" className="skill-hub__search-clear" aria-label={copy.cancel} onClick={() => setQuery('')}><X size={12} aria-hidden="true" /></button>}
      </label>
      <div className="skill-hub__list">
        {(visibleMine.length > 0 || !normalizedQuery) && (
          <section className="skill-hub__section" aria-label={copy.sectionMine}>
            <h3 className="skill-hub__label">{copy.sectionMine}</h3>
            {visibleMine.map(renderRow)}
            {!mineDeckSkills.length && !normalizedQuery && (
              <button type="button" className="skill-hub__inline-empty" onClick={() => setView({ type: 'edit', id: null })}>
                <Plus size={13} aria-hidden="true" /><span>{copy.mineEmpty} · {copy.newSkill}</span>
              </button>
            )}
          </section>
        )}
        {(visibleInstalled.length > 0 || !normalizedQuery) && (
          <section className="skill-hub__section" aria-label={copy.sectionInstalled}>
            <h3 className="skill-hub__label">{copy.sectionInstalled}</h3>
            {visibleInstalled.map(renderRow)}
            {!visibleInstalled.length && (
              <div className="skill-hub__empty">{registryStatus === 'unavailable' ? copy.desktopScan : copy.noLocal}</div>
            )}
            {registryStatus === 'unavailable' && visibleInstalled.length > 0 && !normalizedQuery && <div className="skill-hub__hint">{copy.desktopScan}</div>}
          </section>
        )}
        <section className="skill-hub__section" aria-label={copy.sectionHub}>
          <div className="skill-hub__label-row">
            <h3 className="skill-hub__label">{copy.sectionHub}</h3>
            {hubSkills.length > 0 && <span className="skill-hub__count">{hubSkills.length}</span>}
          </div>
          <div className="skill-hub__hub-config">
            <input
              aria-label={copy.hubAddress}
              placeholder={copy.hubAddress}
              value={hubUrlDraft}
              onChange={event => setHubUrlDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && hubUrlDraft) { setHubUrl(hubUrlDraft); void syncHub(); } }}
            />
            <button
              type="button"
              disabled={!hubUrlDraft || hubStatus === 'syncing'}
              onClick={() => { setHubUrl(hubUrlDraft); void syncHub(); }}
            >
              <RefreshCw size={12} className={hubStatus === 'syncing' ? 'is-spinning' : ''} aria-hidden="true" />
              <span>{hubStatus === 'syncing' ? copy.syncing : copy.sync}</span>
            </button>
          </div>
          {hubStatus === 'error' && hubError && <div className="skill-hub__error" role="alert">{hubError}</div>}
          {hubStatus === 'syncing' && !hubDeckSkills.length && (
            <div className="skill-hub__skeletons" aria-hidden="true"><span /><span /><span /></div>
          )}
          {visibleHub.map(renderHubRow)}
          {!hubDeckSkills.length && hubStatus !== 'syncing' && (
            <div className="skill-hub__empty">{hubStatus === 'error' ? copy.hubFailed : copy.hubEmpty}</div>
          )}
        </section>
        {nothingMatches && <div className="skill-hub__empty">{copy.noMatch}</div>}
        {deckError && <div className="skill-hub__error" role="alert">{deckError}</div>}
      </div>
    </>
  );

  const detailSkill = view.type === 'detail' ? allDeckSkills.find(skill => skill.key === view.key) : undefined;
  const editingRecord = view.type === 'edit' && view.id ? userSkills.find(skill => skill.id === view.id) : undefined;

  const headerTitle = view.type === 'edit'
    ? (view.id ? copy.editSkill : copy.newSkill)
    : view.type === 'detail' ? (detailSkill?.name || copy.title) : copy.title;

  return (
    <>
      {showWelcome && !attachment && welcomeSkills.length > 0 && (
        <section className="agent-skill-welcome" aria-label={copy.recommendedSkills}>
          <div className="agent-skill-welcome__heading">
            <BookOpen size={18} />
            <h2>{copy.welcome}</h2>
            {welcomeSkills.length > 1 && <button type="button" onClick={() => setShuffleOffset(value => (value + 1) % welcomeSkills.length)}><Shuffle size={12} />{copy.shuffle}</button>}
          </div>
          <div className="agent-skill-welcome__grid">
            {welcomeSkills.map((skill, index) => (
              <motion.button
                key={`${skill.key}-${index}`}
                type="button"
                className="agent-skill-card"
                aria-label={copy.useSkill(skill.name)}
                onClick={() => void attach(skill, true)}
                whileHover={reduceMotion ? undefined : { y: -2 }}
                whileTap={reduceMotion ? undefined : { scale: .98 }}
                transition={{ type: 'spring', visualDuration: 0.22, bounce: 0 }}
              >
                <SkillMark seed={skill.seed} cover={skill.cover} />
                <span><strong>{skill.name}</strong><small>{skill.handle}</small></span>
              </motion.button>
            ))}
          </div>
        </section>
      )}
      {!showWelcome && <div className="agent-skill-control">
        {attachment ? (
          <span className="agent-skill-chip">
            <BookOpen size={13} />
            <span>{attachment.displayName}</span>
            <button type="button" aria-label={copy.remove(attachment.displayName)} onClick={() => onChange(undefined)}><X size={11} /></button>
          </span>
        ) : (
          <button type="button" aria-label={copy.chooseSkill} className="agent-composer-tool" onClick={() => setOpen(value => !value)}>
            <BookOpen size={16} /><span>Skill</span><ChevronDown size={12} />
          </button>
        )}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
              transition={reduceMotion ? { duration: 0.12 } : { type: 'spring', visualDuration: 0.22, bounce: 0 }}
              className="agent-skill-picker skill-hub"
              role="dialog"
              aria-label={language === 'en' ? 'Skill picker' : 'Skill'}
              style={{ maxHeight: availableHeight }}
            >
              <header className="skill-hub__header">
                {view.type !== 'list' && (
                  <button type="button" className="skill-hub__icon-btn" aria-label={copy.back} title={copy.back} onClick={() => setView({ type: 'list' })}><ChevronLeft size={15} aria-hidden="true" /></button>
                )}
                <strong className="skill-hub__title">{headerTitle}</strong>
                {view.type === 'list' && (
                  <button type="button" className="skill-hub__create" onClick={() => setView({ type: 'edit', id: null })}><Plus size={14} aria-hidden="true" /><span>{copy.create}</span></button>
                )}
                <button type="button" className="skill-hub__close" aria-label={copy.close} onClick={() => setOpen(false)}><X size={15} aria-hidden="true" /></button>
              </header>
              {view.type === 'list' && listBody}
              {view.type === 'detail' && detailSkill && (
                <SkillDetail
                  key={detailSkill.key}
                  skill={detailSkill}
                  copy={copy}
                  language={language}
                  attached={attachment?.id === detailSkill.id}
                  hubUrl={hubUrl}
                  installing={installingId === detailSkill.id}
                  onUse={() => void attach(detailSkill)}
                  onToggleEnabled={enabled => void useUserSkillsStore.getState().setEnabled(detailSkill.id, enabled)}
                  onEdit={() => setView({ type: 'edit', id: detailSkill.id })}
                  onDelete={() => void removeMine(detailSkill)}
                  onUninstall={async () => { await uninstallSkill(detailSkill.id); setView({ type: 'list' }); }}
                  onInstall={() => void startInstall(detailSkill)}
                  onRefresh={() => void refreshLocal()}
                />
              )}
              {view.type === 'detail' && !detailSkill && <div className="skill-hub__empty">{copy.noMatch}</div>}
              {view.type === 'edit' && (
                <SkillEditor
                  key={view.id || 'new'}
                  copy={copy}
                  initial={editingRecord ? {
                    name: editingRecord.name,
                    slug: editingRecord.slug,
                    description: editingRecord.description,
                    prompt: editingRecord.prompt,
                    enabled: editingRecord.enabled !== false,
                  } : { name: '', slug: '', description: '', prompt: '', enabled: true }}
                  onCancel={() => setView(view.id ? { type: 'detail', key: `mine:${view.id}` } : { type: 'list' })}
                  onSave={async draft => {
                    const saved = view.id
                      ? await useUserSkillsStore.getState().update(view.id, draft)
                      : await useUserSkillsStore.getState().create(draft);
                    setView({ type: 'detail', key: `mine:${saved.id}` });
                  }}
                />
              )}
              {undo && (
                <div className="skill-hub__undo" role="status">
                  <span>{copy.deleted(undo.skill.name)}</span>
                  <button type="button" onClick={() => void undoRemove()}>{copy.undo}</button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>}
    </>
  );
}

type ManifestState = { status: 'idle' | 'loading' } | { status: 'ready'; manifest: LocalSkillManifest } | { status: 'error'; message: string };

function SkillDetail({
  skill, copy, language, attached, hubUrl, installing,
  onUse, onToggleEnabled, onEdit, onDelete, onUninstall, onInstall, onRefresh,
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

function SkillEditor({ copy, initial, onCancel, onSave }: {
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

function SkillMark({ seed, cover, large = false }: { seed: number; cover?: string; large?: boolean }) {
  const Glyph = GLYPHS[seed % GLYPHS.length];
  const tone = TONES[Math.floor(seed / GLYPHS.length) % TONES.length];
  return (
    <span className={`agent-skill-mark${large ? ' is-large' : ''}`} data-tone={tone} aria-hidden="true">
      {cover ? <img src={cover} alt="" /> : <Glyph size={large ? 18 : 15} strokeWidth={2} />}
    </span>
  );
}
