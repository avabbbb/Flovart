import React, { useCallback, useRef, useState } from 'react';

interface ABCompareOverlayProps {
    imageA: { src: string; label: string };
    imageB: { src: string; label: string };
    onClose: () => void;
    theme: 'light' | 'dark';
}

/**
 * Full-screen A/B compare overlay with a draggable vertical slider.
 * Left side = imageA, Right side = imageB.
 */
export const ABCompareOverlay: React.FC<ABCompareOverlayProps> = ({ imageA, imageB, onClose, theme }) => {
    const [split, setSplit] = useState(50); // percentage 0-100
    const containerRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);
    const isDark = theme === 'dark';

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        setSplit((x / rect.width) * 100);
    }, []);

    const handlePointerUp = useCallback(() => {
        dragging.current = false;
    }, []);

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
             onClick={onClose}>
            {/* Header */}
            <div className="isl-shell theme-aware absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-4 px-5 py-2.5 z-10"
                 onClick={e => e.stopPropagation()}>
                <span className="text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>A/B 对比</span>
                <div className="h-5 w-px" style={{ background: 'var(--isl-border)' }} />
                <span className="text-xs font-bold" style={{ color: 'var(--isl-mint-deep)' }}>← {imageA.label}</span>
                <span className="text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>|</span>
                <span className="text-xs font-bold" style={{ color: 'var(--isl-coral-deep)' }}>{imageB.label} →</span>
                <div className="h-5 w-px" style={{ background: 'var(--isl-border)' }} />
                <button onClick={onClose} className="isl-chip h-auto px-3 py-1 text-xs">
                    关闭
                </button>
            </div>

            {/* Compare viewport */}
            <div ref={containerRef}
                 className="relative w-[80vw] h-[80vh] overflow-hidden rounded-xl shadow-2xl select-none"
                 onClick={e => e.stopPropagation()}
                 onPointerMove={handlePointerMove}
                 onPointerUp={handlePointerUp}>

                {/* Image B (full, behind) */}
                <img src={imageB.src} alt={imageB.label}
                     className="absolute inset-0 w-full h-full object-contain"
                     style={{ background: isDark ? '#0D1117' : '#F3F4F6' }}
                     draggable={false} />

                {/* Image A (clipped left portion) */}
                <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                    <img src={imageA.src} alt={imageA.label}
                         className="absolute inset-0 w-full h-full object-contain"
                         style={{ background: isDark ? '#0D1117' : '#F3F4F6' }}
                         draggable={false} />
                </div>

                {/* Slider handle */}
                <div className="absolute top-0 bottom-0" style={{ left: `${split}%`, transform: 'translateX(-50%)' }}>
                    <div className="w-0.5 h-full bg-white/80 shadow-lg" />
                    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white shadow-xl flex items-center justify-center cursor-ew-resize"
                         onPointerDown={handlePointerDown}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M8 4l-4 8 4 8" />
                            <path d="M16 4l4 8-4 8" />
                        </svg>
                    </div>
                </div>

                {/* Labels */}
                <div className="absolute bottom-3 left-3 px-2 py-1 rounded-lg bg-blue-500/80 text-white text-xs font-medium backdrop-blur-sm">
                    A: {imageA.label}
                </div>
                <div className="absolute bottom-3 right-3 px-2 py-1 rounded-lg bg-green-500/80 text-white text-xs font-medium backdrop-blur-sm">
                    B: {imageB.label}
                </div>
            </div>
        </div>
    );
};

export default ABCompareOverlay;
