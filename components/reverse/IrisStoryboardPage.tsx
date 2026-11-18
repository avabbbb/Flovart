// Iris 故事版（v1）：左 = 项目素材（文本 / 图片 / 视频，按分类筛选），右 = 同一个 Agent 对话。
// 版式参照用户截图（2026-11-18）；视觉语言与动效参照 Hark（磨砂玻璃、柔和渐变底、胶囊分段、淡入上浮）。
// 数据只有一份：素材直接从当前 Workflow 项目的节点派生，所有写入都落到画布真节点上（见 irisStoryboard.ts）。
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, Crosshair, FileText, Film, Image as ImageIcon, Plus, Search, Tag, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useListboxKeyboard } from '../../hooks/useListboxKeyboard';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowProject } from '../workflow/types';
import {
  countStoryboardTags,
  deriveStoryboard,
  filterStoryboardAssets,
  STORYBOARD_TAGS,
  type StoryboardAsset,
  type StoryboardFilter,
  type StoryboardKind,
  type StoryboardTag,
} from './irisStoryboard';
import { addStoryboardMedia, addStoryboardText, setStoryboardTag, updateStoryboardText } from './irisStoryboardActions';
import '../../styles/irisStoryboard.css';

type Lang = 'zho' | 'en';

const KIND_LABEL: Record<StoryboardKind, Record<Lang, string>> = {
  text: { zho: '文本', en: 'Text' },
  image: { zho: '图片', en: 'Images' },
  video: { zho: '视频', en: 'Video' },
};

const TAG_LABEL: Record<StoryboardFilter, Record<Lang, string>> = {
  all: { zho: '全部', en: 'All' },
  script: { zho: '剧本', en: 'Script' },
  character: { zho: '角色', en: 'Character' },
  scene: { zho: '场景', en: 'Scene' },
  prop: { zho: '物品', en: 'Prop' },
  clip: { zho: '视频片段', en: 'Clip' },
  final: { zho: '成片', en: 'Final' },
  other: { zho: '其他', en: 'Other' },
};

// Hark 式动效：入场淡入 + 上浮 10px，柔和弹簧无过冲；分段胶囊用更快的一档。reduced-motion 时只做透明度。
const RISE = { type: 'spring' as const, visualDuration: 0.3, bounce: 0 };
const SNAPPY = { type: 'spring' as const, visualDuration: 0.22, bounce: 0 };

export interface IrisStoryboardPageProps {
  language: Lang;
  project: WorkflowProject | null;
  /** 没有画布时新建一个（返回项目 id）。 */
  onCreateProject: () => string;
  /** 跳到画布并聚焦该节点。 */
  onFocusNode: (nodeId: string) => void;
  /** 右侧对话：App 传入同一个 FlovartAgentPanel（不另起 Agent）。 */
  chat: ReactNode;
  onNotify?: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
}

