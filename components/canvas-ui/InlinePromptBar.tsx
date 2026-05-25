import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import type {
    CanvasElement,
    Element,
    ElementGenerationState,
    GenerationMode,
    AssetSlotRole,
    UserApiKey,
} from '../../types';
import { compilePromptReferences } from '../../utils/semanticCompiler';
import { hydrateRawTextToTiptapJSON } from '../../utils/htmlHydrator';
import { executeUnifiedIgnition } from '../../services/aiGateway';
import RichPromptEditor, { type RichPromptEditorHandle } from '../RichPromptEditor';
import type { MentionItem } from '../MentionList';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

interface InlinePromptBarProps {
    element: CanvasElement;
    allElements: Element[];
    canvasZoom: number;
    canvasPan: { x: number; y: number };
    modelId: string;
    status: ElementGenerationState['status'];
    progress?: number;
    isLoading: boolean;
    apiKeyPayload?: UserApiKey;
    t: (key: string, ...args: unknown[]) => string;
    onPromptChange: (elementId: string, generationState: ElementGenerationState) => void;
    onMediaGenerated: (elementId: string, media: { href: string; mimeType: string }) => void;
    animateViewport: (targetX: number, targetY: number, targetZoom: number) => void;
    progressLabel?: string;
    activeTaskCount?: number;
}

type InlinePromptTranslations = {
    imageTitle: string;
    videoTitle: string;
    imagePlaceholder: string;
    videoPlaceholder: string;
    statusIdle: string;
    statusQueued: string;
    statusRunning: string;
    statusSuccess: string;
    statusError: string;
    statusReady: string;
    slotFirstFrame: string;
    slotStyleRef: string;
    slotControlNet: string;
    slotContext: string;
    ignite: string;
    computing: string;
    queue: string;
    model: string;
    uploadReference: string;
    removeReference: string;
    noProvider: string;
};

const inlinePromptFallback: InlinePromptTranslations = {
    imageTitle: 'IMG MATRIX',
    videoTitle: 'FILM MATRIX',
    imagePlaceholder: 'Enter prompt description or type @ to bind an asset...',
    videoPlaceholder: 'Describe camera motion or type @ to bind a layer...',
    statusIdle: 'IDLE',
    statusQueued: 'QUEUED',
    statusRunning: 'COMPUTING',
    statusSuccess: 'READY',
    statusError: 'ERROR',
    statusReady: 'CORE READY',
    slotFirstFrame: 'POSTER',
    slotStyleRef: 'STYLE',
    slotControlNet: 'CONTROL',
    slotContext: 'TXT REF',
    ignite: 'IGNITE',
    computing: 'COMPUTING',
    queue: 'QUEUE',
    model: 'MODEL',
    uploadReference: 'Upload reference',
    removeReference: 'Remove reference',
    noProvider: 'Provider key is not configured',
};

const canvasItemTypeLabels: Record<Element['type'], string> = {
    image: '图片',
    video: '视频',
    shape: '形状',
    text: '文字',
    path: '画笔',
    group: '组合',
    arrow: '箭头',
    line: '线条',
};

const isReferenceableCanvasElement = (item: Element): item is CanvasElement => (
    item.type === 'image' || item.type === 'video' || item.type === 'text' || item.type === 'shape'
);

function createGenerationState(
    element: CanvasElement,
    modelId: string,
    status: ElementGenerationState['status'],
    progress?: number,
): ElementGenerationState {
    return {
        promptPayload: element.generationState?.promptPayload || { rawText: '', resolvedReferences: [] },
        provider: element.generationState?.provider || 'openrouter',
        modelId: element.generationState?.modelId || modelId,
        status,
        error: element.generationState?.error,
        progress: element.generationState?.progress ?? progress,
    };
}

