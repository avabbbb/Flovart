import React, { type ReactNode } from 'react';
import type { Element, ImageElement, VideoElement, ShapeElement, TextElement, ArrowElement, LineElement, ImageFilters } from '../types';
import { ImageFilterPanel } from './ImageFilterPanel';
import type { Rect } from '../utils/canvasHelpers';

export interface ElementToolbarProps {
    selectedElementIds: string[];
    singleSelectedElement: Element | null | undefined;
    elements: Element[];
    zoom: number;
    resolvedTheme: string;
    isLoading: boolean;
    language: 'en' | 'zho';
    filterPanelElementId: string | null;
    outpaintMenuId: string | null;
    maskEditingId: string | null;
    reversePromptLoading: boolean;
    t: (key: string, ...args: any[]) => any;
    getSelectionBounds: (ids: string[]) => Rect;
    getElementBounds: (el: Element, elements: Element[]) => Rect;
    handleAlignSelection: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
    handleGroupSelection: () => void;
    handleExportSelection: () => void;
    handleCopyElement: (el: Element) => void;
    handleDownloadImage: (el: ImageElement) => void;
    handleDeleteElement: (id: string) => void;
    handlePropertyChange: (id: string, updates: Partial<Element>) => void;
    handleStartCrop: (el: ImageElement) => void;
    handleReversePrompt: (href: string, mimeType: string, w?: number, h?: number) => void;
    cancelReversePrompt: () => void;
    handleSplitImageLayers: (el: Element) => void;
    handleUpscaleImage: (el: Element) => void;
    handleRemoveImageBackground: (el: Element) => void;
    handleOutpaint: (el: Element, dir: 'all' | 'up' | 'down' | 'left' | 'right') => void;
    setFilterPanelElementId: (id: string | null) => void;
    setOutpaintMenuId: (id: string | null) => void;
    setAddAssetModal: (modal: { open: boolean; dataUrl: string; mimeType: string; width: number; height: number }) => void;
    startMaskEditing: (elementId: string) => void;
    relationFocusCount?: number;
    isRelationFocusActive?: boolean;
    onToggleRelationFocus?: () => void;
}

