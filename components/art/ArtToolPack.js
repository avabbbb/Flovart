import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Zap, Mountain, Spline, PenLine, Box, PersonStanding, Scissors, } from 'lucide-react';
import { ART_TOOLS } from './artTools';
const ICONS = {
    Sparkles, Zap, Mountain, Spline, PenLine, Box, PersonStanding, Scissors,
};
const CATEGORY_LABEL = {
    stylize: '风格化',
    extract: '特征提取',
    cutout: '抠图',
};
export const ArtToolPack = ({ theme, isMinimized, onToggleMinimize, outerGap, defaultWidth, minWidth, widthCap, onWidthChange, onToolDrop, onOpenTool, }) => {
    const [panelWidth, setPanelWidth] = useState(() => {
        const saved = localStorage.getItem('artToolPackWidth');
        return saved ? parseInt(saved, 10) : defaultWidth;
    });
    const [isResizing, setIsResizing] = useState(false);
    const [draggingTool, setDraggingTool] = useState(null);
    const resizeStartX = useRef(0);
    const resizeStartWidth = useRef(0);
    useEffect(() => {
        if (!onWidthChange)
            return;
        onWidthChange(panelWidth);
    }, [panelWidth, onWidthChange]);
    useEffect(() => {
        localStorage.setItem('artToolPackWidth', String(panelWidth));
    }, [panelWidth]);
    useEffect(() => {
        if (!isResizing)
            return;
        const onMove = (e) => {
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
    const startResize = (e) => {
        e.preventDefault();
        resizeStartX.current = e.clientX;
        resizeStartWidth.current = panelWidth;
        setIsResizing(true);
    };
    const onToolDragStart = (e, toolId) => {
        setDraggingTool(toolId);
        e.dataTransfer.setData('application/x-art-tool', toolId);
        e.dataTransfer.effectAllowed = 'copy';
    };
    const onToolDragEnd = () => setDraggingTool(null);
    const grouped = useMemo(() => {
        const map = { stylize: [], extract: [], cutout: [] };
        for (const tool of ART_TOOLS)
            map[tool.category].push(tool);
        return map;
    }, []);
    return (_jsxs("div", { style: {
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
        }, className: "isl-panel compact-right-panel theme-aware z-[30] flex flex-col overflow-hidden", children: [_jsx("div", { className: "absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors hover:bg-[#19c8b9]/40", onPointerDown: startResize }), _jsxs("div", { className: "flex items-center justify-between border-b px-3 py-2.5", style: { borderColor: 'var(--isl-border)' }, children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "inline-block h-1.5 w-1.5 rounded-full", style: { background: 'var(--isl-mint)' } }), _jsx("span", { className: "text-[13px] font-semibold", style: { color: 'var(--isl-ink)' }, children: "\u5DE5\u5177\u80CC\u5305" })] }), _jsx("button", { type: "button", onClick: onToggleMinimize, className: "isl-icon-btn shrink-0", style: { width: 26, height: 26 }, title: "\u6536\u8D77", "aria-label": "\u6536\u8D77\u9762\u677F", children: _jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.4", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("polyline", { points: "9 18 15 12 9 6" }) }) })] }), _jsx("div", { className: "flex-1 overflow-y-auto px-3 py-3", "data-art-tool-pack": true, children: Object.keys(grouped).map(cat => (_jsxs("div", { className: "mb-4", children: [_jsx("div", { className: "mb-2 text-[11px] font-semibold uppercase tracking-wider", style: { color: 'var(--isl-ink-soft)' }, children: CATEGORY_LABEL[cat] }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: grouped[cat].map(tool => {
                                const Icon = ICONS[tool.icon] ?? Sparkles;
                                return (_jsxs("button", { type: "button", draggable: true, onDragStart: e => onToolDragStart(e, tool.id), onDragEnd: onToolDragEnd, onClick: () => onOpenTool(tool.id), className: `group isl-elastic relative flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-all hover:border-[#19c8b9]/60 ${draggingTool === tool.id ? 'opacity-50' : ''}`, style: { borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }, title: tool.description, children: [_jsx(Icon, { size: 18, style: { color: 'var(--isl-mint-deep)' } }), _jsx("div", { className: "text-[12px] font-semibold leading-tight", style: { color: 'var(--isl-ink)' }, children: tool.label }), _jsx("div", { className: "text-[10px] leading-tight", style: { color: 'var(--isl-ink-soft)' }, children: tool.description }), _jsx("span", { className: "absolute right-1.5 top-1.5 text-[9px] opacity-0 transition-opacity group-hover:opacity-60", style: { color: 'var(--isl-ink-soft)' }, children: "\u62D6\u62FD \u2192" })] }, tool.id));
                            }) })] }, cat))) })] }));
};
