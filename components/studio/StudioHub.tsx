import { ArrowDownWideNarrow, ArrowLeft, ArrowRight, AudioLines, Check, ChevronLeft, Clapperboard, Clock3, Eye, FileUp, FolderOpen, GitCommitVertical, Heart, Image as ImageIcon, LayoutTemplate, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Square, Trash2, Type, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import '../../styles/skillHub.css';
import '../../styles/studioHub.css';

import {
  parseSkillImport,
  pickTextFile,
  resolveSkillAttachment,
  SKILL_COPY,
  SkillDetail,
  SkillEditor,
  SkillMark,
  skillMatches,
  skillTemplates,
  useSkillCatalog,
  type DeckSkill,
  type EditorDraft,
} from '../agent/skillHubParts';
import { skillRegistryErrorMessage } from '../../services/localSkillRegistry';
import type { LocalFolderSource } from '../../services/localFolderSource';
import { useSkillHubStore } from '../../stores/useSkillHubStore';
import { useStudioHubStore, type StudioHubKind } from '../../stores/useStudioHubStore';
import { useUserSkillsStore, type RemovedUserSkill } from '../../stores/useUserSkillsStore';
import { useWorkflowStore } from '../workflow/store';
import { LocalFolderBrowser } from '../workflow/LocalFolderBrowser';
import { StudioMediaDownload, StudioMediaPreview, type StudioMediaItem } from './StudioMediaBrowser';
import { STUDIO_HUB_COPY, type StudioHubCopy } from './studioHubCopy';
import { StudioTimeline } from './StudioTimeline';
import { useMenuKeyboard, useSearchGridKeyboard } from '../../hooks/useListboxKeyboard';
import { applySkillOrder, keyboardMoveDelta, loadSkillOrder, reorderVisible, saveSkillOrder } from './skillOrder';
import { useSkillCardDrag } from './useSkillCardDrag';
import { PlanSteps, type PlanStep } from '../agent/plan/PlanSteps';
import { getBundledProductionSkill } from '../../services/productionSkillCatalog';
import { translations } from '../../utils/translations';

// 放大的资源窗口：一个共享外壳，左侧栏切换 Skills / History / Timeline / Library，各自带子项；窄宽度收成图标栏。
// 外观：bleep-app 式磨砂玻璃（--flv-frost-*，半透明），窗外是 Flovart 深色遮罩（--flv-scrim），不用白色蒙层。
// 业务不在这里复制：Skill 选用走 skillHubParts.resolveSkillAttachment + Composer 注册的 attachSkill；
// 插入画布走画布注册的 insertHistory / insertLibrary；本地文件夹直接复用 LocalFolderBrowser。

const EMPTY_DRAFT: EditorDraft = { name: '', slug: '', description: '', prompt: '', enabled: true };
/** 历史子项「Agent」：只看内置 / 外部 Agent 发起的生成（GenerationHistoryItem.origin）。 */
export const HISTORY_AGENT_SECTION = '__agent__';

type SkillSort = 'recent' | 'name' | 'source' | 'manual';
type SkillChip = 'all' | 'enabled' | 'off' | 'updates';
type HistoryTab = 'all' | 'image' | 'video' | 'favorites';
type SkillView = { type: 'grid' } | { type: 'detail'; key: string } | { type: 'edit'; id: string | null; initial?: EditorDraft };

export interface StudioHubProps {
  language: 'en' | 'zho';
  historyItems: StudioMediaItem[];
  onRemoveHistory: (sourceId: string) => void;
}

export function StudioHub({ language, historyItems, onRemoveHistory }: StudioHubProps) {
  const open = useStudioHubStore(state => state.open);
  const hub = useStudioHubStore(state => state.hub);
  const section = useStudioHubStore(state => state.section);
  const collapsed = useStudioHubStore(state => state.sidebarCollapsed);
  const reduceMotion = useReducedMotion();
  const copy = STUDIO_HUB_COPY[language];
  const close = () => useStudioHubStore.getState().close();
  const windowRef = useRef<HTMLDivElement>(null);
  const [folders, setFolders] = useState<LocalFolderSource[]>([]);
  const projects = useWorkflowStore(state => state.projects);
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    // 面板自己已聚焦搜索框（打开即可输入筛选）时不抢焦点。
    if (!windowRef.current?.contains(document.activeElement)) windowRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); useStudioHubStore.getState().close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [open]);

  useEffect(() => { if (open && !useStudioHubStore.getState().historyFavoritesLoaded) void useStudioHubStore.getState().loadHistoryFavorites(); }, [open]);

  const nav: { kind: StudioHubKind; label: string; icon: typeof Sparkles; items: { id: string | null; label: string }[] }[] = [
    { kind: 'skills', label: copy.skills, icon: Sparkles, items: [
      { id: 'all', label: copy.skillsAll }, { id: 'favorites', label: copy.skillsLiked }, { id: 'mine', label: copy.skillsMine }, { id: 'hub', label: copy.skillsHub },
    ] },
    { kind: 'history', label: copy.history, icon: Clock3, items: [
      { id: null, label: copy.historyAllCanvases },
      ...projects.map(project => ({ id: project.id, label: project.title })),
      { id: HISTORY_AGENT_SECTION, label: copy.historyAgent },
    ] },
    { kind: 'timeline', label: copy.timeline, icon: GitCommitVertical, items: projects.map(project => ({ id: project.id, label: project.title })) },
    { kind: 'library', label: copy.library, icon: FolderOpen, items: folders.map(folder => ({ id: folder.id, label: folder.name })) },
  ];
  const activeSection = (kind: StudioHubKind) => (kind === 'skills' ? section || 'all' : kind === 'timeline' ? section || activeProjectId : section);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="studio-hub"
          className="studio-hub-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.08 : 0.18 }}
        >
          <div className="studio-hub-scrim" aria-hidden="true" onClick={close} />
          <motion.div
            ref={windowRef}
            className="studio-hub flv-frost"
            role="dialog"
            aria-modal="true"
            aria-label={copy.dialog}
            tabIndex={-1}
            data-collapsed={collapsed ? 'true' : 'false'}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={reduceMotion ? { duration: 0.08 } : { type: 'spring', visualDuration: 0.32, bounce: 0.12 }}
          >
            <nav className="studio-hub__side" aria-label={copy.dialog}>
              <div className="studio-hub__side-head">
                <button type="button" className="studio-hub__icon-btn" aria-label={collapsed ? copy.expandSidebar : copy.collapse} title={collapsed ? copy.expandSidebar : copy.collapse} onClick={() => useStudioHubStore.getState().toggleSidebar()}>
                  {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
                </button>
              </div>
              {nav.map(group => {
                const Icon = group.icon;
                const current = hub === group.kind;
                return (
                  <div key={group.kind} className="studio-hub__group" data-active={current ? 'true' : 'false'}>
                    <button
                      type="button"
                      className="studio-hub__nav"
                      aria-current={current ? 'page' : undefined}
                      title={group.label}
                      onClick={() => useStudioHubStore.getState().setSection(group.kind, group.kind === 'skills' ? 'all' : group.kind === 'timeline' ? activeProjectId : null)}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span className="studio-hub__nav-label">{group.label}</span>
                    </button>
                    {current && group.items.length > 0 && (
                      <ul className="studio-hub__subnav">
                        {group.items.map(item => (
                          <li key={item.id ?? 'all'}>
                            <button
                              type="button"
                              aria-current={activeSection(group.kind) === item.id ? 'true' : undefined}
                              title={item.label}
                              onClick={() => useStudioHubStore.getState().setSection(group.kind, item.id)}
                            >{item.label}</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {current && group.kind === 'library' && !folders.length && <p className="studio-hub__subnav-empty">{copy.libraryEmpty}</p>}
                  </div>
                );
              })}
            </nav>
            <section className="studio-hub__main">
              <button type="button" className="studio-hub__icon-btn studio-hub__close" aria-label={copy.close} title={copy.close} onClick={close}><X size={16} aria-hidden="true" /></button>
              {hub === 'skills' && <SkillsPane copy={copy} language={language} section={section || 'all'} />}
              {hub === 'history' && <HistoryPane copy={copy} language={language} items={historyItems} projectFilter={section} onRemove={onRemoveHistory} />}
              {hub === 'timeline' && <StudioTimeline language={language} projectId={section || activeProjectId} activeProjectId={activeProjectId} />}
              {hub === 'library' && (
                <div className="studio-hub__pane">
                  <header className="studio-hub__head"><h2>{copy.library}</h2></header>
                  <div className="studio-hub__library">
                    <LocalFolderBrowser
                      language={language}
                      sourceId={section}
                      onSourcesChange={setFolders}
                      onActiveChange={id => { if (id && id !== useStudioHubStore.getState().section && useStudioHubStore.getState().hub === 'library') useStudioHubStore.getState().setSection('library', id); }}
                      onInsert={entries => useStudioHubStore.getState().handlers.insertLibrary?.(entries)}
                    />
                  </div>
                </div>
              )}
            </section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function SkillsPane({ copy, language, section }: { copy: StudioHubCopy; language: 'en' | 'zho'; section: string }) {
  const skillCopy = SKILL_COPY[language];
  const catalog = useSkillCatalog(skillCopy);
  const { favoriteIds } = catalog;
  const { hubUrl, refreshLocal, installFromHub, uninstallSkill } = useSkillHubStore();
  const userSkills = useUserSkillsStore(state => state.skills);
  const toggleFavorite = useUserSkillsStore(state => state.toggleFavorite);
  const canAttach = useStudioHubStore(state => Boolean(state.handlers.attachSkill));
  const [query, setQuery] = useState('');
  const cardCopy = translations[language].skillCards;
  const [skillOrder, setSkillOrder] = useState<string[]>(() => loadSkillOrder());
  const [sort, setSort] = useState<SkillSort>(() => (loadSkillOrder().length ? 'manual' : 'recent'));
  const [cardMenu, setCardMenu] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const hintId = useId();
  const gridRef = useRef<HTMLUListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reduceMotion = Boolean(useReducedMotion());
  const [chip, setChip] = useState<SkillChip>('all');
  const [view, setView] = useState<SkillView>({ type: 'grid' });
  const [menu, setMenu] = useState<null | 'create' | 'sort'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [undo, setUndo] = useState<RemovedUserSkill | null>(null);
  const [attachedId, setAttachedId] = useState<string | null>(null);
  // 打开即可输入筛选；↓ 进入卡片网格，方向键在卡片间移动，Esc 先清空搜索。
  const gridKeys = useSearchGridKeyboard({ query, onQueryChange: setQuery, itemSelector: '.studio-hub__card-open', autoFocus: true });
  const sortMenuKeys = useMenuKeyboard({ open: menu === 'sort', onClose: () => setMenu(null) });
  const createMenuKeys = useMenuKeyboard({ open: menu === 'create', onClose: () => setMenu(null) });

  useEffect(() => { void refreshLocal(); if (!useUserSkillsStore.getState().loaded) void useUserSkillsStore.getState().load(); }, [refreshLocal]);
  useEffect(() => { setView({ type: 'grid' }); }, [section]);
  useEffect(() => { if (!undo) return; const timer = window.setTimeout(() => setUndo(null), 6000); return () => window.clearTimeout(timer); }, [undo]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 2400); return () => window.clearTimeout(timer); }, [notice]);

  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...catalog.mine, ...catalog.installed, ...catalog.hub].filter(skill => !seen.has(skill.key) && Boolean(seen.add(skill.key)));
  }, [catalog]);
  const sectionSkills = useMemo(() => {
    if (section === 'mine') return [...catalog.mine, ...catalog.installed.filter(skill => skill.source === 'local')];
    if (section === 'hub') return catalog.hub;
    if (section === 'favorites') {
      const seen = new Set<string>();
      return all.filter(skill => favoriteIds.has(skill.id) && !seen.has(skill.id) && Boolean(seen.add(skill.id)));
    }
    return [...catalog.mine, ...catalog.installed, ...catalog.hub.filter(skill => !skill.installed || skill.updateAvailable)];
  }, [section, catalog, all, favoriteIds]);
  const updatedAt = useMemo(() => new Map(userSkills.map(skill => [skill.id, (skill as { updatedAt?: string }).updatedAt || ''])), [userSkills]);
  const visible = useMemo(() => {
    const filtered = sectionSkills.filter(skill => skillMatches(skill, query)).filter(skill => (
      chip === 'all' ? true : chip === 'enabled' ? skill.enabled && skill.installed : chip === 'off' ? !skill.enabled : skill.updateAvailable
    ));
    const order: Record<DeckSkill['source'], number> = { mine: 0, bundled: 1, local: 2, hub: 3 };
    const sorted = [...filtered];
    if (sort === 'manual') return applySkillOrder(filtered, skillOrder, skill => skill.key);
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, language === 'zho' ? 'zh-CN' : 'en'));
    else if (sort === 'source') sorted.sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));
    else sorted.sort((a, b) => (updatedAt.get(b.id) || '').localeCompare(updatedAt.get(a.id) || '') || Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id)));
    return sorted;
  }, [sectionSkills, query, chip, sort, skillOrder, language, updatedAt, favoriteIds]);

  const sourceLabel = (skill: DeckSkill) => (skill.source === 'mine' ? skillCopy.sourceMine : skill.source === 'bundled' ? skillCopy.sourceBundled : skill.source === 'local' ? skillCopy.sourceLocal : skillCopy.sourceHub);
  const detailSkill = view.type === 'detail' ? all.find(skill => skill.key === view.key) : undefined;
  const editingRecord = view.type === 'edit' && view.id ? userSkills.find(skill => skill.id === view.id) : undefined;

  const use = async (skill: DeckSkill) => {
    const attach = useStudioHubStore.getState().handlers.attachSkill;
    if (!attach) { setError(copy.useUnavailable); return; }
    setError(null);
    try {
      const { attachment } = await resolveSkillAttachment(skill, skillCopy);
      attach(attachment);
      setAttachedId(skill.id);
      setNotice(copy.attached);
    } catch (useError) {
      setError(skillRegistryErrorMessage(useError));
    }
  };
  const install = async (skill: DeckSkill) => {
    if (!hubUrl) { setError(skillCopy.configureHub); return; }
    setInstallingId(skill.id);
    setError(null);
    try { await installFromHub(skill.id); } catch (installError) { setError(skillRegistryErrorMessage(installError)); } finally { setInstallingId(null); }
  };
  const visibleKeys = useMemo(() => visible.map(skill => skill.key), [visible]);
  // 拖动 / 键盘调整顺序：写回完整顺序（不可见的 Skill 留在原位），切到「自定义」排序并存进 localStorage。
  const reorder = useCallback((key: string, toIndex: number) => {
    const base = [...skillOrder, ...all.map(skill => skill.key).filter(item => !skillOrder.includes(item))];
    const next = reorderVisible(base, visibleKeys, key, toIndex);
    setSkillOrder(next);
    saveSkillOrder(next);
    setSort('manual');
    const skill = all.find(item => item.key === key);
    if (skill) setAnnounce(cardCopy.moved(skill.name, Math.min(visibleKeys.length, Math.max(1, toIndex + 1)), visibleKeys.length));
  }, [skillOrder, all, visibleKeys, cardCopy]);
  const { drag, ghostRef, onPointerDown, captureFlip } = useSkillCardDrag({
    keys: visibleKeys,
    gridRef,
    scrollRef,
    reduceMotion,
    canDropOnComposer: key => {
      const skill = all.find(item => item.key === key);
      return Boolean(canAttach && skill && skill.enabled && (skill.source !== 'hub' || skill.installed));
    },
    onReorder: reorder,
    onDropOnComposer: key => { const skill = all.find(item => item.key === key); if (skill) void use(skill); },
  });
  const focusKey = useRef<string | null>(null);
  const moveByKeyboard = (skill: DeckSkill, delta: -1 | 1) => {
    const from = visibleKeys.indexOf(skill.key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= visibleKeys.length) return;
    captureFlip();
    focusKey.current = skill.key;
    reorder(skill.key, to);
  };
  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    focusKey.current = null;
    const card = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-key]') || []).find(element => element.dataset.key === key);
    card?.querySelector<HTMLElement>('.studio-hub__card-open')?.focus({ preventScroll: false });
  }, [visibleKeys]);
  useEffect(() => {
    if (!cardMenu) return;
    const close = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest?.('.studio-hub__card-menu, .studio-hub__card-more')) setCardMenu(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [cardMenu]);
  const dragSkill = drag ? all.find(skill => skill.key === drag.key) : undefined;

  const removeMine = async (skill: DeckSkill) => {
    const removed = await useUserSkillsStore.getState().remove(skill.id);
    setView({ type: 'grid' });
    if (removed) setUndo(removed);
  };
  const importSkill = async () => {
    setMenu(null);
    const file = await pickTextFile('.md,.markdown,.json,text/markdown,application/json');
    if (!file) return;
    const parsed = parseSkillImport(file.text, file.name);
    if (!parsed) { setError(skillCopy.importFailed); return; }
    setView({ type: 'edit', id: null, initial: { ...parsed, enabled: true } });
  };

  const sortLabel = sort === 'manual' ? cardCopy.sortManual : sort === 'name' ? copy.sortName : sort === 'source' ? copy.sortSource : copy.sortRecent;
  const chips: { id: SkillChip; label: string }[] = [
    { id: 'all', label: copy.chipAll }, { id: 'enabled', label: copy.chipEnabled }, { id: 'off', label: copy.chipOff }, { id: 'updates', label: copy.chipUpdates },
  ];

  return (
    <div className="studio-hub__pane" ref={gridKeys.paneRef} onKeyDown={view.type === 'grid' ? gridKeys.onPaneKeyDown : undefined}>
      {view.type === 'grid' ? (
        <>
          <header className="studio-hub__head">
            <h2>{copy.skills}<span className="studio-hub__count">{copy.skillCount(visible.length)}</span></h2>
            <div className="studio-hub__tools">
              <label className="studio-hub__search">
                <Search size={14} aria-hidden="true" />
                <input ref={gridKeys.inputRef} type="search" value={query} placeholder={skillCopy.search} aria-label={skillCopy.search} onChange={event => setQuery(event.target.value)} onKeyDown={gridKeys.onInputKeyDown} />
              </label>
              <div className="studio-hub__menu-anchor">
                <button type="button" className="studio-hub__btn" aria-haspopup="menu" aria-expanded={menu === 'sort'} onClick={() => setMenu(menu === 'sort' ? null : 'sort')}>
                  <ArrowDownWideNarrow size={14} aria-hidden="true" /><span>{sortLabel}</span>
                </button>
                {menu === 'sort' && (
                  <div className="skill-hub__menu studio-hub__menu" role="menu" {...sortMenuKeys}>
                    {([['recent', copy.sortRecent], ['name', copy.sortName], ['source', copy.sortSource], ['manual', cardCopy.sortManual]] as const).map(([id, label]) => (
                      <button key={id} type="button" role="menuitemradio" aria-checked={sort === id} onClick={() => { setSort(id); setMenu(null); }}>
                        {sort === id ? <Check size={13} aria-hidden="true" /> : <span className="studio-hub__menu-gap" />}<span>{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="studio-hub__menu-anchor">
                <button type="button" className="studio-hub__btn is-primary" aria-haspopup="menu" aria-expanded={menu === 'create'} onClick={() => setMenu(menu === 'create' ? null : 'create')}>
                  <Plus size={14} aria-hidden="true" /><span>{skillCopy.createMenu}</span>
                </button>
                {menu === 'create' && (
                  <div className="skill-hub__menu studio-hub__menu" role="menu" {...createMenuKeys}>
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); setView({ type: 'edit', id: null }); }}><Plus size={13} aria-hidden="true" /><span>{skillCopy.createBlank}</span></button>
                    {skillTemplates(language).map(template => (
                      <button key={template.id} type="button" role="menuitem" title={template.description} onClick={() => { setMenu(null); setView({ type: 'edit', id: null, initial: { name: template.name, slug: template.slug, description: template.description, prompt: template.prompt, enabled: true } }); }}>
                        <LayoutTemplate size={13} aria-hidden="true" /><span>{skillCopy.templateLabel(template.name)}</span>
                      </button>
                    ))}
                    <button type="button" role="menuitem" onClick={() => void importSkill()}><FileUp size={13} aria-hidden="true" /><span>{skillCopy.createImport}</span></button>
                  </div>
                )}
              </div>
            </div>
          </header>
          <div className="studio-hub__chips" role="group" aria-label={copy.sort}>
            {chips.map(item => (
              <button key={item.id} type="button" className="studio-hub__chip" aria-pressed={chip === item.id} onClick={() => setChip(item.id)}>{item.label}</button>
            ))}
          </div>
          {error && <p className="studio-hub__error" role="alert">{error}</p>}
          <p id={hintId} className="studio-hub__sr">{cardCopy.dragHint}</p>
          <p className="studio-hub__sr" role="status" aria-live="polite">{announce}</p>
          <div className="studio-hub__scroll isl-scrollbar" ref={scrollRef}>
            {visible.length ? (
              <ul className="studio-hub__grid" ref={gridRef} data-dragging={drag ? 'true' : undefined}>
                {visible.map((skill, index) => (
                  <SkillCard
                    key={skill.key}
                    skill={skill}
                    index={index}
                    total={visible.length}
                    copy={copy}
                    skillCopy={skillCopy}
                    cardCopy={cardCopy}
                    sourceLabel={sourceLabel(skill)}
                    favorite={favoriteIds.has(skill.id)}
                    attached={attachedId === skill.id}
                    canAttach={canAttach}
                    installing={installingId === skill.id}
                    hintId={hintId}
                    menuOpen={cardMenu === skill.key}
                    dragging={drag?.key === skill.key}
                    dropSide={drag && drag.targetIndex === index && drag.key !== skill.key ? (index < drag.fromIndex ? 'before' : 'after') : undefined}
                    onPointerDown={event => onPointerDown(event, skill.key)}
                    onMove={delta => moveByKeyboard(skill, delta)}
                    onOpen={() => setView({ type: 'detail', key: skill.key })}
                    onMenu={open => setCardMenu(open ? skill.key : null)}
                    onToggleFavorite={() => void toggleFavorite(skill.id)}
                    onUse={() => void use(skill)}
                    onInstall={() => void install(skill)}
                  />
                ))}
              </ul>
            ) : (
              <p className="studio-hub__empty">{section === 'favorites' ? skillCopy.favoritesEmpty : section === 'mine' ? skillCopy.mineEmpty : section === 'hub' ? skillCopy.hubEmpty : skillCopy.noMatch}</p>
            )}
          </div>
        </>
      ) : (
        <>
          <header className="studio-hub__head">
            <button type="button" className="studio-hub__btn" onClick={() => setView({ type: 'grid' })}><ChevronLeft size={14} aria-hidden="true" /><span>{copy.skills}</span></button>
          </header>
          {error && <p className="studio-hub__error" role="alert">{error}</p>}
          <div className="studio-hub__scroll isl-scrollbar studio-hub__detail">
            {view.type === 'detail' && detailSkill && (
              <SkillDetail
                key={detailSkill.key}
                skill={detailSkill}
                copy={skillCopy}
                language={language}
                attached={attachedId === detailSkill.id}
                hubUrl={hubUrl}
                installing={installingId === detailSkill.id}
                favorite={favoriteIds.has(detailSkill.id)}
                onToggleFavorite={() => void toggleFavorite(detailSkill.id)}
                onUse={() => void use(detailSkill)}
                onToggleEnabled={enabled => void useUserSkillsStore.getState().setEnabled(detailSkill.id, enabled)}
                onEdit={() => setView({ type: 'edit', id: detailSkill.id })}
                onDelete={() => void removeMine(detailSkill)}
                onUninstall={async () => { await uninstallSkill(detailSkill.id); setView({ type: 'grid' }); }}
                onInstall={() => void install(detailSkill)}
                onRefresh={() => void refreshLocal()}
                plan={<SkillPlan skill={detailSkill} language={language} />}
              />
            )}
            {view.type === 'detail' && !detailSkill && <p className="studio-hub__empty">{skillCopy.noMatch}</p>}
            {view.type === 'edit' && (
              <SkillEditor
                key={view.id || 'new'}
                copy={skillCopy}
                initial={editingRecord ? { name: editingRecord.name, slug: editingRecord.slug, description: editingRecord.description, prompt: editingRecord.prompt, enabled: editingRecord.enabled !== false } : view.initial || EMPTY_DRAFT}
                onCancel={() => setView(view.id ? { type: 'detail', key: `mine:${view.id}` } : { type: 'grid' })}
                onSave={async draft => {
                  const saved = view.id ? await useUserSkillsStore.getState().update(view.id, draft) : await useUserSkillsStore.getState().create(draft);
                  setView({ type: 'detail', key: `mine:${saved.id}` });
                }}
              />
            )}
          </div>
        </>
      )}
      {drag && dragSkill && typeof document !== 'undefined' && createPortal(
        <>
          {drag.composerRect && (
            <div
              className="studio-hub__drop-zone"
              data-over={drag.overComposer ? 'true' : undefined}
              aria-hidden="true"
              style={{ left: drag.composerRect.left, top: drag.composerRect.top, width: drag.composerRect.width, height: drag.composerRect.height }}
            >
              <span>{cardCopy.dropToUse(dragSkill.name)}</span>
            </div>
          )}
          <div className="studio-hub__ghost" ref={ghostRef} aria-hidden="true" style={{ width: drag.width, height: drag.height }}>
            <div className="studio-hub__card studio-hub__ghost-card" data-reduce={reduceMotion ? 'true' : undefined}>
              <SkillCardFace skill={dragSkill} />
              <span className="studio-hub__card-foot">
                <span className="studio-hub__meta-pill" data-source={dragSkill.source}>{sourceLabel(dragSkill)}</span>
                <span className="studio-hub__ghost-use">{copy.use}</span>
              </span>
            </div>
          </div>
        </>,
        document.body,
      )}
      {undo && (
        <div className="skill-hub__undo studio-hub__toast" role="status">
          <span>{skillCopy.deleted(undo.skill.name)}</span>
          <button type="button" onClick={() => { const removed = undo; setUndo(null); void useUserSkillsStore.getState().restore(removed); }}>{skillCopy.undo}</button>
        </div>
      )}
      {notice && !undo && <div className="skill-hub__undo studio-hub__toast" role="status"><Check size={13} aria-hidden="true" /><span>{notice}</span></div>}
    </div>
  );
}

type SkillCopy = (typeof SKILL_COPY)[keyof typeof SKILL_COPY];
type CardCopy = (typeof translations)[keyof typeof translations]['skillCards'];

/** 卡面（内缩封面 + 粗体标题 + 等宽 $slug + 两行渐隐说明）：网格里的卡和手里拖着的浮层共用。 */
function SkillCardFace({ skill }: { skill: DeckSkill }) {
  return (
    <>
      <span className="studio-hub__card-cover" data-tone-seed={skill.seed % 4}>
        {skill.cover ? <img src={skill.cover} alt="" draggable={false} /> : <SkillMark seed={skill.seed} large />}
      </span>
      <span className="studio-hub__card-body">
        <strong>{skill.name}</strong>
        <em className="flv-machine">{skill.handle}</em>
        <span className="studio-hub__card-desc">{skill.description}</span>
      </span>
    </>
  );
}

/**
 * Hub 网格里的 Skill 卡：Bleep App 卡片语言（Inspora · Rolando）——半透明磨砂面、上沿更亮的 1px 细线、柔和宽阴影、16px 圆角；
 * 封面内缩 10px、自带 10px 圆角；粗体小标题 + 等宽幽灵色 $slug + 两行渐隐说明 + 底部来源胶囊；悬停微浮起并露出右上角「…」。
 * 按住拖动排序 / 拖到输入框使用（useSkillCardDrag）；聚焦时 Alt + 方向键调整顺序。
 */
function SkillCard({
  skill, index, total, copy, skillCopy, cardCopy, sourceLabel, favorite, attached, canAttach, installing, hintId, menuOpen, dragging, dropSide,
  onPointerDown, onMove, onOpen, onMenu, onToggleFavorite, onUse, onInstall,
}: {
  skill: DeckSkill;
  index: number;
  total: number;
  copy: StudioHubCopy;
  skillCopy: SkillCopy;
  cardCopy: CardCopy;
  sourceLabel: string;
  favorite: boolean;
  attached: boolean;
  canAttach: boolean;
  installing: boolean;
  hintId: string;
  menuOpen: boolean;
  dragging: boolean;
  dropSide?: 'before' | 'after';
  onPointerDown: (event: ReactPointerEvent<HTMLLIElement>) => void;
  onMove: (delta: -1 | 1) => void;
  onOpen: () => void;
  onMenu: (open: boolean) => void;
  onToggleFavorite: () => void;
  onUse: () => void;
  onInstall: () => void;
}) {
  const needsInstall = skill.source === 'hub' && (!skill.installed || skill.updateAvailable);
  const usable = !needsInstall && skill.enabled;
  const cardMenuKeys = useMenuKeyboard({ open: menuOpen, onClose: () => onMenu(false) });
  const menuItem = (key: string, icon: ReactNode, label: string, action: () => void, disabled = false) => (
    <button key={key} type="button" role="menuitem" disabled={disabled} onClick={() => { onMenu(false); action(); }}>{icon}<span>{label}</span></button>
  );
  return (
    <li
      data-key={skill.key}
      className="studio-hub__card"
      data-off={skill.enabled ? undefined : 'true'}
      data-dragging={dragging ? 'true' : undefined}
      data-drop={dropSide}
      data-menu={menuOpen ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onKeyDown={event => {
        if (!(event.target as Element).classList.contains('studio-hub__card-open')) return;
        const delta = keyboardMoveDelta(event);
        if (!delta) return;
        event.preventDefault();
        onMove(delta);
      }}
    >
      <button type="button" className="studio-hub__card-open" aria-label={skillCopy.details(skill.name)} aria-describedby={hintId} draggable={false} onClick={onOpen}>
        <SkillCardFace skill={skill} />
      </button>
      <button
        type="button"
        className="studio-hub__card-more"
        data-no-drag
        aria-label={cardCopy.more(skill.name)}
        title={cardCopy.more(skill.name)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => onMenu(!menuOpen)}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {menuOpen && (
        <div
          className="skill-hub__menu studio-hub__menu studio-hub__card-menu"
          role="menu"
          data-no-drag
          {...cardMenuKeys}
        >
          {menuItem('open', <Eye size={13} aria-hidden="true" />, cardCopy.open, onOpen)}
          {usable && menuItem('use', <Sparkles size={13} aria-hidden="true" />, copy.use, onUse, !canAttach)}
          {needsInstall && menuItem('install', <RefreshCw size={13} aria-hidden="true" />, skill.updateAvailable ? copy.update : copy.install, onInstall, installing)}
          {menuItem('like', <Heart size={13} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />, favorite ? skillCopy.unlike : skillCopy.like, onToggleFavorite)}
          {menuItem('earlier', <ArrowLeft size={13} aria-hidden="true" />, cardCopy.moveEarlier, () => onMove(-1), index === 0)}
          {menuItem('later', <ArrowRight size={13} aria-hidden="true" />, cardCopy.moveLater, () => onMove(1), index >= total - 1)}
        </div>
      )}
      <div className="studio-hub__card-foot" data-no-drag>
        <span className="studio-hub__meta-pill" data-source={skill.source}>{sourceLabel}</span>
        <button type="button" className="studio-hub__like" aria-pressed={favorite} aria-label={favorite ? skillCopy.unfavorite(skill.name) : skillCopy.favorite(skill.name)} onClick={onToggleFavorite}>
          <Heart size={14} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
        {needsInstall ? (
          <button type="button" className="studio-hub__btn" disabled={installing} onClick={onInstall}>
            <RefreshCw size={13} className={installing ? 'is-spinning' : undefined} aria-hidden="true" /><span>{skill.updateAvailable ? copy.update : copy.install}</span>
          </button>
        ) : !skill.enabled ? (
          <span className="skill-hub__state is-off">{copy.off}</span>
        ) : (
          <button type="button" className="studio-hub__btn is-primary" disabled={!canAttach} title={canAttach ? undefined : copy.useUnavailable} onClick={onUse}>
            {attached ? <Check size={13} aria-hidden="true" /> : null}<span>{copy.use}</span>
          </button>
        )}
      </div>
    </li>
  );
}

function stepIcon(kind: string) {
  if (kind === 'video') return <Clapperboard />;
  if (kind === 'audio') return <AudioLines />;
  if (kind === 'text' || kind === 'script') return <Type />;
  if (kind === 'image') return <ImageIcon />;
  return <Square />;
}

/**
 * Skill 详情里的「这个 Skill 会做什么」：画布配方（我的 Skill 从一组节点保存）给出逐步节点；
 * 内置 Skill 给出清单里的审核关口。两者都没有就不显示。外观同生成计划卡（PlanSteps）。
 */
function SkillPlan({ skill, language }: { skill: DeckSkill; language: 'en' | 'zho' }) {
  const copy = translations[language].planSteps;
  const record = useUserSkillsStore(state => (skill.source === 'mine' ? state.skills.find(item => item.id === skill.id) : undefined));
  const steps: PlanStep[] = useMemo(() => {
    if (record?.recipe?.steps.length) {
      return record.recipe.steps.map((step, index) => ({
        id: `${step.nodeId || 'step'}-${index}`,
        title: step.title || copy.skillNodeKind[step.type] || step.type,
        status: 'pending' as const,
        icon: stepIcon(step.type),
        description: step.prompt?.trim() || undefined,
        chip: [copy.skillNodeKind[step.type] || step.type, step.model].filter(Boolean).join(' · '),
      }));
    }
    const bundled = skill.source === 'bundled' ? getBundledProductionSkill(skill.id) : null;
    if (bundled?.gates.length) {
      return bundled.gates.map(gate => ({
        id: gate.id,
        title: copy.skillGate[gate.type] || gate.id,
        status: 'pending' as const,
        icon: <ShieldCheck />,
        chip: gate.type,
      }));
    }
    return [];
  }, [record, skill.source, skill.id, copy]);
  if (!steps.length) return null;
  const stages = !record?.recipe?.steps.length;
  return (
    <PlanSteps
      compact
      className="studio-hub__skill-plan"
      aria-label={copy.skillTitle}
      language={language}
      label={stages ? copy.skillStages : copy.skillTitle}
      listTitle={copy.count(steps.length)}
      count={steps.length}
      visibleRows={steps.length}
      steps={steps}
    />
  );
}

function HistoryPane({ copy, language, items, projectFilter, onRemove }: {
  copy: StudioHubCopy;
  language: 'en' | 'zho';
  items: StudioMediaItem[];
  projectFilter: string | null;
  onRemove: (sourceId: string) => void;
}) {
  const [tab, setTab] = useState<HistoryTab>('all');
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const gridKeys = useSearchGridKeyboard({ query, onQueryChange: setQuery, itemSelector: '.studio-hub__media-thumb', autoFocus: true });
  const favorites = useStudioHubStore(state => state.historyFavorites);
  const canInsert = useStudioHubStore(state => Boolean(state.handlers.insertHistory));
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return items
      .filter(item => {
        // 「Agent」= 内置或外部 Agent 发起的生成；没有画布归属的旧记录仍在「全部画布」里。
        if (projectFilter === HISTORY_AGENT_SECTION) { if (item.origin !== 'agent' && item.origin !== 'external-agent') return false; }
        else if (projectFilter && item.projectId !== projectFilter) return false;
        if (tab === 'image' && item.type !== 'image') return false;
        if (tab === 'video' && item.type !== 'video') return false;
        if (tab === 'favorites' && !favorites.has(item.id)) return false;
        return !keyword || `${item.name} ${item.prompt || ''}`.toLocaleLowerCase().includes(keyword);
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [items, projectFilter, tab, favorites, query]);
  const tabs: { id: HistoryTab; label: string }[] = [
    { id: 'all', label: copy.tabAll }, { id: 'image', label: copy.tabImages }, { id: 'video', label: copy.tabVideos }, { id: 'favorites', label: copy.tabFavorites },
  ];

  return (
    <div className="studio-hub__pane" ref={gridKeys.paneRef} onKeyDown={gridKeys.onPaneKeyDown}>
      <header className="studio-hub__head">
        <h2>{copy.history}<span className="studio-hub__count">{copy.count(visible.length)}</span></h2>
        <div className="studio-hub__tools">
          <label className="studio-hub__search">
            <Search size={14} aria-hidden="true" />
            <input ref={gridKeys.inputRef} type="search" value={query} placeholder={copy.search} aria-label={copy.search} onChange={event => setQuery(event.target.value)} onKeyDown={gridKeys.onInputKeyDown} />
          </label>
        </div>
      </header>
      <div className="studio-hub__chips" role="tablist" aria-label={copy.history}>
        {tabs.map(item => (
          <button key={item.id} type="button" role="tab" className="studio-hub__chip" aria-selected={tab === item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="studio-hub__scroll isl-scrollbar">
        {visible.length ? (
          <ul className="studio-hub__grid is-media">
            {visible.map(item => {
              const favorite = favorites.has(item.id);
              return (
                <li key={item.id} className="studio-hub__media">
                  <button type="button" className="studio-hub__media-thumb" disabled={!canInsert} title={canInsert ? copy.insert : copy.insertUnavailable} aria-label={`${copy.insert} ${item.name}`} onClick={() => useStudioHubStore.getState().handlers.insertHistory?.(item)}>
                    {/* 历史里视频存的是缩略图 data:image，按图片显示。 */}
                    {item.href.startsWith('data:image/') ? <img src={item.href} alt={item.name} loading="lazy" className="h-full w-full object-cover" /> : <StudioMediaPreview item={item} />}
                    {item.type === 'video' && <span className="studio-hub__media-kind">{copy.tabVideos}</span>}
                  </button>
                  <div className="studio-hub__media-foot">
                    <span className="studio-hub__media-name" title={item.prompt || item.name}>{item.prompt || item.name}</span>
                    <div className="studio-hub__media-actions">
                      <button type="button" className="studio-hub__like" aria-pressed={favorite} aria-label={favorite ? copy.unfavorite : copy.favorite} title={favorite ? copy.unfavorite : copy.favorite} onClick={() => void useStudioHubStore.getState().toggleHistoryFavorite(item.id)}>
                        <Heart size={13} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                      </button>
                      <StudioMediaDownload item={item} isChinese={language === 'zho'} />
                      <button type="button" className="isl-icon-btn flex h-7 w-7 items-center justify-center" aria-label={`${copy.remove} ${item.name}`} title={copy.remove} onClick={() => setConfirmId(item.id)}>
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {confirmId === item.id && (
                    <div className="studio-hub__confirm" role="alertdialog" aria-label={copy.confirmRemove}>
                      <span>{copy.confirmRemove}</span>
                      <div>
                        <button type="button" className="studio-hub__btn" onClick={() => setConfirmId(null)}>{SKILL_COPY[language].cancel}</button>
                        <button type="button" className="studio-hub__btn is-danger" onClick={() => { setConfirmId(null); if (item.sourceId) onRemove(item.sourceId); }}>{copy.remove}</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="studio-hub__empty">{tab === 'favorites' ? copy.favoritesEmpty : projectFilter === HISTORY_AGENT_SECTION ? copy.historyAgentEmpty : copy.historyEmpty}</p>
        )}
      </div>
    </div>
  );
}