export function ElementToolbarShell({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
    const stop = (event: React.SyntheticEvent) => event.stopPropagation();
    return (
        <div
            data-workflow-overlay
            data-testid={testId}
            className={`isl-shell isl-pop-in flex items-center justify-start gap-2 overflow-x-auto p-1.5 ${className}`}
            onMouseDown={stop}
            onPointerDown={stop}
            onWheel={stop}
        >
            {children}
        </div>
    );
}

export interface ElementToolbarAction {
    key: string;
    label: string;
    icon: ReactNode;
    onClick?: () => void;
    href?: string;
    download?: string;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
}

export function ElementToolbarActions({ actions }: { actions: Array<ElementToolbarAction | null | false | undefined> }) {
    return <>{actions.filter((action): action is ElementToolbarAction => Boolean(action)).map(action => action.href ? (
        <a key={action.key} className="isl-icon-btn h-9 w-9" aria-label={action.label} title={action.label} href={action.href} download={action.download}>{action.icon}</a>
    ) : (
        <button key={action.key} type="button" disabled={action.disabled} className={`isl-icon-btn h-9 w-9 disabled:opacity-40 ${action.active ? 'isl-icon-btn--active' : ''}`} aria-label={action.label} title={action.label} style={action.danger ? { color: 'var(--isl-coral-deep)' } : undefined} onClick={action.onClick}>{action.icon}</button>
    ))}</>;
}

export function ElementToolbar(props: ElementToolbarProps) {
    const {
        selectedElementIds, singleSelectedElement, elements, zoom, isLoading, language,
        filterPanelElementId, outpaintMenuId, maskEditingId, reversePromptLoading,
        t, getSelectionBounds, getElementBounds,
        handleAlignSelection, handleGroupSelection, handleExportSelection, handleCopyElement, handleDownloadImage, handleDeleteElement,
        handlePropertyChange, handleStartCrop, handleReversePrompt, cancelReversePrompt,
        handleSplitImageLayers, handleUpscaleImage, handleRemoveImageBackground,
        handleOutpaint, setFilterPanelElementId, setOutpaintMenuId, setAddAssetModal, startMaskEditing,
        relationFocusCount = 0, isRelationFocusActive = false, onToggleRelationFocus,
    } = props;

    if (selectedElementIds.length > 1) {
        const bounds = getSelectionBounds(selectedElementIds);
        const toolbarScreenWidth = 378;
        const toolbarScreenHeight = 56;
        const hasSelectedMedia = elements.some(element => selectedElementIds.includes(element.id) && (element.type === 'image' || element.type === 'video'));

        const toolbarCanvasWidth = toolbarScreenWidth / zoom;
        const toolbarCanvasHeight = toolbarScreenHeight / zoom;

        const x = bounds.x + bounds.width / 2 - (toolbarCanvasWidth / 2);
        const y = bounds.y - toolbarCanvasHeight - (10 / zoom);

        const toolbar = <div
            style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'top left', width: `${toolbarScreenWidth}px`, height: `${toolbarScreenHeight}px` }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="isl-shell isl-pop-in flex items-center justify-start gap-2 overflow-x-auto p-1.5">
                <button title={t('contextMenu.alignment.alignLeft')} onClick={() => handleAlignSelection('left')} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="21" x2="4" y2="3"></line><rect x="8" y="6" width="8" height="4" rx="1"></rect><rect x="8" y="14" width="12" height="4" rx="1"></rect></svg></button>
                <button title={t('contextMenu.alignment.alignCenter')} onClick={() => handleAlignSelection('center')} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="21" x2="12" y2="3" strokeDasharray="2 2"></line><rect x="7" y="6" width="10" height="4" rx="1"></rect><rect x="4" y="14" width="16" height="4" rx="1"></rect></svg></button>
                <button title={t('contextMenu.alignment.alignRight')} onClick={() => handleAlignSelection('right')} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="20" y1="21" x2="20" y2="3"></line><rect x="12" y="6" width="8" height="4" rx="1"></rect><rect x="8" y="14" width="12" height="4" rx="1"></rect></svg></button>
                <div className="h-6 w-px" style={{ background: 'var(--isl-border)' }}></div>
                <button title={t('contextMenu.alignment.alignTop')} onClick={() => handleAlignSelection('top')} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="4" x2="21" y2="4"></line><rect x="6" y="8" width="4" height="8" rx="1"></rect><rect x="14" y="8" width="4" height="12" rx="1"></rect></svg></button>
                <button title={t('contextMenu.alignment.alignMiddle')} onClick={() => handleAlignSelection('middle')} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2 2"></line><rect x="6" y="7" width="4" height="10" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg></button>
                <button title={t('contextMenu.alignment.alignBottom')} onClick={() => handleAlignSelection('bottom')} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="20" x2="21" y2="20"></line><rect x="6" y="12" width="4" height="8" rx="1"></rect><rect x="14" y="8" width="4" height="12" rx="1"></rect></svg></button>
                <div className="h-6 w-px" style={{ background: 'var(--isl-border)' }}></div>
                {hasSelectedMedia && <button title="批量导出所选媒体" aria-label="批量导出所选媒体" onClick={handleExportSelection} className="isl-icon-btn h-9 w-9">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
                </button>}
                <button
                    title={t('contextMenu.group')}
                    aria-label="Group selected canvas layers"
                    onClick={handleGroupSelection}
                    className="isl-icon-btn h-9 w-9"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="5" y="5" width="7" height="7" rx="1.5" />
                        <rect x="12" y="12" width="7" height="7" rx="1.5" />
                        <path d="M8.5 12v2.5A1.5 1.5 0 0 0 10 16h2" />
                    </svg>
                </button>
            </div>
        </div>;
        return (
            <foreignObject x={x} y={y} width={toolbarCanvasWidth} height={toolbarCanvasHeight} style={{ overflow: 'visible' }}>
                {toolbar}
            </foreignObject>
        );
    }

    if (!singleSelectedElement) return null;

    const element = singleSelectedElement;
    const bounds = getElementBounds(element, elements);
    let toolbarScreenWidth = 160;
    if (element.type === 'shape') {
        toolbarScreenWidth = 300;
    }
    if (element.type === 'text') toolbarScreenWidth = 220;
    if (element.type === 'arrow' || element.type === 'line') toolbarScreenWidth = 220;
    if (element.type === 'image') toolbarScreenWidth = relationFocusCount > 0 ? 670 : 620;
    if (element.type === 'video') toolbarScreenWidth = relationFocusCount > 0 ? 220 : 160;
    if (element.type === 'group') toolbarScreenWidth = 80;

    const toolbarScreenHeight = 56;

    const toolbarCanvasWidth = toolbarScreenWidth / zoom;
    const toolbarCanvasHeight = toolbarScreenHeight / zoom;

    const x = bounds.x + bounds.width / 2 - (toolbarCanvasWidth / 2);
    const y = bounds.y - toolbarCanvasHeight - (10 / zoom);

    const toolbar = <div
        style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'top left', width: `${toolbarScreenWidth}px`, height: `${toolbarScreenHeight}px` }}
        onMouseDown={(e) => e.stopPropagation()}
    >
        <div className="isl-shell isl-pop-in flex items-center justify-start gap-2 overflow-x-auto p-1.5">
            <button title={t('contextMenu.copy')} onClick={() => handleCopyElement(element)} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
            {(element.type === 'image' || element.type === 'video') && relationFocusCount > 0 && onToggleRelationFocus && (
                <button
                    title={isRelationFocusActive ? '收起关联节点高亮' : '高亮和当前媒体有关的画布节点'}
                    aria-label={isRelationFocusActive ? '收起关联节点高亮' : '高亮关联节点'}
                    onClick={onToggleRelationFocus}
                    className={`isl-icon-btn h-9 w-9 ${isRelationFocusActive ? 'isl-icon-btn--active' : ''}`}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="6" cy="12" r="3" />
                        <circle cx="18" cy="6" r="3" />
                        <circle cx="18" cy="18" r="3" />
                        <path d="M8.7 10.8 15.3 7.2" />
                        <path d="M8.7 13.2 15.3 16.8" />
                    </svg>
                </button>
            )}
            {element.type === 'image' && <button title={t('contextMenu.download')} onClick={() => handleDownloadImage(element as ImageElement)} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>}
            {element.type === 'image' && <button title="Add to asset library" onClick={async () => {
                    const { href, mimeType, width, height } = element as ImageElement;
                    setAddAssetModal({ open: true, dataUrl: href, mimeType, width, height });
                }} className="isl-icon-btn h-9 w-9">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
                </button>}
            {element.type === 'image' && <button title="Split into layers with image tool provider" onClick={() => handleSplitImageLayers(element)} className="isl-icon-btn h-9 w-9 disabled:opacity-40" disabled={isLoading}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"></rect><rect x="13" y="3" width="8" height="8" rx="1"></rect><rect x="3" y="13" width="8" height="8" rx="1"></rect><path d="M13 17h8"></path><path d="M17 13v8"></path></svg>
                </button>}
            {element.type === 'image' && <button title="Image tool: upscale x2" onClick={() => handleUpscaleImage(element)} className="isl-icon-btn h-9 w-9 disabled:opacity-40" disabled={isLoading}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                </button>}
            {element.type === 'image' && <button title="Image tool: remove background" onClick={() => handleRemoveImageBackground(element)} className="isl-icon-btn h-9 w-9 disabled:opacity-40" disabled={isLoading}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18"></path><path d="M20 12a8 8 0 0 1-11.31 7.31"></path><path d="M4 12a8 8 0 0 1 11.31-7.31"></path></svg>
                </button>}
            {element.type === 'video' && <a title={t('contextMenu.download')} href={(element as VideoElement).href} download={`video-${element.id}.mp4`} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a>}
            {element.type === 'image' && <button title={t('contextMenu.crop')} onClick={() => handleStartCrop(element as ImageElement)} className="isl-icon-btn h-9 w-9"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path></svg></button>}
            {element.type === 'image' && <button title="调色 / Filters" onClick={() => setFilterPanelElementId(filterPanelElementId === element.id ? null : element.id)} className={`isl-icon-btn h-9 w-9 ${filterPanelElementId === element.id ? 'isl-icon-btn--active' : ''}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="2.5"></circle><circle cx="17.5" cy="10.5" r="2.5"></circle><circle cx="8.5" cy="7.5" r="2.5"></circle><circle cx="6.5" cy="12.5" r="2.5"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>
                </button>}
            {element.type === 'image' && (
                <div style={{ position: 'relative' }}>
                    <button title="AI 扩图 / Outpaint" onClick={() => setOutpaintMenuId(outpaintMenuId === element.id ? null : element.id)} className={`isl-icon-btn h-9 w-9 disabled:opacity-40 ${outpaintMenuId === element.id ? 'isl-icon-btn--active' : ''}`} disabled={isLoading}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                    </button>
                    {outpaintMenuId === element.id && (
                        <div className="isl-pop" style={{
                            position: 'absolute',
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            padding: 8,
                            marginTop: 8,
                            zIndex: 100,
                            whiteSpace: 'nowrap',
                            minWidth: 140,
                        }}>
                            {([
                                { dir: 'all' as const, label: '↔ 全方向扩展', icon: '🔄' },
                                { dir: 'up' as const, label: '⬆ 向上扩展', icon: '⬆' },
                                { dir: 'down' as const, label: '⬇ 向下扩展', icon: '⬇' },
                                { dir: 'left' as const, label: '⬅ 向左扩展', icon: '⬅' },
                                { dir: 'right' as const, label: '➡ 向右扩展', icon: '➡' },
                            ]).map(opt => (
                                <button
                                    key={opt.dir}
                                    onClick={() => { setOutpaintMenuId(null); handleOutpaint(element, opt.dir); }}
                                    className="isl-opt text-[13px] font-bold"
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {element.type === 'image' && (
                <button title="图层蒙版 / Layer Mask" onClick={() => startMaskEditing(element.id)} className={`isl-icon-btn h-9 w-9 ${maskEditingId === element.id ? 'isl-icon-btn--active' : ''}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M12 3v18"></path><path d="M3 12h9"></path></svg>
                </button>
            )}
            {element.type === 'image' && (
                reversePromptLoading ? (
                    <button
                        title={language === 'zho' ? '取消分析' : 'Cancel analysis'}
                        onClick={cancelReversePrompt}
                        className="isl-icon-btn h-9 w-9 animate-pulse"
                        style={{ color: 'var(--isl-coral-deep)' }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>
                    </button>
                ) : (
                    <button
                        title="反推 Prompt / Reverse Prompt"
                        onClick={() => handleReversePrompt((element as ImageElement).href, (element as ImageElement).mimeType, (element as ImageElement).width, (element as ImageElement).height)}
                        className="isl-icon-btn h-9 w-9"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/><path d="M8 12l-2-2"/><path d="M16 12l2-2"/></svg>
                    </button>
                )
            )}

            {element.type === 'shape' && (
                <>
                    <input type="color" title={t('contextMenu.fillColor')} value={(element as ShapeElement).fillColor} onChange={e => handlePropertyChange(element.id, { fillColor: e.target.value })} className="isl-elastic h-7 w-7 cursor-pointer rounded-lg border-[1.5px] p-0" style={{ borderColor: 'var(--isl-border-strong)' }} />
                    <div className="h-6 w-px" style={{ background: 'var(--isl-border)' }}></div>
                    <input type="color" title={t('contextMenu.strokeColor')} value={(element as ShapeElement).strokeColor} onChange={e => handlePropertyChange(element.id, { strokeColor: e.target.value })} className="isl-elastic h-7 w-7 cursor-pointer rounded-lg border-[1.5px] p-0" style={{ borderColor: 'var(--isl-border-strong)' }} />
                    <div className="h-6 w-px" style={{ background: 'var(--isl-border)' }}></div>
                    <div title={t('contextMenu.strokeStyle')} className="isl-well flex items-center gap-1 p-1">
                        <button title={t('contextMenu.solid')} onClick={() => handlePropertyChange(element.id, { strokeDashArray: undefined })} className={`isl-icon-btn h-7 w-7 ${!(element as ShapeElement).strokeDashArray ? 'isl-icon-btn--active' : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                        <button title={t('contextMenu.dashed')} onClick={() => handlePropertyChange(element.id, { strokeDashArray: [10, 10] })} className={`isl-icon-btn h-7 w-7 ${(element as ShapeElement).strokeDashArray?.toString() === '10,10' ? 'isl-icon-btn--active' : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="9" y2="12"></line><line x1="15" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                        <button title={t('contextMenu.dotted')} onClick={() => handlePropertyChange(element.id, { strokeDashArray: [2, 6] })} className={`isl-icon-btn h-7 w-7 ${(element as ShapeElement).strokeDashArray?.toString() === '2,6' ? 'isl-icon-btn--active' : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="5.01" y2="12"></line><line x1="12" y1="12" x2="12.01" y2="12"></line><line x1="19" y1="12" x2="19.01" y2="12"></line></svg>
                        </button>
                    </div>
                </>
            )}

            {element.type === 'text' && <input type="color" title={t('contextMenu.fontColor')} value={(element as TextElement).fontColor} onChange={e => handlePropertyChange(element.id, { fontColor: e.target.value })} className="isl-elastic h-7 w-7 cursor-pointer rounded-lg border-[1.5px] p-0" style={{ borderColor: 'var(--isl-border-strong)' }} />}
            {element.type === 'text' && <input type="number" title={t('contextMenu.fontSize')} value={(element as TextElement).fontSize} onChange={e => handlePropertyChange(element.id, { fontSize: parseInt(e.target.value, 10) || 16 })} className="isl-well w-16 px-2 py-1 text-sm font-bold" style={{ color: 'var(--isl-ink)' }} />}
            {(element.type === 'arrow' || element.type === 'line') && <input type="color" title={t('contextMenu.strokeColor')} value={(element as ArrowElement).strokeColor} onChange={e => handlePropertyChange(element.id, { strokeColor: e.target.value })} className="isl-elastic h-7 w-7 cursor-pointer rounded-lg border-[1.5px] p-0" style={{ borderColor: 'var(--isl-border-strong)' }} />}
            {(element.type === 'arrow' || element.type === 'line') && <input type="range" title={t('contextMenu.strokeWidth')} min="1" max="50" value={(element as ArrowElement).strokeWidth} onChange={e => handlePropertyChange(element.id, { strokeWidth: parseInt(e.target.value, 10) })} className="toolbar-range w-20" />}
            <div className="h-6 w-px" style={{ background: 'var(--isl-border)' }}></div>
            <button title={t('contextMenu.delete')} onClick={() => handleDeleteElement(element.id)} className="isl-icon-btn h-9 w-9" style={{ color: 'var(--isl-coral-deep)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
        </div>
    </div>;

    return (
        <>
            <foreignObject x={x} y={y} width={toolbarCanvasWidth} height={toolbarCanvasHeight} style={{ overflow: 'visible' }}>
                {toolbar}
            </foreignObject>
            {filterPanelElementId === element.id && element.type === 'image' && (() => {
                const filterPanelW = 270 / zoom;
                const filterPanelH = 440 / zoom;
                const fpx = bounds.x + bounds.width + 10 / zoom;
                const fpy = bounds.y;
                return (
                    <foreignObject x={fpx} y={fpy} width={filterPanelW} height={filterPanelH} style={{ overflow: 'visible' }}>
                        <div style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'top left' }}>
                            <ImageFilterPanel
                                filters={(element as ImageElement).filters || {}}
                                onChange={(newFilters) => {
                                    handlePropertyChange(element.id, { filters: Object.keys(newFilters).length > 0 ? newFilters : undefined });
                                }}
                                onReset={() => handlePropertyChange(element.id, { filters: undefined })}
                                onClose={() => setFilterPanelElementId(null)}
                            />
                        </div>
                    </foreignObject>
                );
            })()}
        </>
    );
}
