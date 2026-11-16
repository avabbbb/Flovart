import { ArrowDownWideNarrow, Check, ChevronLeft, Clock3, FileUp, FolderOpen, Heart, LayoutTemplate, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

// 放大的资源窗口：一个共享外壳，左侧栏切换 Skills / History / Library，各自带子项；窄宽度收成图标栏。
// 外观：bleep-app 式磨砂玻璃（--flv-frost-*，半透明），窗外是 Flovart 深色遮罩（--flv-scrim），不用白色蒙层。
// 业务不在这里复制：Skill 选用走 skillHubParts.resolveSkillAttachment + Composer 注册的 attachSkill；
// 插入画布走画布注册的 insertHistory / insertLibrary；本地文件夹直接复用 LocalFolderBrowser。

const EMPTY_DRAFT: EditorDraft = { name: '', slug: '', description: '', prompt: '', enabled: true };
const UNASSIGNED = '__unassigned__';

type SkillSort = 'recent' | 'name' | 'source';
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

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    windowRef.current?.focus();
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
      { id: UNASSIGNED, label: copy.historyUnassigned },
    ] },
    { kind: 'library', label: copy.library, icon: FolderOpen, items: folders.map(folder => ({ id: folder.id, label: folder.name })) },
  ];
  const activeSection = (kind: StudioHubKind) => (kind === 'skills' ? section || 'all' : section);

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
                      onClick={() => useStudioHubStore.getState().setSection(group.kind, group.kind === 'skills' ? 'all' : null)}
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
              {hub === 'history' && <HistoryPane copy={copy} language={language} items={historyItems} projectFilter={section} knownProjects={projects.map(project => project.id)} onRemove={onRemoveHistory} />}
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
  const [sort, setSort] = useState<SkillSort>('recent');
  const [chip, setChip] = useState<SkillChip>('all');
  const [view, setView] = useState<SkillView>({ type: 'grid' });
  const [menu, setMenu] = useState<null | 'create' | 'sort'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [undo, setUndo] = useState<RemovedUserSkill | null>(null);
  const [attachedId, setAttachedId] = useState<string | null>(null);

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
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, language === 'zho' ? 'zh-CN' : 'en'));
    else if (sort === 'source') sorted.sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));
    else sorted.sort((a, b) => (updatedAt.get(b.id) || '').localeCompare(updatedAt.get(a.id) || '') || Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id)));
    return sorted;
  }, [sectionSkills, query, chip, sort, language, updatedAt, favoriteIds]);

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

  const sortLabel = sort === 'name' ? copy.sortName : sort === 'source' ? copy.sortSource : copy.sortRecent;
  const chips: { id: SkillChip; label: string }[] = [
    { id: 'all', label: copy.chipAll }, { id: 'enabled', label: copy.chipEnabled }, { id: 'off', label: copy.chipOff }, { id: 'updates', label: copy.chipUpdates },
  ];

  return (
    <div className="studio-hub__pane">
      {view.type === 'grid' ? (
        <>
          <header className="studio-hub__head">
            <h2>{copy.skills}<span className="studio-hub__count">{copy.skillCount(visible.length)}</span></h2>
            <div className="studio-hub__tools">
              <label className="studio-hub__search">
                <Search size={14} aria-hidden="true" />
                <input type="search" value={query} placeholder={skillCopy.search} aria-label={skillCopy.search} onChange={event => setQuery(event.target.value)} />
              </label>
              <div className="studio-hub__menu-anchor">
                <button type="button" className="studio-hub__btn" aria-haspopup="menu" aria-expanded={menu === 'sort'} onClick={() => setMenu(menu === 'sort' ? null : 'sort')}>
                  <ArrowDownWideNarrow size={14} aria-hidden="true" /><span>{sortLabel}</span>
                </button>
                {menu === 'sort' && (
                  <div className="skill-hub__menu studio-hub__menu" role="menu">
                    {([['recent', copy.sortRecent], ['name', copy.sortName], ['source', copy.sortSource]] as const).map(([id, label]) => (
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
                  <div className="skill-hub__menu studio-hub__menu" role="menu">
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
          <div className="studio-hub__scroll isl-scrollbar">
            {visible.length ? (
              <ul className="studio-hub__grid">
                {visible.map(skill => (
                  <li key={skill.key} className="studio-hub__card" data-off={skill.enabled ? undefined : 'true'}>
                    <button type="button" className="studio-hub__card-open" aria-label={skillCopy.details(skill.name)} onClick={() => setView({ type: 'detail', key: skill.key })}>
                      <div className="studio-hub__card-cover" data-tone-seed={skill.seed % 4}>
                        {skill.cover ? <img src={skill.cover} alt="" /> : <SkillMark seed={skill.seed} large />}
                        <span className="skill-hub__badge">{sourceLabel(skill)}</span>
                      </div>
                      <div className="studio-hub__card-body">
                        <strong>{skill.name}</strong>
                        <em>{skill.handle}</em>
                        <p>{skill.description}</p>
                      </div>
                    </button>
                    <div className="studio-hub__card-foot">
                      <button type="button" className="studio-hub__like" aria-pressed={favoriteIds.has(skill.id)} aria-label={favoriteIds.has(skill.id) ? skillCopy.unfavorite(skill.name) : skillCopy.favorite(skill.name)} onClick={() => void toggleFavorite(skill.id)}>
                        <Heart size={14} fill={favoriteIds.has(skill.id) ? 'currentColor' : 'none'} aria-hidden="true" />
                      </button>
                      {skill.source === 'hub' && (!skill.installed || skill.updateAvailable) ? (
                        <button type="button" className="studio-hub__btn" disabled={installingId === skill.id} onClick={() => void install(skill)}>
                          <RefreshCw size={13} className={installingId === skill.id ? 'is-spinning' : undefined} aria-hidden="true" /><span>{skill.updateAvailable ? copy.update : copy.install}</span>
                        </button>
                      ) : !skill.enabled ? (
                        <span className="skill-hub__state is-off">{copy.off}</span>
                      ) : (
                        <button type="button" className="studio-hub__btn is-primary" disabled={!canAttach} title={canAttach ? undefined : copy.useUnavailable} onClick={() => void use(skill)}>
                          {attachedId === skill.id ? <Check size={13} aria-hidden="true" /> : null}<span>{copy.use}</span>
                        </button>
                      )}
                    </div>
                  </li>
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

function HistoryPane({ copy, language, items, projectFilter, knownProjects, onRemove }: {
  copy: StudioHubCopy;
  language: 'en' | 'zho';
  items: StudioMediaItem[];
  projectFilter: string | null;
  knownProjects: string[];
  onRemove: (sourceId: string) => void;
}) {
  const [tab, setTab] = useState<HistoryTab>('all');
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const favorites = useStudioHubStore(state => state.historyFavorites);
  const canInsert = useStudioHubStore(state => Boolean(state.handlers.insertHistory));
  const known = useMemo(() => new Set(knownProjects), [knownProjects]);
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return items
      .filter(item => {
        if (projectFilter === UNASSIGNED) { if (item.projectId && known.has(item.projectId)) return false; }
        else if (projectFilter && item.projectId !== projectFilter) return false;
        if (tab === 'image' && item.type !== 'image') return false;
        if (tab === 'video' && item.type !== 'video') return false;
        if (tab === 'favorites' && !favorites.has(item.id)) return false;
        return !keyword || `${item.name} ${item.prompt || ''}`.toLocaleLowerCase().includes(keyword);
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [items, projectFilter, known, tab, favorites, query]);
  const tabs: { id: HistoryTab; label: string }[] = [
    { id: 'all', label: copy.tabAll }, { id: 'image', label: copy.tabImages }, { id: 'video', label: copy.tabVideos }, { id: 'favorites', label: copy.tabFavorites },
  ];

  return (
    <div className="studio-hub__pane">
      <header className="studio-hub__head">
        <h2>{copy.history}<span className="studio-hub__count">{copy.count(visible.length)}</span></h2>
        <div className="studio-hub__tools">
          <label className="studio-hub__search">
            <Search size={14} aria-hidden="true" />
            <input type="search" value={query} placeholder={copy.search} aria-label={copy.search} onChange={event => setQuery(event.target.value)} />
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
          <p className="studio-hub__empty">{tab === 'favorites' ? copy.favoritesEmpty : copy.historyEmpty}</p>
        )}
      </div>
    </div>
  );
}
