import React, { memo, useEffect, useMemo, useState } from 'react';
import type {
    CanvasElement,
    Element,
    ElementGenerationState,
    GenerationMode,
    PromptEnhanceMode,
    PromptEnhanceResult,
    UserApiKey,
    ChatAttachment,
    UserEffect,
} from '../../types';
import { compilePromptReferences } from '../../utils/semanticCompiler';
import { hydrateRawTextToTiptapJSON } from '../../utils/htmlHydrator';
import { executeUnifiedIgnition } from '../../services/aiGateway';
import { PromptBar } from '../PromptBar';
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
    theme: 'light' | 'dark';
    apiKeyPayload?: UserApiKey;
    userApiKeys?: UserApiKey[];
    imageModelOptions: string[];
    videoModelOptions: string[];
    videoAspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
    setVideoAspectRatio: (ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9') => void;
    isAutoEnhanceEnabled: boolean;
    onAutoEnhanceToggle: () => void;
    onEnhancePrompt?: (payload: { prompt: string; mode: PromptEnhanceMode; stylePreset?: string }) => Promise<PromptEnhanceResult>;
    isEnhancingPrompt?: boolean;
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
    imageTitle: '生成图片',
    videoTitle: '生成视频',
    imagePlaceholder: 'Enter prompt description or type @ to bind an asset...',
    videoPlaceholder: 'Describe camera motion or type @ to bind a layer...',
    statusIdle: '等待输入',
    statusQueued: '已排队',
    statusRunning: '生成中',
    statusSuccess: '已完成',
    statusError: '需要处理',
    statusReady: '准备好了',
    slotFirstFrame: 'POSTER',
    slotStyleRef: 'STYLE',
    slotControlNet: 'CONTROL',
    slotContext: '参考',
    ignite: '生成',
    computing: '生成中',
    queue: '排队',
    model: '模型',
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
    aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9',
    status: ElementGenerationState['status'],
    progress?: number,
): ElementGenerationState {
    return {
        promptPayload: element.generationState?.promptPayload || { rawText: '', resolvedReferences: [] },
        provider: element.generationState?.provider || 'openrouter',
        modelId: element.generationState?.modelId || modelId,
        aspectRatio: element.generationState?.aspectRatio || aspectRatio,
        status,
        error: element.generationState?.error,
        progress: element.generationState?.progress ?? progress,
    };
}

