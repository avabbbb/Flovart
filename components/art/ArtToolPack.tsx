import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Zap, Mountain, Spline, PenLine, Box, PersonStanding, Scissors,
  type LucideIcon,
} from 'lucide-react';
import { ART_TOOLS, type ArtToolDef, type ArtToolId } from './artTools';

const ICONS: Record<string, LucideIcon> = {
  Sparkles, Zap, Mountain, Spline, PenLine, Box, PersonStanding, Scissors,
};

export interface ArtToolPackProps {
  theme: 'light' | 'dark';
  isMinimized: boolean;
  onToggleMinimize: () => void;
  outerGap: number;
  defaultWidth: number;
  minWidth: number;
  widthCap: number;
  onWidthChange?: (width: number) => void;
  onToolDrop: (toolId: ArtToolId, dropPoint: { x: number; y: number }) => void;
  onOpenTool: (toolId: ArtToolId) => void;
}

const CATEGORY_LABEL: Record<ArtToolDef['category'], string> = {
  stylize: '风格化',
  extract: '特征提取',
  cutout: '抠图',
};

export const ArtToolPack: React.FC<ArtToolPackProps> = ({
  theme,
  isMinimized,
  onToggleMinimize,
  outerGap,
  defaultWidth,
  minWidth,
  widthCap,
  onWidthChange,
  onToolDrop,
  onOpenTool,
}) => {
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('artToolPackWidth');
    return saved ? parseInt(saved, 10) : defaultWidth;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [draggingTool, setDraggingTool] = useState<ArtToolId | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  useEffect(() => {
    if (!onWidthChange) return;
    onWidthChange(panelWidth);
  }, [panelWidth, onWidthChange]);

  useEffect(() => {
    localStorage.setItem('artToolPackWidth', String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: PointerEvent) => {
      const delta = resizeStartX.current - e.clientX;
      const next = Math.max(minWidth, Math.min(widthCap, resizeStartWidth.current + delta));
      setPanelWidth(next);
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isResizing, minWidth, widthCap]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = panelWidth;
    setIsResizing(true);
  };

  const onToolDragStart = (e: React.DragEvent, toolId: ArtToolId) => {
    setDraggingTool(toolId);
    e.dataTransfer.setData('application/x-art-tool', toolId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onToolDragEnd = () => setDraggingTool(null);

  const grouped = useMemo(() => {
    const map: Record<string, ArtToolDef[]> = { stylize: [], extract: [], cutout: [] };
    for (const tool of ART_TOOLS) map[tool.category].push(tool);
    return map;
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: `${outerGap}px`,
        right: `${outerGap}px`,
        top: `${outerGap + 48}px`,
        width: `${panelWidth}px`,
        transform: isMinimized ? 'translateX(18px) scale(0.96)' : 'translateX(0) scale(1)',
        transformOrigin: 'right center',
        opacity: isMinimized ? 0 : 1,
        transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease-out, width 0.25s ease-out',
        pointerEvents: isMinimized ? 'none' : 'auto',
      }}
      className="isl-panel compact-right-panel theme-aware z-[30] flex flex-col overflow-hidden"
    >
      <div
        className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors hover:bg-[#19c8b9]/40"
        onPointerDown={startResize}
      />
      <div className="flex items-center justify-between border-b px-3 py-2.5" style={{ borderColor: 'var(--isl-border)' }}>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--isl-mint)' }} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--isl-ink)' }}>工具背包</span>
        </div>
        <button
          type="button"
          onClick={onToggleMinimize}
          className="isl-icon-btn shrink-0"
          style={{ width: 26, height: 26 }}
          title="收起"
          aria-label="收起面板"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3" data-art-tool-pack>
        {(Object.keys(grouped) as ArtToolDef['category'][]).map(cat => (
          <div key={cat} className="mb-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--isl-ink-soft)' }}>
              {CATEGORY_LABEL[cat]}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {grouped[cat].map(tool => {
                const Icon = ICONS[tool.icon] ?? Sparkles;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    draggable
                    onDragStart={e => onToolDragStart(e, tool.id)}
                    onDragEnd={onToolDragEnd}
                    onClick={() => onOpenTool(tool.id)}
                    className={`group isl-elastic relative flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-all hover:border-[#19c8b9]/60 ${draggingTool === tool.id ? 'opacity-50' : ''}`}
                    style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }}
                    title={tool.description}
                  >
                    <Icon size={18} style={{ color: 'var(--isl-mint-deep)' }} />
                    <div className="text-[12px] font-semibold leading-tight" style={{ color: 'var(--isl-ink)' }}>
                      {tool.label}
                    </div>
                    <div className="text-[10px] leading-tight" style={{ color: 'var(--isl-ink-soft)' }}>
                      {tool.description}
                    </div>
                    <span className="absolute right-1.5 top-1.5 text-[9px] opacity-0 transition-opacity group-hover:opacity-60" style={{ color: 'var(--isl-ink-soft)' }}>
                      拖拽 →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