export const InlinePromptBar = memo(({
    element,
    allElements,
    canvasZoom,
    modelId,
    status,
    progress,
    isLoading,
    apiKeyPayload,
    t,
    onPromptChange,
    onMediaGenerated,
    progressLabel,
    activeTaskCount = 0,
}: InlinePromptBarProps) => {
    const editorRef = useRef<RichPromptEditorHandle>(null);
    const animationFrameRef = useRef<number | null>(null);
    const language = useWorkspaceStore(state => state.language);
    const generationState = createGenerationState(element, modelId, isLoading ? 'running' : status, progress);
    const effectiveModelId = generationState.modelId || modelId;
    const generationMode: GenerationMode = element.type === 'video' ? 'video' : 'image';
    const isChinese = language === 'zho';
    const inlineT = useMemo<InlinePromptTranslations>(() => {
        const getValue = (key: keyof InlinePromptTranslations) => {
            const value = t(`inlinePrompt.${key}`);
            return value === `inlinePrompt.${key}` ? inlinePromptFallback[key] : value;
        };

        return {
            imageTitle: getValue('imageTitle'),
            videoTitle: getValue('videoTitle'),
            imagePlaceholder: getValue('imagePlaceholder'),
            videoPlaceholder: getValue('videoPlaceholder'),
            statusIdle: getValue('statusIdle'),
            statusQueued: getValue('statusQueued'),
            statusRunning: getValue('statusRunning'),
            statusSuccess: getValue('statusSuccess'),
            statusError: getValue('statusError'),
            statusReady: getValue('statusReady'),
            slotFirstFrame: getValue('slotFirstFrame'),
            slotStyleRef: getValue('slotStyleRef'),
            slotControlNet: getValue('slotControlNet'),
            slotContext: getValue('slotContext'),
            ignite: getValue('ignite'),
            computing: getValue('computing'),
            queue: getValue('queue'),
            model: getValue('model'),
            uploadReference: getValue('uploadReference'),
            removeReference: getValue('removeReference'),
            noProvider: getValue('noProvider'),
        };
    }, [t]);

    useEffect(() => {
        if (!generationState.error) return;
        const timer = window.setTimeout(() => {
            onPromptChange(element.id, { ...generationState, error: undefined });
        }, 3000);
        return () => window.clearTimeout(timer);
    }, [element.id, generationState.error, onPromptChange]);

    const canvasItems = useMemo<MentionItem[]>(() => allElements
        .filter(item => item.id !== element.id && item.isVisible !== false && isReferenceableCanvasElement(item))
        .map(item => ({
            id: item.id,
            label: item.name?.trim() || `${canvasItemTypeLabels[item.type]} ${item.id.slice(-4)}`,
            thumbnail: item.type === 'image' ? item.href : '',
            elementType: item.type,
        })), [allElements, element.id]);

    const syncPromptState = (rawText: string, editorDocument?: Record<string, unknown>) => {
        const canvasElements = allElements.filter(isReferenceableCanvasElement);
        const hydrated = hydrateRawTextToTiptapJSON(rawText, canvasElements);
        onPromptChange(element.id, {
            ...generationState,
            modelId: effectiveModelId,
            promptPayload: {
                ...compilePromptReferences(rawText, canvasElements),
                richTextDocument: editorDocument || hydrated.json,
            },
        });
    };

    const handleIgniteExecution = async () => {
        if (generationState.status === 'running') return;
        if (!apiKeyPayload) {
            onPromptChange(element.id, {
                ...generationState,
                status: 'error',
                error: `${inlineT.noProvider}: ${generationMode}`,
            });
            return;
        }

        onPromptChange(element.id, { ...generationState, status: 'running', error: undefined, progress: 5 });

        const references = [
            ...generationState.promptPayload.resolvedReferences
                .map((reference) => {
                    const target = allElements.find((item) => item.id === reference.targetElementId);
                    if (!target || (target.type !== 'image' && target.type !== 'video' && target.type !== 'text' && target.type !== 'shape')) return null;
                    if (target.type === 'image' || target.type === 'video') {
                        return {
                            type: target.type,
                            href: target.href,
                            mimeType: target.mimeType,
                            slotRole: reference.slotRole || 'unassigned',
                        };
                    }
                    return { type: target.type, slotRole: reference.slotRole || 'unassigned' };
                })
                .filter((reference): reference is NonNullable<typeof reference> => reference !== null),
        ];

        const result = await executeUnifiedIgnition({
            elementId: element.id,
            prompt: generationState.promptPayload.rawText,
            modelId: effectiveModelId,
            apiKeyPayload,
            references,
            onProgress: (nextProgress: number) => {
                onPromptChange(element.id, { ...generationState, status: 'running', error: undefined, progress: nextProgress });
            },
        });

        if (result.ok) {
            onMediaGenerated(element.id, { href: result.mediaUrl, mimeType: result.mimeType });
            onPromptChange(element.id, { ...generationState, status: 'success', error: undefined, progress: 100 });
        } else {
            onPromptChange(element.id, { ...generationState, status: 'error', error: result.errorMessage, progress: undefined });
        }
    };

    const targetScale = useMemo(() => {
        const safeZoom = Math.max(canvasZoom, 0.12);
        return Math.max(0.9, Math.min(2.35, 1 / safeZoom));
    }, [canvasZoom]);
    const [displayScale, setDisplayScale] = useState(targetScale);
    const panelWidth = isChinese ? 360 : 390;
    const accentColor = generationMode === 'video' ? '#D6A84F' : '#00FF88';
    const runningProgress = generationState.status === 'running'
        ? Math.max(6, Math.min(98, generationState.progress ?? progress ?? 12))
        : 0;
    const statusLabelMap: Record<ElementGenerationState['status'], string> = {
        idle: inlineT.statusIdle,
        queued: inlineT.statusQueued,
        running: inlineT.statusRunning,
        success: inlineT.statusSuccess,
        error: inlineT.statusError,
    };
    const currentStatusLabel = statusLabelMap[generationState.status] || generationState.status;
    const topPosition = element.y + element.height + 6;

    const handleToggleRole = (targetElementId: string, currentRole: AssetSlotRole) => {
        const roles: AssetSlotRole[] = ['first_frame', 'style_ref', 'control_net', 'unassigned'];
        const nextRole = roles[(roles.indexOf(currentRole) + 1) % roles.length] || 'unassigned';
        const updatedReferences = generationState.promptPayload.resolvedReferences.map((reference) => (
            reference.targetElementId === targetElementId ? { ...reference, slotRole: nextRole } : reference
        ));

        onPromptChange(element.id, {
            ...generationState,
            promptPayload: {
                ...generationState.promptPayload,
                resolvedReferences: updatedReferences,
            },
        });
    };

    const getRoleBadge = (role: AssetSlotRole) => {
        switch (role) {
            case 'first_frame': return { text: inlineT.slotFirstFrame, cls: 'border-emerald-500/30 text-emerald-500 bg-emerald-500/5' };
            case 'style_ref': return { text: inlineT.slotStyleRef, cls: 'border-amber-500/30 text-amber-500 bg-amber-500/5' };
            case 'control_net': return { text: inlineT.slotControlNet, cls: 'border-blue-500/30 text-blue-500 bg-blue-500/5' };
            default: return { text: inlineT.slotContext, cls: 'border-[var(--flovart-chip-border)] text-[var(--flovart-text-muted)] bg-transparent' };
        }
    };

    useEffect(() => {
        if (animationFrameRef.current !== null) {
            window.cancelAnimationFrame(animationFrameRef.current);
        }

        const animate = () => {
            setDisplayScale(previous => {
                const delta = targetScale - previous;
                if (Math.abs(delta) < 0.002) {
                    return targetScale;
                }
                animationFrameRef.current = window.requestAnimationFrame(animate);
                return previous + delta * 0.18;
            });
        };

        animationFrameRef.current = window.requestAnimationFrame(animate);
        return () => {
            if (animationFrameRef.current !== null) {
                window.cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [targetScale]);

    return (
        <foreignObject
            x={element.x}
            y={topPosition}
            width={panelWidth * displayScale}
            height={260 * displayScale}
            style={{ overflow: 'visible' }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            data-testid="inline-prompt-bar"
        >
            <div
                className="inline-prompt-bar-motion"
                style={{
                    width: panelWidth,
                    transform: `scale(${displayScale})`,
                    transformOrigin: 'top left',
                    willChange: 'transform',
                }}
            >
                <div
                    className="inline-prompt-bar"
                    style={{
                        '--inline-prompt-accent': accentColor,
                        '--inline-prompt-progress': `${runningProgress}%`,
                        '--inline-prompt-title-tracking': isChinese ? '0.02em' : '0.1em',
                    } as React.CSSProperties}
                >
                    {generationState.status === 'running' && (
                        <>
                            <div className="inline-prompt-bar__ribbon" />
                            <div className="inline-prompt-bar__queue-meta">
                                <span>{activeTaskCount > 1 ? `${inlineT.queue} ${activeTaskCount}` : currentStatusLabel}</span>
                                <span>{progressLabel || `${Math.round(runningProgress)}%`}</span>
                            </div>
                        </>
                    )}

                    <div className="inline-prompt-bar__header">
                        <div className="inline-prompt-bar__title">
                            <span className="inline-prompt-bar__eyebrow">{generationMode === 'video' ? inlineT.videoTitle : inlineT.imageTitle}</span>
                            <span className="inline-prompt-bar__model" title={effectiveModelId}>{effectiveModelId}</span>
                        </div>
                        <div className="inline-prompt-bar__status">
                            <span className={`inline-prompt-bar__status-dot inline-prompt-bar__status-dot--${generationState.status}`} />
                            <span>{currentStatusLabel}</span>
                        </div>
                    </div>

                    <div className="inline-prompt-bar__editor">
                        <RichPromptEditor
                            ref={editorRef}
                            canvasItems={canvasItems}
                            placeholder={generationMode === 'video' ? inlineT.videoPlaceholder : inlineT.imagePlaceholder}
                            disabled={generationState.status === 'running'}
                            initialText={generationState.promptPayload.rawText}
                            initialDocument={generationState.promptPayload.richTextDocument}
                            onTextChange={(plainText, json) => syncPromptState(plainText, json)}
                            onSubmit={handleIgniteExecution}
                        />
                    </div>

                    {generationState.promptPayload.resolvedReferences.length > 0 && (
                        <div className="inline-prompt-bar__refs select-none">
                            {generationState.promptPayload.resolvedReferences.map((reference) => {
                                const badge = getRoleBadge(reference.slotRole || 'unassigned');
                                return (
                                    <div key={reference.targetElementId} className="inline-prompt-bar__ref-chip">
                                        <span className="inline-prompt-bar__ref-token">@ {reference.token.replace(/^@/, '')}</span>
                                        {reference.targetType === 'image' && (
                                            <button
                                                type="button"
                                                onClick={() => handleToggleRole(reference.targetElementId, reference.slotRole || 'unassigned')}
                                                className={`inline-prompt-bar__slot-toggle active:scale-95 ${badge.cls}`}
                                            >
                                                {badge.text}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="inline-prompt-bar__footer select-none">
                        <div className="inline-prompt-bar__schema" title={progressLabel || effectiveModelId}>
                            {generationState.status === 'running'
                                ? `${inlineT.computing}: ${Math.round(runningProgress)}%`
                                : progress !== undefined
                                    ? `${Math.round(progress)}%`
                                    : inlineT.statusReady}
                        </div>
                        <button
                            type="button"
                            className="inline-prompt-bar__ignite active:scale-95 transition-transform"
                            disabled={generationState.status === 'running' || !generationState.promptPayload.rawText.trim()}
                            onClick={handleIgniteExecution}
                        >
                            {generationState.status === 'running' ? inlineT.computing : inlineT.ignite}
                        </button>
                    </div>

                    {generationState.error && (
                        <div className="inline-prompt-bar__error-harness animate-shake">
                            <div className="inline-prompt-bar__error-line" />
                            <div className="inline-prompt-bar__error-text">{generationState.error}</div>
                        </div>
                    )}
                </div>
            </div>
        </foreignObject>
    );
});

InlinePromptBar.displayName = 'InlinePromptBar';
