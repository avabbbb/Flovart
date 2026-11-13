import { History, MessageSquare, PanelRightClose, PanelRightOpen, SlidersHorizontal } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { DrawerChromeContext } from './drawerChrome';

export interface StudioDrawerTab {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export interface StudioRightDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outerGap: number;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  tabs: StudioDrawerTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  flush?: boolean;
  /**
   * Docked = in-flow panel that reflows the workspace beside it instead of an
   * absolute overlay that can cover the selected node. The caller owns the
   * flex row; the aside switches from `absolute` to `relative` positioning.
   */
  docked?: boolean;
  // 这些标签页由子级顶栏渲染标签与收起按钮（DrawerChromeContext），抽屉不再单独占一行。
  inlineChromeTabs?: string[];
  children: React.ReactNode;
}

/** 拖过最小宽度多少像素后，松手即收起为图标。 */
const SNAP_COLLAPSE_PX = 72;

export const StudioRightDrawer: React.FC<StudioRightDrawerProps> = ({
  open,
  onOpenChange,
  outerGap,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  tabs,
  activeTab,
  onTabChange,
  flush = false,
  docked = false,
  inlineChromeTabs,
  children,
}) => {
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const startRef = useRef({ x: 0, width });

  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => {
      const raw = startRef.current.width + startRef.current.x - event.clientX;
      const next = Math.min(maxWidth, Math.max(minWidth, raw));
      // 拖拽期间直接操作 DOM，避免每帧触发 Workflow 巨型画布重渲染；松手时一次性 commit
      const aside = asideRef.current;
      if (aside) {
        // 拖到最小宽度以下一段距离 → 进入“吸附收起”预览，松手后收成右上角图标（同 macOS 侧栏）
        if (raw < minWidth - SNAP_COLLAPSE_PX) aside.dataset.snap = 'collapse';
        else delete aside.dataset.snap;
        aside.style.setProperty('--drawer-width', `${next}px`);
        aside.style.width = `${next}px`;
      }
    };
    const stop = () => {
      setResizing(false);
      const aside = asideRef.current;
      if (aside?.dataset.snap === 'collapse') {
        delete aside.dataset.snap;
        onWidthChange(minWidth);
        onOpenChange(false);
        return;
      }
      const widthNow = asideRef.current ? parseFloat(asideRef.current.style.width) : Number.NaN;
      if (Number.isFinite(widthNow)) onWidthChange(Math.min(maxWidth, Math.max(minWidth, widthNow)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, [maxWidth, minWidth, onOpenChange, onWidthChange, resizing]);

  const chromeInline = Boolean(inlineChromeTabs?.includes(activeTab));
  const chrome = chromeInline ? { tabs, activeTab, onTabChange, onCollapse: () => onOpenChange(false) } : null;
  const safeWidth = Math.min(maxWidth, Math.max(minWidth, Number.isFinite(width) ? width : minWidth));
  const drawerStyle: React.CSSProperties = {
    ['--drawer-width' as string]: `${safeWidth}px`,
    ['--drawer-min-width' as string]: `${minWidth}px`,
    ['--drawer-max-width' as string]: `${maxWidth}px`,
    ['--drawer-outer-gap' as string]: `${flush ? 0 : outerGap}px`,
    // Keep collapsed content out of hit-testing/layout even before stylesheets
    // hydrate (tests, cold loads, embedded hosts). CSS owns sizing; this only
    // owns the binary visibility state.
    display: open ? undefined : 'none',
    pointerEvents: open ? 'auto' : 'none',
    ...(docked
      ? {
        position: 'relative',
        alignSelf: 'stretch',
      }
      : {
        top: flush ? 0 : outerGap,
        right: flush ? 0 : outerGap,
        bottom: flush ? 0 : outerGap,
      }),
  };

  return (
    <>
      <button
        type="button"
        className="isl-icon-btn theme-aware absolute h-10 w-10"
        style={{ right: outerGap, top: outerGap, zIndex: 80, opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto' }}
        onClick={() => onOpenChange(true)}
        title="打开右侧面板"
        aria-label="打开右侧面板"
      >
        <PanelRightOpen size={18} />
      </button>

      <aside
        ref={asideRef}
        className={`isl-panel compact-right-panel theme-aware ${docked ? 'relative' : 'absolute'} z-[78] flex min-h-0 flex-col overflow-hidden ${resizing ? 'is-resizing select-none' : 'transition-[transform,opacity] duration-200'} ${flush ? 'compact-right-panel--flush' : ''}`}
        data-open={open ? 'true' : 'false'}
        data-docked={docked ? 'true' : 'false'}
        style={drawerStyle}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          className="absolute inset-y-0 left-0 z-[85] w-2 -translate-x-1/2 cursor-ew-resize"
          onPointerDown={event => {
            if (event.button !== 0) return;
            startRef.current = { x: event.clientX, width };
            setResizing(true);
            event.preventDefault();
          }}
        />
        {!chromeInline && (
        <div className={flush ? 'compact-right-panel__quicktabs compact-right-panel__quicktabs--icons' : 'flex shrink-0 items-center gap-1.5 border-b px-2 py-2'} style={{ borderColor: 'var(--isl-border)' }}>
          <div className={`isl-tabbar isl-tabbar--ac min-w-0 ${flush ? 'compact-right-panel__quicktabs-icons' : 'flex-1'}`}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`isl-tab min-w-0 flex-1 justify-center gap-1.5 ${activeTab === tab.id ? 'isl-tab--active' : ''}`}
                onClick={() => onTabChange(tab.id)}
                aria-label={tab.label}
                title={tab.label}
              >
                {tab.icon || (tab.id === 'history' ? <History size={15} /> : tab.id === 'context' ? <SlidersHorizontal size={15} /> : <MessageSquare size={15} />)}
                <span className={flush ? 'compact-right-panel__quicktab-label' : 'truncate'}>{tab.label}</span>
              </button>
            ))}
          </div>
          <button type="button" className="isl-icon-btn isl-tabbar--ac-collapse h-8 w-8 shrink-0" onClick={() => onOpenChange(false)} title="收起右侧面板" aria-label="收起右侧面板">
            <PanelRightClose size={16} />
          </button>
        </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden"><DrawerChromeContext.Provider value={chrome}>{children}</DrawerChromeContext.Provider></div>
      </aside>
    </>
  );
};