const EMPTY_ATTACHMENTS: ChatAttachment[] = [];
const EMPTY_EFFECTS: UserEffect[] = [];
export const InlinePromptBar = memo(({
    element,
    allElements,
    canvasZoom,
    canvasPan,
    modelId,
    status,
    progress,
    isLoading,
    theme,
    apiKeyPayload,
    userApiKeys = [],
    imageModelOptions,
    videoModelOptions,
    videoAspectRatio,
    setVideoAspectRatio,
    isAutoEnhanceEnabled,
    onAutoEnhanceToggle,
    onEnhancePrompt,
    isEnhancingPrompt = false,
    t,
    onPromptChange,
    onMediaGenerated,
    progressLabel,
    activeTaskCount = 0,
}: InlinePromptBarProps) => {
    const language = useWorkspaceStore(state => state.language);
    const generationState = createGenerationState(element, modelId, videoAspectRatio, isLoading ? 'running' : status, progress);
    const effectiveModelId = generationState.modelId || modelId;
    const generationMode: GenerationMode = element.type === 'video' ? 'video' : 'image';
    const effectiveAspectRatio = generationState.aspectRatio || videoAspectRatio;
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

    const syncPromptState = (rawText: string, editorDocument?: Record<string, unknown>) => {
        const canvasElements = allElements.filter(isReferenceableCanvasElement);
        const hydrated = hydrateRawTextToTiptapJSON(rawText, canvasElements);
        onPromptChange(element.id, {
            ...generationState,
            modelId: effectiveModelId,
            aspectRatio: effectiveAspectRatio,
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
                aspectRatio: effectiveAspectRatio,
                status: 'error',
                error: `${inlineT.noProvider}: ${generationMode}`,
            });
            return;
        }

        onPromptChange(element.id, { ...generationState, aspectRatio: effectiveAspectRatio, status: 'running', error: undefined, progress: 5 });

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
            aspectRatio: effectiveAspectRatio,
            references,
            onProgress: (nextProgress: number) => {
                onPromptChange(element.id, { ...generationState, aspectRatio: effectiveAspectRatio, status: 'running', error: undefined, progress: nextProgress });
            },
        });

        if (result.ok) {
            onMediaGenerated(element.id, { href: result.mediaUrl, mimeType: result.mimeType });
            onPromptChange(element.id, { ...generationState, aspectRatio: effectiveAspectRatio, status: 'success', error: undefined, progress: 100 });
        } else {
            onPromptChange(element.id, { ...generationState, aspectRatio: effectiveAspectRatio, status: 'error', error: result.errorMessage, progress: undefined });
        }
    };

    const [winW, setWinW] = useState(() => window.innerWidth);
    const BAR_MAX_WIDTH = 720;
    const barWidth = Math.min(BAR_MAX_WIDTH, Math.max(360, winW - 40));
    const halfBarWidth = barWidth / 2;
    const screenCenterX = canvasPan.x + (element.x + element.width / 2) * canvasZoom;
    const screenTopY = canvasPan.y + (element.y + element.height) * canvasZoom + 16;
    const clampedCenterX = Math.max(halfBarWidth + 4, Math.min(screenCenterX, winW - halfBarWidth - 4));
    const clampedTopY = Math.max(8, screenTopY);
    const accentColor = generationMode === 'video' ? 'var(--isl-sun)' : 'var(--isl-mint)';
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

    useEffect(() => {
        const onResize = () => setWinW(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return (
        <div
            data-testid="inline-prompt-bar"
            className="inline-prompt-bar"
            style={{
                position: 'absolute',
                left: `${clampedCenterX}px`,
                top: `${clampedTopY}px`,
                width: `${barWidth}px`,
                transform: 'translateX(-50%)',
                zIndex: 50,
                pointerEvents: 'auto',
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="relative" style={{ '--inline-prompt-accent': accentColor } as React.CSSProperties}>
                    {generationState.status === 'running' && (
                        <div className="inline-prompt-bar__queue-meta">
                            <span>{activeTaskCount > 1 ? `${inlineT.queue} ${activeTaskCount}` : currentStatusLabel}</span>
                            <span>{progressLabel || `${Math.round(runningProgress)}%`}</span>
                        </div>
                    )}

                    <PromptBar
                        t={t as any}
                        theme={theme}
                        prompt={generationState.promptPayload.rawText}
                        promptDocument={generationState.promptPayload.richTextDocument}
                        setPrompt={(nextPrompt) => syncPromptState(nextPrompt, generationState.promptPayload.richTextDocument)}
                        onPromptDocumentChange={(document) => syncPromptState(generationState.promptPayload.rawText, document)}
                        onGenerate={handleIgniteExecution}
                        isLoading={generationState.status === 'running' || isLoading}
                        isSelectionActive={false}
                        selectedElementCount={1}
                        userEffects={EMPTY_EFFECTS}
                        onAddUserEffect={() => undefined}
                        onDeleteUserEffect={() => undefined}
                        generationMode={generationMode}
                        setGenerationMode={() => undefined}
                        modeOptions={[generationMode]}
                        videoAspectRatio={effectiveAspectRatio}
                        setVideoAspectRatio={(ratio) => {
                            onPromptChange(element.id, {
                                ...generationState,
                                aspectRatio: ratio,
                            });
                            setVideoAspectRatio(ratio);
                        }}
                        selectedImageModel={generationMode === 'image' ? effectiveModelId : undefined}
                        selectedVideoModel={generationMode === 'video' ? effectiveModelId : undefined}
                        imageModelOptions={imageModelOptions}
                        videoModelOptions={videoModelOptions}
                        onImageModelChange={generationMode === 'image' ? (nextModel) => {
                            onPromptChange(element.id, {
                                ...generationState,
                                modelId: nextModel,
                                aspectRatio: effectiveAspectRatio,
                            });
                        } : undefined}
                        onVideoModelChange={generationMode === 'video' ? (nextModel) => {
                            onPromptChange(element.id, {
                                ...generationState,
                                modelId: nextModel,
                                aspectRatio: effectiveAspectRatio,
                            });
                        } : undefined}
                        canvasElements={allElements.filter(item => item.id !== element.id)}
                        attachments={EMPTY_ATTACHMENTS}
                        onMentionedElementIds={() => undefined}
                        onEnhancePrompt={onEnhancePrompt}
                        isEnhancingPrompt={isEnhancingPrompt}
                        isAutoEnhanceEnabled={isAutoEnhanceEnabled}
                        onAutoEnhanceToggle={onAutoEnhanceToggle}
                        apiConfigs={userApiKeys}
                        userApiKeys={userApiKeys}
                        hideApiStatus
                        variant="inline"
                        shellClassName="inline-prompt-bar-shell"
                        popoverDirection="down"
                    />

                    {generationState.error && (
                        <div className="inline-prompt-bar__error-harness flv-message-card">
                            <div className="inline-prompt-bar__error-line" />
                            <div className="inline-prompt-bar__error-text">{generationState.error}</div>
                        </div>
                    )}
            </div>
        </div>
    );
});

InlinePromptBar.displayName = 'InlinePromptBar';

