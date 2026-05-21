import React, { memo, useEffect, useMemo, useState } from 'react';
import type {
    CanvasElement,
    ChatAttachment,
    Element,
    ElementGenerationState,
    GenerationMode,
    PromptEnhanceMode,
    PromptEnhanceResult,
    UserApiKey,
} from '../../types';
import { compilePromptReferences } from '../../utils/semanticCompiler';
import { executeUnifiedIgnition, inferCapabilityFromModelName } from '../../services/aiGateway';
import { PromptBar } from '../PromptBar';

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
    imageModelOptions: string[];
    videoModelOptions: string[];
    videoAspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
    setVideoAspectRatio: (ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9') => void;
    isAutoEnhanceEnabled?: boolean;
    onAutoEnhanceToggle?: () => void;
    onEnhancePrompt?: (payload: { prompt: string; mode: PromptEnhanceMode; stylePreset?: string }) => Promise<PromptEnhanceResult>;
    isEnhancingPrompt?: boolean;
    t: (key: string, ...args: unknown[]) => string;
    onModelChange: (modelId: string) => void;
    onPromptChange: (elementId: string, generationState: ElementGenerationState) => void;
    onMediaGenerated: (elementId: string, media: { href: string; mimeType: string }) => void;
    animateViewport: (targetX: number, targetY: number, targetZoom: number) => void;
}

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
    imageModelOptions,
    videoModelOptions,
    videoAspectRatio,
    setVideoAspectRatio,
    isAutoEnhanceEnabled = false,
    onAutoEnhanceToggle,
    onEnhancePrompt,
    isEnhancingPrompt = false,
    t,
    onModelChange,
    onPromptChange,
    onMediaGenerated,
}: InlinePromptBarProps) => {
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const generationState = createGenerationState(element, modelId, isLoading ? 'running' : status, progress);
    const effectiveModelId = generationState.modelId || modelId;
    const generationMode: GenerationMode = element.type === 'video' ? 'video' : 'image';

    useEffect(() => {
        if (!generationState.error) return;
        const timer = window.setTimeout(() => {
            onPromptChange(element.id, { ...generationState, error: undefined });
        }, 3000);
        return () => window.clearTimeout(timer);
    }, [element.id, generationState, onPromptChange]);

    const syncPromptState = (rawText: string) => {
        const canvasElements = allElements.filter((item): item is CanvasElement => (
            item.type === 'image' || item.type === 'video' || item.type === 'text' || item.type === 'shape'
        ));
        onPromptChange(element.id, {
            ...generationState,
            modelId: effectiveModelId,
            promptPayload: compilePromptReferences(rawText, canvasElements),
        });
    };

    const handleIgniteExecution = async () => {
        if (generationState.status === 'running') return;
        if (!apiKeyPayload) {
            onPromptChange(element.id, {
                ...generationState,
                status: 'error',
                error: `未配置 ${generationMode} Provider Key`,
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
            ...attachments.map((attachment) => ({
                type: attachment.mimeType.startsWith('video/') ? 'video' as const : 'image' as const,
                href: attachment.href,
                mimeType: attachment.mimeType,
                slotRole: 'unassigned',
            })),
        ];

        const result = await executeUnifiedIgnition({
            elementId: element.id,
            prompt: generationState.promptPayload.rawText,
            modelId: effectiveModelId,
            apiKeyPayload,
            references,
            onProgress: (nextProgress) => {
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

    const inverseScale = canvasZoom >= 0.4 ? 1 / canvasZoom : 1;
    const panelWidth = 540;
    const capability = inferCapabilityFromModelName(effectiveModelId);

    const addAttachments = async (files: FileList | File[]) => {
        const next = await Promise.all(Array.from(files).map(async (file, index) => ({
            id: `inline_${element.id}_${Date.now()}_${index}`,
            name: file.name,
            href: await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            }),
            mimeType: file.type,
            source: 'upload' as const,
        })));
        setAttachments(prev => [...prev, ...next.filter(item => item.href)]);
    };

    return (
        <foreignObject
            x={element.x}
            y={element.y + element.height + 8}
            width={panelWidth * inverseScale}
            height={360 * inverseScale}
            style={{ overflow: 'visible' }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            data-testid="inline-prompt-bar"
        >
            <div
                style={{
                    width: panelWidth,
                    transform: `scale(${inverseScale})`,
                    transformOrigin: 'top left',
                }}
            >
                <PromptBar
                    t={t}
                    theme="dark"
                    compactMode
                    variant="inline"
                    hideApiStatus
                    className="inline-prompt-bar-surface"
                    shellClassName="inline-prompt-bar-shell"
                    prompt={generationState.promptPayload.rawText}
                    setPrompt={syncPromptState}
                    onGenerate={handleIgniteExecution}
                    isLoading={isLoading || generationState.status === 'running'}
                    isSelectionActive
                    selectedElementCount={1}
                    userEffects={[]}
                    onAddUserEffect={() => undefined}
                    onDeleteUserEffect={() => undefined}
                    generationMode={generationMode}
                    setGenerationMode={() => undefined}
                    videoAspectRatio={videoAspectRatio}
                    setVideoAspectRatio={setVideoAspectRatio}
                    selectedImageModel={capability === 'image' ? effectiveModelId : undefined}
                    selectedVideoModel={capability === 'video' ? effectiveModelId : undefined}
                    imageModelOptions={imageModelOptions}
                    videoModelOptions={videoModelOptions}
                    onImageModelChange={generationMode === 'image' ? onModelChange : undefined}
                    onVideoModelChange={generationMode === 'video' ? onModelChange : undefined}
                    canvasElements={allElements}
                    attachments={attachments}
                    onAddAttachments={(files) => { void addAttachments(files); }}
                    onRemoveAttachment={(id) => setAttachments(prev => prev.filter(item => item.id !== id))}
                    onEnhancePrompt={onEnhancePrompt}
                    isEnhancingPrompt={isEnhancingPrompt}
                    isAutoEnhanceEnabled={isAutoEnhanceEnabled}
                    onAutoEnhanceToggle={onAutoEnhanceToggle}
                />
            </div>
        </foreignObject>
    );
});

InlinePromptBar.displayName = 'InlinePromptBar';
