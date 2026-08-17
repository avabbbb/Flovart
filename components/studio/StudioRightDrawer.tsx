import { History, MessageSquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

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
  children: React.ReactNode;
}

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
  children,
}) => {
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const startRef = useRef({ x: 0, width });

  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => {
      const next = Math.min(maxWidth, Math.max(minWidth, startRef.current.width + startRef.current.x - event.clientX));
      // 拖拽期间直接操作 DOM，避免每帧触发 Workflow 巨型画布重渲染；松手时一次性 commit
      if (asideRef.current) asideRef.current.style.width = `${next}px`;
    };
    const stop = () => {
      setResizing(false);
      const widthNow = asideRef.current ? parseFloat(asideRef.current.style.width) : Number.NaN;
      if (Number.isFinite(widthNow)) onWidthChange(Math.min(maxWidth, Math.max(minWidth, widthNow)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, [maxWidth, minWidth, onWidthChange, resizing]);

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
        className={`isl-panel compact-right-panel theme-aware absolute z-[78] flex min-h-0 flex-col overflow-hidden transition-[transform,opacity] duration-200 ${flush ? 'compact-right-panel--flush' : ''}`}
        style={{
          top: flush ? 0 : outerGap,
          right: flush ? 0 : outerGap,
          bottom: flush ? 0 : outerGap,
          width: `min(${width}px, calc(100% - ${(flush ? 0 : outerGap * 2)}px))`,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
        }}
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
        <div className={flush ? 'compact-right-panel__quicktabs' : 'flex shrink-0 items-center gap-1.5 border-b px-2 py-2'} style={{ borderColor: 'var(--isl-border)' }}>
          <div className="isl-tabbar isl-tabbar--ac min-w-0 flex-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`isl-tab min-w-0 flex-1 justify-center gap-1.5 ${activeTab === tab.id ? 'isl-tab--active' : ''}`}
                onClick={() => onTabChange(tab.id)}
                title={tab.label}
              >
                {tab.icon || (tab.id === 'history' ? <History size={15} /> : <MessageSquare size={15} />)}
                <span className="truncate">{tab.label}</span>
              </button>
            ))}
          </div>
          <button type="button" className="isl-icon-btn isl-tabbar--ac-collapse h-8 w-8 shrink-0" onClick={() => onOpenChange(false)} title="收起右侧面板" aria-label="收起右侧面板">
            <PanelRightClose size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </aside>
    </>
  );
};