function formatDuration(ms?: number) {
  if (!ms) return '';
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`;
}

// ── 列表浮层（分类 / 新建菜单）：磨砂、打开即可输入筛选、↑↓ / Enter / Esc（DESIGN §12）。
interface ListOption { id: string; label: string; hint?: string; icon?: ReactNode; selected?: boolean }

const POPOVER_WIDTH = 220;

// 浮层挂到 body（fixed 定位）：不被分区的滚动容器裁切，也不让面板成为 backdrop root。
function useAnchoredPosition(anchorRef: RefObject<HTMLElement | null>, align: 'start' | 'end', estimatedHeight: number) {
  const [position, setPosition] = useState<{ left: number; top: number; origin: string } | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 8;
      let left = align === 'end' ? anchor.right - POPOVER_WIDTH : anchor.left;
      left = Math.min(Math.max(margin, left), window.innerWidth - POPOVER_WIDTH - margin);
      const below = anchor.bottom + 6;
      const flip = below + estimatedHeight > window.innerHeight - margin && anchor.top - 6 - estimatedHeight > margin;
      setPosition({ left, top: flip ? anchor.top - 6 - estimatedHeight : below, origin: `${flip ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}` });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [anchorRef, align, estimatedHeight]);
  return position;
}

function IrisListPopover({ options, onSelect, onClose, label, placeholder, anchorRef, align = 'end' }: {
  options: ListOption[];
  onSelect: (option: ListOption) => void;
  onClose: () => void;
  label: string;
  placeholder: string;
  anchorRef: RefObject<HTMLElement | null>;
  align?: 'start' | 'end';
}) {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPosition(anchorRef, align, 48 + Math.min(options.length, 8) * 31);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter(option => option.label.toLowerCase().includes(needle) || (option.hint || '').toLowerCase().includes(needle)) : options;
  }, [options, query]);
  const initialIndex = Math.max(0, filtered.findIndex(option => option.selected));
  const keys = useListboxKeyboard({ items: filtered, query, onQueryChange: setQuery, onClose, onSelect: option => onSelect(option), initialIndex });
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [anchorRef, onClose]);
  return createPortal(
    <motion.div
      ref={rootRef}
      className="iris-popover"
      style={{ left: position?.left ?? -9999, top: position?.top ?? -9999, transformOrigin: position?.origin }}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
      transition={SNAPPY}
      onClick={event => event.stopPropagation()}
    >
      <div {...keys.getContainerProps({ className: 'iris-popover__inner', 'aria-label': label })}>
      <label className="iris-popover__search">
        <Search size={13} aria-hidden />
        <input {...keys.getInputProps({ value: query, onChange: event => setQuery(event.target.value), placeholder, 'aria-label': placeholder })} />
      </label>
      <div {...keys.getListboxProps({ className: 'iris-popover__list', 'aria-label': label })}>
        {filtered.length === 0 && <p className="iris-popover__empty">—</p>}
        {filtered.map((option, index) => (
          <button
            key={option.id}
            type="button"
            tabIndex={-1}
            className={`iris-popover__option${option.selected ? ' is-selected' : ''}`}
            {...keys.getOptionProps(index, { onClick: () => onSelect(option) })}
            aria-selected={option.selected || keys.activeIndex === index}
          >
            {option.icon && <span className="iris-popover__icon" aria-hidden>{option.icon}</span>}
            <span className="iris-popover__label">{option.label}</span>
            {option.hint && <span className="iris-popover__hint">{option.hint}</span>}
          </button>
        ))}
      </div>
      </div>
    </motion.div>,
    document.body,
  );
}

// ── 分段胶囊：选中块是实心浅色胶囊，在选项间弹簧滑动（Hark 聊天 / 项目切换）。
function SegmentPills({ kind, value, counts, onChange, language }: {
  kind: StoryboardKind;
  value: StoryboardFilter;
  counts: Record<StoryboardFilter, number>;
  onChange: (value: StoryboardFilter) => void;
  language: Lang;
}) {
  const groupId = useId();
  const options: StoryboardFilter[] = ['all', ...STORYBOARD_TAGS[kind]];
  return (
    <LayoutGroup id={groupId}>
      <div className="iris-segments" role="tablist" aria-label={KIND_LABEL[kind][language]}>
        {options.map(option => {
          const active = option === value;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={active}
              className={`iris-segments__item${active ? ' is-active' : ''}`}
              title={`${TAG_LABEL[option][language]} · ${counts[option] ?? 0}`}
              onClick={() => onChange(option)}
            >
              {active && <motion.span layoutId="pill" className="iris-segments__pill" transition={SNAPPY} aria-hidden />}
              <span className="iris-segments__text">{TAG_LABEL[option][language]}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

// ── 素材格子
function MediaThumb({ asset }: { asset: StoryboardAsset }) {
  const media = asset.media || {};
  const isVideo = asset.kind === 'video';
  const source = useWorkflowMediaUrl(isVideo ? media.posterStorageKey : media.storageKey, isVideo ? media.poster : media.href, isVideo ? undefined : media.artifactRef, { generated: media.generated });
  const [failed, setFailed] = useState(false);
  const url = source.url && !failed ? source.url : null;
  return (
    <span className="iris-tile__thumb">
      {url
        ? <img src={url} alt="" draggable={false} loading="lazy" onError={() => setFailed(true)} />
        : <span className="iris-tile__placeholder" aria-hidden>{isVideo ? <Film size={18} /> : <ImageIcon size={18} />}</span>}
      {isVideo && <span className="iris-tile__play" aria-hidden><span /></span>}
      {isVideo && asset.durationMs ? <span className="iris-tile__badge">{formatDuration(asset.durationMs)}</span> : null}
      {asset.status === 'loading' && <span className="iris-tile__loading" aria-hidden />}
    </span>
  );
}

interface TileActions {
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onFocus: (nodeId: string) => void;
  onTag: (asset: StoryboardAsset, tag: StoryboardTag | null) => void;
  language: Lang;
}

function TagButton({ asset, onTag, language }: { asset: StoryboardAsset; onTag: TileActions['onTag']; language: Lang }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const zh = language === 'zho';
  const options: ListOption[] = [
    ...STORYBOARD_TAGS[asset.kind].map(tag => ({ id: tag, label: TAG_LABEL[tag][language], selected: asset.explicitTag && asset.tag === tag })),
    { id: 'auto', label: zh ? '自动' : 'Auto', hint: zh ? '按节点推断' : 'Infer from node', selected: !asset.explicitTag },
  ];
  return (
    <span className="iris-tile__tagwrap">
      <button
        ref={buttonRef}
        type="button"
        className="iris-icon-btn is-small"
        aria-label={zh ? '分类' : 'Category'}
        title={zh ? '分类' : 'Category'}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={event => { event.stopPropagation(); setOpen(value => !value); }}
      ><Tag size={12} /></button>
      <AnimatePresence>
        {open && (
          <IrisListPopover
            anchorRef={buttonRef}
            align="start"
            label={zh ? '分类' : 'Category'}
            placeholder={zh ? '筛选分类' : 'Filter'}
            options={options}
            onClose={() => setOpen(false)}
            onSelect={option => { setOpen(false); onTag(asset, option.id === 'auto' ? null : option.id as StoryboardTag); }}
          />
        )}
      </AnimatePresence>
    </span>
  );
}

function MediaTile({ asset, index, actions }: { asset: StoryboardAsset; index: number; actions: TileActions }) {
  const reduce = useReducedMotion();
  const zh = actions.language === 'zho';
  const selected = actions.selectedId === asset.nodeId;
  return (
    <motion.div
      layout={reduce ? false : 'position'}
      className={`iris-tile${selected ? ' is-selected' : ''}`}
      data-node-id={asset.nodeId}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ ...RISE, delay: reduce ? 0 : Math.min(index, 10) * 0.03 }}
    >
      <button
        type="button"
        className="iris-tile__main"
        title={zh ? `${asset.title || '未命名'} · 双击在画布中定位` : `${asset.title || 'Untitled'} · double-click to locate on canvas`}
        aria-pressed={selected}
        onClick={() => actions.onSelect(asset.nodeId)}
        onDoubleClick={() => actions.onFocus(asset.nodeId)}
        onKeyDown={event => { if (event.key === 'Enter' && selected) { event.preventDefault(); actions.onFocus(asset.nodeId); } }}
      >
        <MediaThumb asset={asset} />
        <span className="iris-tile__name">{asset.title || (zh ? '未命名' : 'Untitled')}</span>
      </button>
      <span className="iris-tile__actions">
        <button type="button" className="iris-icon-btn is-small" aria-label={zh ? '在画布中定位' : 'Locate on canvas'} title={zh ? '在画布中定位' : 'Locate on canvas'} onClick={() => actions.onFocus(asset.nodeId)}><Crosshair size={12} /></button>
        <TagButton asset={asset} onTag={actions.onTag} language={actions.language} />
      </span>
    </motion.div>
  );
}

function TextRow({ asset, index, actions, projectId }: { asset: StoryboardAsset; index: number; actions: TileActions; projectId: string }) {
  const reduce = useReducedMotion();
  const zh = actions.language === 'zho';
  const open = actions.selectedId === asset.nodeId;
  const [draft, setDraft] = useState(asset.text || '');
  const editing = useRef(false);
  // 画布那边改了正文：没在编辑时跟着更新（同一份数据）。
  useEffect(() => { if (!editing.current) setDraft(asset.text || ''); }, [asset.text]);
  const editable = asset.nodeType === 'text';
  const save = () => { editing.current = false; if (draft !== (asset.text || '')) void updateStoryboardText(projectId, asset.nodeId, draft); };
  return (
    <motion.div
      layout={reduce ? false : 'position'}
      className={`iris-text${open ? ' is-open' : ''}`}
      data-node-id={asset.nodeId}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ ...RISE, delay: reduce ? 0 : Math.min(index, 10) * 0.03 }}
    >
      <div className="iris-text__row">
        <button type="button" className="iris-text__main" aria-expanded={open} onClick={() => actions.onSelect(asset.nodeId)} onDoubleClick={() => actions.onFocus(asset.nodeId)} title={asset.title}>
          <FileText size={13} aria-hidden />
          <span className="iris-text__title">{asset.title || (zh ? '未命名文本' : 'Untitled text')}</span>
          {asset.tag && asset.tag !== 'other' && <span className="iris-text__chip">{TAG_LABEL[asset.tag][actions.language]}</span>}
        </button>
        <span className="iris-tile__actions is-inline">
          <button type="button" className="iris-icon-btn is-small" aria-label={zh ? '在画布中定位' : 'Locate on canvas'} title={zh ? '在画布中定位' : 'Locate on canvas'} onClick={() => actions.onFocus(asset.nodeId)}><Crosshair size={12} /></button>
          <TagButton asset={asset} onTag={actions.onTag} language={actions.language} />
        </span>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="iris-text__body"
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={RISE}
          >
            {editable ? (
              <textarea
                className="iris-text__editor"
                value={draft}
                placeholder={zh ? '写点什么…（与画布上的同一个文本节点同步）' : 'Write… (synced with the same canvas node)'}
                onFocus={() => { editing.current = true; }}
                onChange={event => setDraft(event.target.value)}
                onBlur={save}
                aria-label={asset.title}
              />
            ) : (
              <p className="iris-text__preview">{asset.text || (zh ? '（空）' : '(empty)')}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StoryboardSection({ kind, assets, query, actions, projectId, onAdd, className }: {
  kind: StoryboardKind;
  assets: StoryboardAsset[];
  query: string;
  actions: TileActions;
  projectId: string | null;
  onAdd: (kind: StoryboardKind) => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [filter, setFilter] = useState<StoryboardFilter>('all');
  const [collapsed, setCollapsed] = useState(false);
  const counts = useMemo(() => countStoryboardTags(assets, kind), [assets, kind]);
  const visible = useMemo(() => filterStoryboardAssets(assets, filter, query), [assets, filter, query]);
  const zh = actions.language === 'zho';
  const bodyId = useId();
  return (
    <section className={`iris-section is-${kind}${collapsed ? ' is-collapsed' : ''}${className ? ' ' + className : ''}`} data-testid={`iris-section-${kind}`}>
      <header className="iris-section__head">
        <h3 className="iris-section__title">{KIND_LABEL[kind][actions.language]}<span className="iris-section__count">{assets.length}</span></h3>
        <SegmentPills kind={kind} value={filter} counts={counts} onChange={setFilter} language={actions.language} />
        <button
          type="button"
          className="iris-icon-btn is-small iris-section__collapse"
          aria-label={collapsed ? (zh ? '展开' : 'Expand') : (zh ? '收起' : 'Collapse')}
          title={collapsed ? (zh ? '展开' : 'Expand') : (zh ? '收起' : 'Collapse')}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(value => !value)}
        ><ChevronDown size={14} /></button>
      </header>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            id={bodyId}
            className="iris-section__body"
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={RISE}
          >
            <div className="iris-section__scroll">
              {visible.length === 0 ? (
                <div className="iris-empty">
                  <span>{assets.length ? (zh ? '没有匹配的素材' : 'No matching assets') : kind === 'text' ? (zh ? '还没有剧本或文本' : 'No scripts or notes yet') : kind === 'image' ? (zh ? '还没有图片' : 'No images yet') : (zh ? '还没有视频' : 'No videos yet')}</span>
                  {!assets.length && (
                    <button type="button" className="iris-ghost-pill" onClick={() => onAdd(kind)}>
                      {kind === 'text' ? <Plus size={12} /> : <Upload size={12} />}
                      {kind === 'text' ? (zh ? '新建剧本' : 'New script') : kind === 'image' ? (zh ? '上传图片' : 'Upload images') : (zh ? '上传视频' : 'Upload video')}
                    </button>
                  )}
                </div>
              ) : kind === 'text' ? (
                <div className="iris-text-list">
                  <AnimatePresence mode="popLayout">
                    {visible.map((asset, index) => projectId && <TextRow key={asset.nodeId} asset={asset} index={index} actions={actions} projectId={projectId} />)}
                  </AnimatePresence>
                </div>
              ) : (
                <div className={`iris-grid is-${kind}`}>
                  <AnimatePresence mode="popLayout">
                    {visible.map((asset, index) => <MediaTile key={asset.nodeId} asset={asset} index={index} actions={actions} />)}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function IrisStoryboardPage({ language, project, onCreateProject, onFocusNode, chat, onNotify }: IrisStoryboardPageProps) {
  const zh = language === 'zho';
  const reduce = useReducedMotion();
  const board = useMemo(() => deriveStoryboard(project?.nodes || []), [project?.nodes]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const pendingUpload = useRef<{ accept: string }>({ accept: 'image/*,video/*' });
  const total = board.text.length + board.image.length + board.video.length;

  const ensureProject = useCallback(() => project?.id || onCreateProject(), [onCreateProject, project?.id]);
  const report = useCallback((result: { ok: boolean; error?: string }) => {
    if (!result.ok && result.error) onNotify?.(result.error, 'error');
  }, [onNotify]);

  const addText = useCallback(async (tag: 'script' | 'other') => {
    const projectId = ensureProject();
    const count = board.text.filter(asset => asset.tag === tag).length + 1;
    const title = tag === 'script' ? (zh ? `剧本 ${count}` : `Script ${count}`) : (zh ? `文本 ${count}` : `Note ${count}`);
    // 新项目刚建好时 store 已同步更新；提交路径按 id 读取最新项目。
    const result = await addStoryboardText(projectId, tag, title);
    report(result);
    if (result.ok && result.nodeIds?.[0]) setSelectedId(result.nodeIds[0]);
  }, [board.text, ensureProject, report, zh]);

  const openUpload = useCallback((accept: string) => {
    pendingUpload.current = { accept };
    if (fileRef.current) { fileRef.current.accept = accept; fileRef.current.click(); }
  }, []);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const projectId = ensureProject();
    report(await addStoryboardMedia(projectId, Array.from(files)));
    if (fileRef.current) fileRef.current.value = '';
  }, [ensureProject, report]);

  const onAdd = useCallback((kind: StoryboardKind) => {
    if (kind === 'text') void addText('script');
    else openUpload(kind === 'image' ? 'image/*' : 'video/*');
  }, [addText, openUpload]);

  const actions: TileActions = useMemo(() => ({
    selectedId,
    language,
    onSelect: nodeId => setSelectedId(current => current === nodeId ? null : nodeId),
    onFocus: nodeId => onFocusNode(nodeId),
    onTag: (asset, tag) => { if (project) void setStoryboardTag(project.id, asset.nodeId, tag).then(report); },
  }), [language, onFocusNode, project, report, selectedId]);

  const addOptions: ListOption[] = [
    { id: 'script', label: zh ? '新建剧本' : 'New script', hint: zh ? '文本 · 剧本' : 'Text · Script', icon: <FileText size={13} /> },
    { id: 'note', label: zh ? '新建文本' : 'New note', hint: zh ? '文本 · 其他' : 'Text · Other', icon: <FileText size={13} /> },
    { id: 'image', label: zh ? '上传图片…' : 'Upload images…', hint: zh ? '图片' : 'Images', icon: <ImageIcon size={13} /> },
    { id: 'video', label: zh ? '上传视频…' : 'Upload video…', hint: zh ? '视频' : 'Video', icon: <Film size={13} /> },
  ];

  const panelMotion = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { ...RISE, delay: reduce ? 0 : delay },
  });

  return (
    <div className="iris-page" data-testid="iris-storyboard">
      <div className="iris-page__backdrop" aria-hidden><span className="iris-page__bloom" /></div>
      <div className="iris-page__layout">
      <motion.section className="iris-panel iris-board" aria-label={zh ? '项目素材' : 'Project assets'} {...panelMotion(0)}>
        <header className="iris-board__head">
          <div className="iris-board__heading">
            <h2 className="iris-board__title">{zh ? '项目素材' : 'Project assets'}</h2>
            <span className="iris-board__meta" title={project?.title}>{project ? `${project.title} · ${total}` : (zh ? '还没有画布' : 'No canvas yet')}</span>
          </div>
          <label className="iris-search">
            <Search size={13} aria-hidden />
            <input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }} placeholder={zh ? '搜索素材' : 'Search assets'} aria-label={zh ? '搜索素材' : 'Search assets'} />
            {query && <button type="button" className="iris-search__clear" aria-label={zh ? '清空' : 'Clear'} onClick={() => setQuery('')}><X size={12} /></button>}
          </label>
          <span className="iris-board__add">
            <button ref={addRef} type="button" className="iris-icon-btn" aria-label={zh ? '添加素材' : 'Add asset'} title={zh ? '添加素材（在画布上新建节点）' : 'Add asset (creates canvas nodes)'} aria-haspopup="listbox" aria-expanded={addOpen} onClick={() => setAddOpen(value => !value)}><Plus size={15} /></button>
            <AnimatePresence>
              {addOpen && (
                <IrisListPopover
                  anchorRef={addRef}
                  label={zh ? '添加素材' : 'Add asset'}
                  placeholder={zh ? '搜索操作' : 'Search actions'}
                  options={addOptions}
                  onClose={() => setAddOpen(false)}
                  onSelect={option => {
                    setAddOpen(false);
                    if (option.id === 'script') void addText('script');
                    else if (option.id === 'note') void addText('other');
                    else openUpload(option.id === 'image' ? 'image/*' : 'video/*');
                  }}
                />
              )}
            </AnimatePresence>
          </span>
          <input ref={fileRef} type="file" multiple hidden accept={pendingUpload.current.accept} onChange={event => void onFiles(event.target.files)} />
        </header>
        {!project && (
          <div className="iris-board__intro">
            <p>{zh ? '故事版和画布是同一份数据：在这里加的剧本、图片、视频会在画布上生成节点并自动排好。' : 'The storyboard and the canvas share one source of truth: scripts, images and videos you add here become canvas nodes, laid out for you.'}</p>
          </div>
        )}
        <div className="iris-board__grid">
          <StoryboardSection kind="text" assets={board.text} query={query} actions={actions} projectId={project?.id || null} onAdd={onAdd} className="iris-board__text" />
          <div className="iris-board__media">
            <StoryboardSection kind="image" assets={board.image} query={query} actions={actions} projectId={project?.id || null} onAdd={onAdd} />
            <StoryboardSection kind="video" assets={board.video} query={query} actions={actions} projectId={project?.id || null} onAdd={onAdd} />
          </div>
        </div>
      </motion.section>
      <motion.section className="iris-panel iris-chat" aria-label={zh ? '对话' : 'Chat'} {...panelMotion(0.06)}>
        {chat}
      </motion.section>
      </div>
    </div>
  );
}
