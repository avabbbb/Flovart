import React from 'react';

interface LayerToggleButtonProps {
    isLayerMinimized: boolean;
    onToggle: () => void;
    toolbarLeft: number; // 工具栏的 left 位置（px）
}

export const LayerToggleButton: React.FC<LayerToggleButtonProps> = ({
    isLayerMinimized,
    onToggle,
    toolbarLeft
}) => {
    return (
        <button
            onClick={onToggle}
            style={{
                left: `${toolbarLeft}px`,
                transition: 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
            className="isl-icon-btn theme-aware fixed bottom-4 z-50 flex h-10 w-10 items-center justify-center"
            title={isLayerMinimized ? '展开图层面板' : '收起图层面板'}
            aria-label={isLayerMinimized ? '展开图层面板' : '收起图层面板'}
        >
            {isLayerMinimized ? (
                // 展开图标
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                    <polyline points="2 17 12 22 22 17"></polyline>
                    <polyline points="2 12 12 17 22 12"></polyline>
                </svg>
            ) : (
                // 收起图标
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                </svg>
            )}
        </button>
    );
};

