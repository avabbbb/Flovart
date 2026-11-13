import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, ChevronDown, Plus, Search, Tag } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { BrailleLoader } from './BrailleLoader';
import '../../styles/tags.css';

/**
 * 标签选择器（标签名 → 稳定色点）。灰壳 + 白卡：顶部灰色头行写明“给谁打标签”，
 * 头部色点随高亮行变色；白卡内是紧凑搜索框 + 选项列表，灰色高亮胶囊在行间滑动。
 * 输入不存在的名字时出现“创建”行，异步创建期间用盲文点阵 loader。
 */

export const TAG_COLORS = ['red', 'orange', 'green', 'blue', 'violet', 'pink'] as const;
export type TagColor = typeof TAG_COLORS[number];

/** 同一个标签名在任何地方都落到同一种颜色（FNV-1a）。 */
export function tagColor(name: string): TagColor {
  let h = 0x811c9dc5;
  for (const ch of name.trim().toLocaleLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return TAG_COLORS[(h >>> 0) % TAG_COLORS.length];
}
export const tagColorVar = (name: string) => `var(--tag-${tagColor(name)})`;

export interface TagPickerProps {
  language: 'en' | 'zho';
  /** 已知标签（通常是素材库里出现过的全部标签）。 */
  options: string[];
  /** 当前选中的标签。 */
  value: string[];
  onChange: (next: string[]) => void;
  /** 新建标签。返回 Promise 时显示盲文 loader，完成后自动选中；不传则直接加入选中。 */
  onCreate?: (name: string) => void | Promise<void>;
  /** 头行里“给谁打标签”的说明，例如“3 个素材”。 */
  subject?: string;
  disabled?: boolean;
  align?: 'start' | 'end';
  /** 初始展开（测试 / 内嵌场景）。 */
  defaultOpen?: boolean;
  className?: string;
}

type Row = { kind: 'tag'; name: string } | { kind: 'create'; name: string };

export function TagPicker({ language, options, value, onChange, onCreate, subject, disabled, align = 'start', defaultOpen = false, className }: TagPickerProps) {
  const zh = language === 'zho';
  const reduce = useReducedMotion();
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [creating, setCreating] = useState<string | null>(null);
  const [created, setCreated] = useState<string[]>([]);

  const allTags = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...options, ...created, ...value]) {
      const name = t.trim();
      if (name && !seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out;
  }, [options, created, value]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim();
    const kw = q.toLocaleLowerCase();
    const matched = allTags.filter(t => !kw || t.toLocaleLowerCase().includes(kw)).map<Row>(name => ({ kind: 'tag', name }));
    const exact = allTags.some(t => t.toLocaleLowerCase() === kw);
    if (q && !exact) matched.push({ kind: 'create', name: q });
    return matched;
  }, [allTags, query]);

  // 打开时聚焦搜索框；关闭时清空搜索。
  useEffect(() => {
    if (open) { requestAnimationFrame(() => inputRef.current?.focus()); }
    else { setQuery(''); setActive(-1); }
  }, [open]);
  useEffect(() => { setActive(a => (a >= rows.length ? rows.length - 1 : a)); }, [rows.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter(t => t !== name) : [...value, name]);
  };

  const create = async (raw: string) => {
    const name = raw.trim();
    if (!name || creating) return;
    setCreating(name);
    try {
      await onCreate?.(name);
      setCreated(prev => (prev.includes(name) ? prev : [...prev, name]));
      if (!value.includes(name)) onChange([...value, name]);
      setQuery('');
    } finally {
      setCreating(null);
    }
  };

  const commit = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'create') void create(row.name);
    else toggle(row.name);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = active < 0 ? (step > 0 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length;
      setActive(next);
      listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(active >= 0 ? rows[active] : rows.length === 1 ? rows[0] : rows.find(r => r.kind === 'create'));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  const activeRow = active >= 0 ? rows[active] : undefined;
  const headerColor = activeRow ? tagColorVar(activeRow.name) : value.length ? tagColorVar(value[value.length - 1]) : 'var(--tag-idle)';
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 620, damping: 44, mass: 0.6 };
  const listId = `${uid}-list`;

  return (
    <div ref={rootRef} className={'flv-tagpicker' + (className ? ' ' + className : '')} data-align={align}>
      <button
        type="button"
        className="flv-tagpicker__trigger"
        data-open={open || undefined}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Tag size={12} className="flv-tagpicker__trigger-icon" />
        {value.length === 0 ? (
          <span className="flv-tagpicker__trigger-placeholder">{zh ? '选择标签' : 'Pick tags'}</span>
        ) : (
          <>
            <span className="flv-tagpicker__stack" aria-hidden>
              {value.slice(0, 3).map(t => <i key={t} style={{ background: tagColorVar(t) }} />)}
            </span>
            <span className="flv-tagpicker__trigger-text">{value[0]}</span>
            {value.length > 1 && <span className="flv-tagpicker__more flv-machine">+{value.length - 1}</span>}
          </>
        )}
        <ChevronDown size={12} className="flv-tagpicker__chevron" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="flv-tagpicker__pop"
            role="dialog"
            aria-label={zh ? '标签' : 'Tags'}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={reduce ? { duration: 0.01 } : { type: 'spring', stiffness: 520, damping: 36, mass: 0.7 }}
          >
            <div className="flv-tagpicker__head">
              <Tag size={13} className="flv-tagpicker__head-icon" />
              <span className="flv-tagpicker__head-verb">{zh ? '标记' : 'Tag'}</span>
              <motion.i
                key={activeRow?.name ?? 'none'}
                className="flv-tagpicker__head-dot"
                style={{ background: headerColor }}
                initial={reduce ? false : { scale: 0.6 }}
                animate={{ scale: 1 }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 700, damping: 22 }}
              />
              <span className="flv-tagpicker__head-subject">{subject || (zh ? '素材' : 'Assets')}</span>
              {value.length > 0 && <span className="flv-tagpicker__head-count flv-machine">{value.length}</span>}
            </div>

            <div className="flv-tagpicker__card">
              <label className="flv-tagpicker__search">
                <Search size={13} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setActive(e.target.value.trim() ? 0 : -1); }}
                  onKeyDown={onKeyDown}
                  placeholder={zh ? '搜索或新建标签…' : 'Search or create a tag…'}
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-activedescendant={active >= 0 ? `${uid}-row-${active}` : undefined}
                  spellCheck={false}
                />
              </label>

              <div ref={listRef} id={listId} role="listbox" aria-multiselectable className="flv-tagpicker__list isl-scrollbar" onMouseLeave={() => setActive(-1)}>
                {rows.length === 0 && (
                  <div className="flv-tagpicker__empty">{zh ? '还没有标签，输入名字新建' : 'No tags yet — type to create one'}</div>
                )}
                {rows.map((row, i) => {
                  const selected = row.kind === 'tag' && value.includes(row.name);
                  const isCreating = row.kind === 'create' && creating === row.name;
                  return (
                    <motion.div
                      key={`${row.kind}:${row.name}`}
                      id={`${uid}-row-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={selected}
                      aria-busy={isCreating || undefined}
                      className="flv-tagpicker__row"
                      data-kind={row.kind}
                      layout={reduce ? false : 'position'}
                      initial={reduce ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={reduce ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => commit(row)}
                    >
                      {active === i && (
                        <motion.span layoutId={`${uid}-hl`} className="flv-tagpicker__hl" transition={spring} />
                      )}
                      <span className="flv-tagpicker__lead">
                        {row.kind === 'create'
                          ? (isCreating
                            ? <BrailleLoader size={13} label={zh ? '正在创建' : 'Creating'} />
                            : <Plus size={13} />)
                          : <i className="flv-tagpicker__dot" style={{ background: tagColorVar(row.name) }} />}
                      </span>
                      <span className="flv-tagpicker__label">
                        {row.kind === 'create'
                          ? (isCreating
                            ? <>{zh ? '正在创建' : 'Creating'} <b>{row.name}</b>…</>
                            : <>{zh ? '新建' : 'Create'} <b>“{row.name}”</b></>)
                          : row.name}
                      </span>
                      {row.kind === 'create' && !isCreating && (
                        <i className="flv-tagpicker__dot flv-tagpicker__dot--ghost" style={{ background: tagColorVar(row.name) }} aria-hidden />
                      )}
                      {selected && <Check size={14} className="flv-tagpicker__check" />}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
