import { Copy, CopyPlus, Library, Pencil, Play, Star, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

export type WorkflowContextMenuState =
  | { type: 'node'; id: string; x: number; y: number }
  | { type: 'connection'; id: string; x: number; y: number };

export function WorkflowContextMenu({ state, language = 'zho', onCopy, onDuplicate, onSaveMedia, onDelete, onRun, onSetPrimary, onRename, onClose }: {
  state: WorkflowContextMenuState;
  language?: 'en' | 'zho';
  onCopy: () => void;
  onDuplicate?: () => void;
  onSaveMedia?: () => void;
  onDelete: () => void;
  onRun: () => void;
  onSetPrimary?: () => void;
  onRename?: () => void;
  onClose: () => void;
}) {
  const copy = language === 'zho'
    ? { node: '节点菜单', connection: '连接菜单', copy: '复制', duplicate: '创建副本', save: '保存到我的素材', run: '运行节点', primary: '设为主图', rename: '重命名', delete: '删除' }
    : { node: 'Node menu', connection: 'Connection menu', copy: 'Copy', duplicate: 'Duplicate', save: 'Save to media library', run: 'Run node', primary: 'Set as primary', rename: 'Rename', delete: 'Delete' };
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y, maxHeight: 480, ready: false });

  useLayoutEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = menuRef.current;
    if (!menu) return;

    const measure = () => {
      const rect = menu.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width || document.documentElement.clientWidth;
      const height = viewport?.height || document.documentElement.clientHeight;
      const leftInset = viewport?.offsetLeft || 0;
      const topInset = viewport?.offsetTop || 0;
      const edge = 8;
      const menuWidth = rect.width || Math.min(180, width - edge * 2);
      const menuHeight = rect.height || 160;
      const maxHeight = Math.max(96, height - edge * 2);
      const left = Math.max(leftInset + edge, Math.min(state.x, leftInset + width - menuWidth - edge));
      const top = Math.max(topInset + edge, Math.min(state.y, topInset + height - Math.min(menuHeight, maxHeight) - edge));
      setPosition({ left, top, maxHeight, ready: true });
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(menu);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [state.x, state.y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = activeIndex < 0 ? 0 : (activeIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={state.type === 'node' ? copy.node : copy.connection}
      data-workflow-overlay
      data-testid="workflow-context-menu"
      className="workflow-context-menu"
      style={{
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight,
        visibility: position.ready ? 'visible' : 'hidden',
        '--wf-border': 'var(--border-color)',
        '--wf-strong': 'var(--panel-strong)',
        '--wf-muted': 'var(--text-muted)',
        '--wf-text': 'var(--text-primary)',
      } as CSSProperties}
      onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {state.type === 'node' && <button type="button" role="menuitem" onClick={onCopy}><Copy size={14} />{copy.copy}</button>}
      {state.type === 'node' && onDuplicate && <button type="button" role="menuitem" onClick={onDuplicate}><CopyPlus size={14} />{copy.duplicate}</button>}
      {state.type === 'node' && onSaveMedia && <button type="button" role="menuitem" onClick={onSaveMedia}><Library size={14} />{copy.save}</button>}
      {state.type === 'node' && <button type="button" role="menuitem" onClick={onRun}><Play size={14} />{copy.run}</button>}
      {state.type === 'node' && onSetPrimary && <button type="button" role="menuitem" onClick={onSetPrimary}><Star size={14} />{copy.primary}</button>}
      {state.type === 'node' && onRename && <button type="button" role="menuitem" onClick={onRename}><Pencil size={14} />{copy.rename}</button>}
      <button type="button" role="menuitem" className="is-danger" onClick={onDelete}><Trash2 size={14} />{copy.delete}</button>
    </div>,
    document.body,
  );
}
