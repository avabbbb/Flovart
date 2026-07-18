import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, Reorder } from 'motion/react';
import type {
    AssetFolder,
    AssetLibrary,
    CharacterLockProfile,
    ChatAttachment,
    GenerationMode,
    PromptEnhanceMode,
    PromptEnhanceResult,
    ProductModelMode,
    UserApiKey,
    UserEffect,
} from '../types';
import RichPromptEditor, { type RichPromptEditorHandle } from './RichPromptEditor';
import type { AssetSuggestion, MentionItem } from './MentionList';
export type { MentionItem } from './MentionList';
import { extractMentions } from './MediaMentionExtension';
import type { ImageReferenceChip } from './workflow/references';
import { useWorkflowMediaUrl } from './workflow/media';
import { PROVIDER_LABELS, type VideoAspectRatio } from '../services/aiGateway';

import { readColdMedia } from '../utils/mediaIndexedDB';
import { modelRefLabel, modelRefModelId, modelRefProvider } from '../utils/modelRefs';
import {
    getProductModel,
    getProductModels,
    getRoutedVideoModes,
    explainUnsupportedVideoMode,
    isProductModelConfigured,
    resolveAnyProductRoute,
    sanitizeProductGenerationParams,
    VIDEO_MODE_ORDER,
} from '../services/productModelCatalog';
import { AssetReferencePicker, type ReferencePickerWorkflowItem } from './studio/AssetReferencePicker';
import { estimateApiCost } from '../utils/usageMonitor';

export interface PromptBarProps {
    t: (key: string, ...args: any[]) => string;
    theme: 'light' | 'dark';
    language?: 'en' | 'zho';
    compactMode?: boolean;
    prompt: string;
    promptDocument?: Record<string, unknown>;
    setPrompt: (prompt: string) => void;
    onGenerate: () => void;
    onStop?: () => void;
    isLoading: boolean;
    isSelectionActive: boolean;
    selectedElementCount: number;
    userEffects: UserEffect[];
    onAddUserEffect: (effect: UserEffect) => void;
    onDeleteUserEffect: (id: string) => void;
    generationMode: GenerationMode;
    setGenerationMode: (mode: GenerationMode) => void;
    /** 参考图 chip 面板：由 WorkflowNodePromptBar 派生，连线即面板条目 */
    imageReferenceChips?: ImageReferenceChip[];
    onImageReferenceReorder?: (ids: string[]) => void;
    onImageReferenceRemove?: (id: string) => void;
    videoAspectRatio: VideoAspectRatio;
    setVideoAspectRatio: (ratio: VideoAspectRatio) => void;
    imageAspectRatio?: VideoAspectRatio;
    setImageAspectRatio?: (ratio: VideoAspectRatio) => void;
    videoDurationSec?: number;
    onVideoDurationSecChange?: (durationSec: number) => void;
    videoResolution?: string;
    onVideoResolutionChange?: (resolution: string) => void;
    videoGenerateAudio?: boolean;
    onVideoGenerateAudioChange?: (enabled: boolean) => void;
    videoWatermark?: boolean;
    onVideoWatermarkChange?: (enabled: boolean) => void;
    generationSubmode?: ProductModelMode;
    onGenerationSubmodeChange?: (mode: ProductModelMode) => void;
    generationQuality?: string;
    onGenerationQualityChange?: (quality: string) => void;
    webSearchEnabled?: boolean;
    onWebSearchToggle?: (enabled: boolean) => void;
    realPersonCheckEnabled?: boolean;
    onRealPersonCheckToggle?: (enabled: boolean) => void;
    selectedTextModel?: string;
    selectedImageModel?: string;
    selectedVideoModel?: string;
    textModelOptions?: string[];
    imageModelOptions?: string[];
    videoModelOptions?: string[];
    onTextModelChange?: (model: string) => void;
    onImageModelChange?: (model: string) => void;
    onVideoModelChange?: (model: string) => void;
    mentionItems?: MentionItem[];
    attachments?: ChatAttachment[];
    onAddAttachments?: (files: FileList | File[]) => void;
    onRemoveAttachment?: (id: string) => void;
    onMentionedElementIds?: (ids: string[]) => void;
    onPromptDocumentChange?: (document: Record<string, unknown>) => void;
    onPromptInputChange?: (payload: { plainText: string; document: Record<string, unknown>; mentionedElementIds: string[] }) => void;
    onEnhancePrompt?: (payload: { prompt: string; mode: PromptEnhanceMode; stylePreset?: string }) => Promise<PromptEnhanceResult>;
    isEnhancingPrompt?: boolean;
    isAutoEnhanceEnabled?: boolean;
    onAutoEnhanceToggle?: () => void;
    onLockCharacterFromSelection?: (name?: string) => void;
    canLockCharacter?: boolean;
    characterLocks?: CharacterLockProfile[];
    activeCharacterLockId?: string | null;
    onSetActiveCharacterLock?: (id: string | null) => void;
    // API 配置管理（统一使用 UserApiKey）
    apiConfigs?: UserApiKey[];
    activeApiConfigId?: string | null;
    activeApiModelId?: string | null;
    onApiConfigChange?: (id: string) => void;
    onApiModelChange?: (modelId: string) => void;
    // API Key 联动
    userApiKeys?: UserApiKey[];
    onOpenSettings?: () => void;
    // 批量生成
    batchCount?: number;
    onBatchCountChange?: (count: number) => void;
    allowVideoBatch?: boolean;
    variant?: 'global' | 'inline';
    className?: string;
    shellClassName?: string;
    modeOptions?: GenerationMode[];
    popoverDirection?: 'auto' | 'up' | 'down';
    onRetry?: () => void;
    error?: string | null;
    progressStage?: string;
    providerUsageLabel?: string;
    autoFocus?: boolean;
    focusSignal?: number;
    assetFolders?: AssetFolder[];
    assetItems?: AssetSuggestion[];
    assetLibrary?: AssetLibrary;
    referenceItems?: ReferencePickerWorkflowItem[];
    onSelectWorkflowReference?: (nodeId: string) => string | undefined;
    onAddReferenceFiles?: (files: File[]) => void | Promise<void>;
    onSelectAsset?: (assetId: string) => string | undefined;
    skillEnabled?: boolean;
}

type ExpandPanel = 'model' | 'submode' | 'parameters' | 'more' | 'batch' | null;

function getModeLabel(mode: GenerationMode): string {
    if (mode === 'text') return '文本';
    if (mode === 'video') return '视频';
    if (mode === 'keyframe') return '首尾帧';
    return '图片';
}

const PRODUCT_MODE_LABELS: Record<ProductModelMode, string> = {
    'text-to-image': '文生图',
    'image-to-image': '图生图',
    'text-to-video': '文生视频',
    'image-to-video': '图生视频',
    'reference-to-video': '全能参考',
    'first-last-frame': '首尾帧',
    'video-extension': '视频扩展',
};

function getProductFamily(model: ReturnType<typeof getProductModels>[number]): string {
    if (model.id.includes('seedance')) return 'Seedance';
    if (model.id.includes('seedream')) return 'Seedream';
    if (model.id.includes('kling')) return 'Kling';
    if (model.id.includes('veo')) return 'Veo';
    if (model.id.includes('gpt-image')) return 'GPT Image';
    if (model.id.includes('gemini')) return 'Gemini Image';
    return model.company;
}

function ReferenceChipPreview({ chip }: { chip: ImageReferenceChip }) {
    const media = useWorkflowMediaUrl(chip.storageKey, chip.thumbnail);
    if (chip.elementType === 'audio') return <div className="flex h-full w-full items-center justify-center text-[10px] font-bold" style={{ color: 'var(--isl-mint-deep)', background: 'var(--isl-mint-bg)' }}>AU</div>;
    if (!media.url) return <div className="flex h-full w-full items-center justify-center text-[10px]">{chip.elementType === 'video' ? '🎬' : '🖼'}</div>;
    return chip.elementType === 'video'
        ? <video src={media.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
        : <img src={media.url} alt={chip.label} className="h-full w-full object-cover" />;
}

function getModelLabel(mode: GenerationMode, textModel?: string, imageModel?: string, videoModel?: string, userApiKeys: UserApiKey[] = []): string {
    const model = mode === 'text' ? textModel : mode === 'video' || mode === 'keyframe' ? videoModel : imageModel;
    if (!model) return mode === 'text' ? '选择文本模型' : mode === 'video' || mode === 'keyframe' ? '选择视频模型' : '选择图片模型';
    const product = getProductModel(model);
    if (product) return product.name;
    const provider = modelRefProvider(model, userApiKeys);
    const shortProvider = PROVIDER_LABELS[provider]?.split(' ')[0] || provider;
    return `${shortProvider} · ${modelRefModelId(model).replace(/^(google|openai|anthropic|openrouter)\//, '')}`;
}

const MenuOptionButton: React.FC<{ label: string; active?: boolean; description?: string; onClick: () => void }> = ({ label, active = false, description, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className={`isl-opt ${active ? 'isl-opt--active' : ''}`}
    >
        <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold">{label}</span>
            {description && <span className="mt-0.5 block text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>{description}</span>}
        </span>
        {active && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="m5 13 4 4L19 7" />
            </svg>
        )}
    </button>
);

type FloatingSide = 'up' | 'down';

const AdaptivePromptPopover: React.FC<{
    anchorRef: React.RefObject<HTMLElement | null>;
    preferredSide: 'auto' | FloatingSide;
    width: number;
    children: React.ReactNode;
}> = ({ anchorRef, preferredSide, width, children }) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 320, side: 'up' as FloatingSide, ready: false });

    useLayoutEffect(() => {
        const panel = panelRef.current;
        const anchor = anchorRef.current;
        if (!panel || !anchor) return;

        const updatePosition = () => {
            const anchorRect = anchor.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            const viewport = window.visualViewport;
            const viewportWidth = viewport?.width || window.innerWidth;
            const viewportHeight = viewport?.height || window.innerHeight;
            const viewportLeft = viewport?.offsetLeft || 0;
            const viewportTop = viewport?.offsetTop || 0;
            const margin = 12;
            const gap = 10;
            const spaceAbove = anchorRect.top - viewportTop - margin - gap;
            const spaceBelow = viewportTop + viewportHeight - anchorRect.bottom - margin - gap;
            const desiredHeight = Math.max(240, panelRect.height);
            const preferredFits = preferredSide === 'up' ? spaceAbove >= desiredHeight : preferredSide === 'down' ? spaceBelow >= desiredHeight : false;
            const side: FloatingSide = preferredSide === 'auto'
                ? (spaceBelow >= desiredHeight || spaceBelow >= spaceAbove ? 'down' : 'up')
                : preferredFits
                    ? preferredSide
                    : preferredSide === 'up'
                        ? 'down'
                        : 'up';
            const availableHeight = Math.max(180, side === 'up' ? spaceAbove : spaceBelow);
            const renderedHeight = Math.min(panelRect.height, availableHeight);
            const panelWidth = Math.min(width, viewportWidth - margin * 2);
            const idealLeft = anchorRect.left + Math.min(16, Math.max(0, anchorRect.width - panelWidth));
            const left = Math.min(Math.max(idealLeft, viewportLeft + margin), viewportLeft + viewportWidth - panelWidth - margin);
            const top = side === 'up'
                ? Math.max(viewportTop + margin, anchorRect.top - gap - renderedHeight)
                : Math.min(anchorRect.bottom + gap, viewportTop + viewportHeight - renderedHeight - margin);

            setPosition(previous => {
                const next = { left, top, maxHeight: availableHeight, side, ready: true };
                return previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight && previous.side === next.side && previous.ready
                    ? previous
                    : next;
            });
        };

        updatePosition();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
        observer?.observe(anchor);
        observer?.observe(panel);
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        window.visualViewport?.addEventListener('resize', updatePosition);
        window.visualViewport?.addEventListener('scroll', updatePosition);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
            window.visualViewport?.removeEventListener('resize', updatePosition);
            window.visualViewport?.removeEventListener('scroll', updatePosition);
        };
    }, [anchorRef, preferredSide, width]);

    if (typeof document === 'undefined') return null;
    return createPortal(
        <motion.div
            ref={panelRef}
            data-prompt-floating-panel
            data-testid="prompt-floating-panel"
            data-side={position.side}
            data-preferred-side={preferredSide}
            className="theme-aware fixed z-[2000] isl-scrollbar"
            style={{
                left: position.left,
                top: position.top,
                width: `min(${width}px, calc(100vw - 24px))`,
                maxHeight: position.maxHeight,
                visibility: position.ready ? 'visible' : 'hidden',
                overflowY: 'auto',
                overflowX: 'hidden',
                overscrollBehavior: 'contain',
                borderRadius: 24,
                transformOrigin: position.side === 'up' ? 'bottom left' : 'top left',
            }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: position.ready ? 1 : 0, scale: position.ready ? 1 : 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
            onPointerDown={event => event.stopPropagation()}
            onWheel={event => event.stopPropagation()}
        >
            {children}
        </motion.div>,
        document.body,
    );
};

const isSupportedAttachment = (type: string) => type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/');

const SEEDANCE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;

const EMPTY_ATTACHMENTS: ChatAttachment[] = [];

export const PromptBar: React.FC<PromptBarProps> = ({
    t,
    theme,
    language = 'zho',
    compactMode = false,
    prompt,
    promptDocument,
    setPrompt,
    onGenerate,
    onStop,
    isLoading,
    isSelectionActive,
    selectedElementCount,
    userEffects,
    onAddUserEffect,
    onDeleteUserEffect,
    generationMode,
    setGenerationMode,
    imageReferenceChips,
    onImageReferenceReorder,
    onImageReferenceRemove,
    videoAspectRatio,
    setVideoAspectRatio,
    imageAspectRatio = '1:1',
    setImageAspectRatio,
    videoDurationSec = 5,
    onVideoDurationSecChange,
    videoResolution = '720p',
    onVideoResolutionChange,
    videoGenerateAudio = true,
    onVideoGenerateAudioChange,
    videoWatermark = false,
    onVideoWatermarkChange,
    generationSubmode,
    onGenerationSubmodeChange,
    generationQuality = 'high',
    onGenerationQualityChange,
    webSearchEnabled = false,
    onWebSearchToggle,
    realPersonCheckEnabled = true,
    onRealPersonCheckToggle,
    selectedTextModel,
    selectedImageModel,
    selectedVideoModel,
    textModelOptions = [],
    imageModelOptions = [],
    videoModelOptions = [],
    onTextModelChange,
    onImageModelChange,
    onVideoModelChange,
    mentionItems,
    attachments = EMPTY_ATTACHMENTS,
    onAddAttachments,
    onRemoveAttachment,
    onMentionedElementIds,
    onPromptDocumentChange,
    onPromptInputChange,
    onEnhancePrompt,
    isEnhancingPrompt = false,
    isAutoEnhanceEnabled = false,
    onAutoEnhanceToggle,
    onLockCharacterFromSelection,
    canLockCharacter = false,
    characterLocks = [],
    activeCharacterLockId = null,
    onSetActiveCharacterLock,
    apiConfigs = [],
    activeApiConfigId = null,
    activeApiModelId = null,
    onApiConfigChange,
    onApiModelChange,
    userApiKeys = [],
    onOpenSettings,
    batchCount = 1,
    onBatchCountChange,
    allowVideoBatch = false,
    variant = 'global',
    className,
    shellClassName,
    popoverDirection = 'auto',
    modeOptions = ['image', 'video', 'keyframe'],
    onRetry,
    error,
    progressStage,
    providerUsageLabel,
    autoFocus = false,
    focusSignal,
    assetFolders = [],
    assetItems = [],
    assetLibrary,
    referenceItems = [],
    onSelectWorkflowReference,
    onAddReferenceFiles,
    onSelectAsset,
    skillEnabled = false,
}) => {
    const isDark = theme === 'dark';
    const rootRef = useRef<HTMLDivElement>(null);
    const richEditorRef = useRef<RichPromptEditorHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const latestPromptRef = useRef(prompt);

    const [expandedPanel, setExpandedPanel] = useState<ExpandPanel>(null);
    const [isDragActive, setIsDragActive] = useState(false);
    const [referencePickerOpen, setReferencePickerOpen] = useState(false);
    const [referencesExpanded, setReferencesExpanded] = useState(false);
    const [resolvedAttachmentHrefs, setResolvedAttachmentHrefs] = useState<Record<string, string>>({});
    const [modelCapabilityFilter, setModelCapabilityFilter] = useState<ProductModelMode | 'all'>('all');
    const [activeModelFamily, setActiveModelFamily] = useState('');
    const [isTranslating, setIsTranslating] = useState(false);
    const [preTranslatePrompt, setPreTranslatePrompt] = useState<string | null>(null);

    const triggerClass = `inline-flex items-center gap-1 rounded-md px-2 font-bold transition-colors hover:bg-[var(--isl-surface-2)] ${compactMode ? 'h-7 text-[11px]' : 'h-8 text-xs'}`;
    const activeTriggerClass = 'text-[var(--isl-mint-deep)]';
    const popoverWidth = expandedPanel === 'model' ? 660 : expandedPanel === 'submode' ? 360 : expandedPanel === 'parameters' ? 430 : expandedPanel === 'more' ? 480 : expandedPanel === 'batch' ? 300 : 400;
    const shellClass = 'isl-shell';

    const editorReferenceItems = useMemo<MentionItem[]>(() => mentionItems || [], [mentionItems]);

    /** 当前视频模型是否为 Seedance（用于 Fast 限制 1080p 等模型专属逻辑） */
    const videoLikeMode = generationMode === 'video' || generationMode === 'keyframe';
    const activeModel = generationMode === 'text' ? selectedTextModel : videoLikeMode ? selectedVideoModel : selectedImageModel;
    const activeProductModel = useMemo(() => getProductModel(activeModel), [activeModel]);
    const activeRoute = activeProductModel ? resolveAnyProductRoute(activeProductModel.id, userApiKeys) : null;
    const activeCapabilities = useMemo(() => {
        if (!activeProductModel) return undefined;
        const capabilities = activeProductModel.capabilities;
        return activeProductModel.capability === 'video' && ['keling', 'minimax', 'custom', 'openai_compatible'].includes(activeRoute?.key.provider || '')
            ? { ...capabilities, audioControl: 'none' as const }
            : capabilities;
    }, [activeProductModel, activeRoute]);
    /** 图片/视频产品模型按产品家族分组：左侧选家族，右侧渐进披露具体版本。 */
    const productModels = useMemo(
        () => generationMode === 'text' ? [] : getProductModels(videoLikeMode ? 'video' : 'image'),
        [generationMode, videoLikeMode]
    );
    const productModelGroups = useMemo(() => {
        const groups = new Map<string, typeof productModels>();
        productModels.forEach(product => {
            const family = getProductFamily(product);
            groups.set(family, [...(groups.get(family) || []), product]);
        });
        return [...groups].map(([family, models]) => ({ family, company: models[0]?.company || '', models }));
    }, [productModels]);
    const modelCapabilityFilters = useMemo(() => [...new Set(productModels.flatMap(product => product.capabilities.modes))], [productModels]);
    const filteredProductModelGroups = useMemo(() => productModelGroups
        .map(group => ({ ...group, models: group.models.filter(product => modelCapabilityFilter === 'all' || product.capabilities.modes.includes(modelCapabilityFilter)) }))
        .filter(group => group.models.length > 0), [modelCapabilityFilter, productModelGroups]);
    const displayedModelGroup = filteredProductModelGroups.find(group => group.family === activeModelFamily) || filteredProductModelGroups[0];

    useEffect(() => {
        if (!activeProductModel) return;
        setActiveModelFamily(getProductFamily(activeProductModel));
    }, [activeProductModel]);
    /** 当前生效的比例 setter：图片用 imageAspectRatio，视频用 videoAspectRatio */
    const activeRatio = generationMode === 'image' ? imageAspectRatio : videoAspectRatio;
    const setActiveRatio = (ratio: VideoAspectRatio) => {
        if (generationMode === 'image') setImageAspectRatio?.(ratio);
        else setVideoAspectRatio(ratio);
    };
    /** 参数摘要：用于 chip 上显示浓度等信息 */
    const paramSummary = useMemo(() => {
        if (!activeProductModel || !activeCapabilities) return '';
        const parts: string[] = [];
        if (activeProductModel.capability === 'image' && generationQuality) {
            parts.push(generationQuality === 'low' ? '低画面' : generationQuality === 'medium' ? '标准' : '高画面');
        }
        if (activeCapabilities.resolutions.length > 0 && videoResolution) parts.push(videoResolution);
        if (activeCapabilities.aspectRatios.length > 0 && activeRatio) parts.push(activeRatio === 'adaptive' ? '自适应' : activeRatio);
        if (generationMode === 'video' && activeCapabilities.durations.length > 0) parts.push(videoDurationSec === -1 ? '无限时' : `${videoDurationSec}s`);
        if (batchCount > 1) parts.push(`×${batchCount}`);
        return parts.filter(Boolean).join(' · ');
    }, [activeCapabilities, activeProductModel, generationMode, generationQuality, videoResolution, activeRatio, videoDurationSec, batchCount]);
    const isSeedanceVideoModel = useMemo(() => {
        return videoLikeMode && !!selectedVideoModel && modelRefModelId(selectedVideoModel).toLowerCase().includes('seedance');
    }, [selectedVideoModel, videoLikeMode]) || activeProductModel?.id.includes('seedance') === true;
    const isSeedanceFastModel = isSeedanceVideoModel && modelRefModelId(selectedVideoModel).toLowerCase().includes('fast');

    const currentModelOptions = generationMode === 'text' ? textModelOptions : videoLikeMode ? videoModelOptions : imageModelOptions;
    const routedVideoModes = useMemo(() => activeProductModel?.capability === 'video'
        ? getRoutedVideoModes(activeProductModel.id, activeRoute?.key.provider, activeRoute?.routeId)
        : [], [activeProductModel, activeRoute]);
    const activeKey = activeRoute?.key || userApiKeys.find(k => k.isDefault) || userApiKeys[0];
    const estimatedCost = useMemo(() => activeRoute && activeProductModel ? estimateApiCost({
        key: activeRoute.key,
        productModelId: activeProductModel.id,
        routeId: activeRoute.routeId,
        type: activeProductModel.capability,
        durationSec: generationMode === 'video' ? videoDurationSec : undefined,
        count: batchCount,
        resolution: videoResolution,
        quality: generationQuality,
    }) : null, [activeProductModel, activeRoute, batchCount, generationMode, generationQuality, videoDurationSec, videoResolution]);
    const estimatedCostLabel = estimatedCost
        ? `${estimatedCost.currency === 'CNY' ? '¥' : '$'}${estimatedCost.amount < 1 ? estimatedCost.amount.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : estimatedCost.amount.toFixed(2)}`
        : null;
    const mentionedReferences = imageReferenceChips?.filter(reference => reference.mentioned) || [];
    const mentionedImageCount = mentionedReferences.filter(reference => reference.elementType === 'image').length;
    const activeSubmode = generationSubmode || (generationMode === 'video' ? 'text-to-video' : 'text-to-image');
    const videoInputRequirement = generationMode !== 'video' ? null
        : activeSubmode === 'image-to-video' && mentionedImageCount < 1 ? '图生视频需要添加 1 张图片'
            : activeSubmode === 'first-last-frame' && mentionedImageCount < 2 ? '首尾帧需要按顺序添加 2 张图片'
                : activeSubmode === 'reference-to-video' && mentionedReferences.length < 1 ? '全能参考需要添加至少 1 个素材'
                    : null;
    const paramDisabledReason = useCallback((kind: 'resolution' | 'aspectRatio' | 'durationSec', value: string | number): string | null => {
        if (!activeProductModel) return '请先选择模型';
        const base: {
            mode: ProductModelMode;
            aspectRatio?: VideoAspectRatio;
            resolution?: string;
            durationSec?: number;
        } = { mode: activeSubmode };
        if (kind === 'aspectRatio') base.aspectRatio = value as VideoAspectRatio; else base.aspectRatio = activeRatio;
        if (kind === 'resolution') base.resolution = String(value); else base.resolution = videoResolution;
        if (kind === 'durationSec') base.durationSec = Number(value); else base.durationSec = videoDurationSec;
        const probe = sanitizeProductGenerationParams(activeProductModel.id, base);
        return (probe[kind] as string | number) === value ? null : '当前模式下此选项不可用';
    }, [activeProductModel, activeRatio, activeSubmode, videoDurationSec, videoResolution]);
    const changeActiveModel = (model: string) => generationMode === 'text' ? onTextModelChange?.(model) : videoLikeMode ? onVideoModelChange?.(model) : onImageModelChange?.(model);
    const promptCharCount = prompt.trim().length;
    const readyState = !activeKey || (activeProductModel && !activeRoute)
        ? 'missing-key'
        : error
            ? 'error'
            : !prompt.trim()
                ? 'empty'
                : videoInputRequirement
                    ? 'invalid-input'
                : isLoading
                    ? 'generating'
                    : 'ready';
    const readyCopy = readyState === 'missing-key'
        ? '先连接一个 AI 供应商'
        : readyState === 'error'
            ? (error || '生成失败')
            : readyState === 'empty'
                ? '输入你想生成或修改的画面'
                : readyState === 'invalid-input'
                    ? videoInputRequirement
                : readyState === 'generating'
            ? (progressStage || '正在生成，请保持工作流打开')
                    : '准备就绪，Ctrl+Enter 生成';
    const promptHints = isSelectionActive
        ? [`已选中 ${selectedElementCount} 个元素`, '描述“怎么改”比描述“是什么”更有效']
        : attachments.length > 0
            ? [`已添加 ${attachments.length} 个参考`, '可以继续输入 @ 引用工作流节点']
            : ['支持拖入图片/视频/音频参考', '输入 @ 可引用工作流节点'];
    const placeholder = useMemo(() => {
        if (!isSelectionActive) return '使用 @ 引用工作流中的图片，例如：把 @图片1 的人物替换为 @图片2 的兔子';
        if (selectedElementCount === 1) return '描述你想对当前元素做什么';
        return `已选中 ${selectedElementCount} 个元素，补充组合生成描述`;
    }, [isSelectionActive, selectedElementCount]);
    const addReferenceFiles = onAddReferenceFiles || (onAddAttachments ? ((files: File[]) => onAddAttachments(files)) : undefined);
    const canOpenReferencePicker = Boolean(onSelectWorkflowReference || onSelectAsset || addReferenceFiles);

    /** 编辑器文本 + mention 变化时同步到父组件 */
    const handleEditorChange = useCallback((plainText: string, json: Record<string, unknown>) => {
        const mentions = extractMentions(json);
        const uniqueIds = [...new Set(mentions.map(m => m.id))];
        latestPromptRef.current = plainText;
        if (onPromptInputChange) {
            onPromptInputChange({ plainText, document: json, mentionedElementIds: uniqueIds });
            return;
        }
        setPrompt(plainText);
        onPromptDocumentChange?.(json);
        onMentionedElementIds?.(uniqueIds);
    }, [setPrompt, onPromptDocumentChange, onMentionedElementIds, onPromptInputChange]);

    /** 编辑器 Enter 提交 */
    const handleEditorSubmit = useCallback(() => {
        if (latestPromptRef.current.trim() && !isLoading && readyState !== 'missing-key' && !videoInputRequirement) onGenerate();
    }, [isLoading, onGenerate, readyState, videoInputRequirement]);

    const replacePrompt = useCallback((value: string) => {
        latestPromptRef.current = value;
        richEditorRef.current?.setText(value);
        if (onPromptInputChange) {
            onPromptInputChange({ plainText: value, document: { type: 'doc', content: value ? [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] : [] }, mentionedElementIds: [] });
        } else {
            setPrompt(value);
            onPromptDocumentChange?.({ type: 'doc', content: value ? [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] : [] });
            onMentionedElementIds?.([]);
        }
    }, [onMentionedElementIds, onPromptDocumentChange, onPromptInputChange, setPrompt]);

    const handleTranslatePrompt = useCallback(async () => {
        if (!onEnhancePrompt || !prompt.trim() || isTranslating) return;
        const previous = prompt;
        setIsTranslating(true);
        try {
            const result = await onEnhancePrompt({ prompt: prompt.trim(), mode: 'translate' });
            if (result.enhancedPrompt?.trim()) {
                setPreTranslatePrompt(previous);
                replacePrompt(result.enhancedPrompt.trim());
            }
        } finally {
            setIsTranslating(false);
        }
    }, [isTranslating, onEnhancePrompt, prompt, replacePrompt]);

    const handleRevertTranslate = useCallback(() => {
        if (preTranslatePrompt == null) return;
        replacePrompt(preTranslatePrompt);
        setPreTranslatePrompt(null);
    }, [preTranslatePrompt, replacePrompt]);

    useEffect(() => {
        if (!activeProductModel || !activeCapabilities || generationMode === 'text') return;
        const capabilities = activeCapabilities;
        const availableModes = generationMode === 'video' && routedVideoModes.length ? routedVideoModes : capabilities.modes;
        if (!availableModes.includes(activeSubmode)) {
            onGenerationSubmodeChange?.(availableModes[0]);
        }
        if (activeRatio && !capabilities.aspectRatios.includes(activeRatio)) {
            setActiveRatio(capabilities.aspectRatios[0]);
        }
        const normalized = sanitizeProductGenerationParams(activeProductModel.id, {
            mode: activeSubmode,
            aspectRatio: activeRatio,
            resolution: videoResolution,
            durationSec: videoDurationSec,
        });
        if (normalized.resolution && normalized.resolution !== videoResolution) {
            onVideoResolutionChange?.(normalized.resolution);
        }
        if (generationMode === 'video' && normalized.durationSec !== undefined && normalized.durationSec !== videoDurationSec) {
            onVideoDurationSecChange?.(normalized.durationSec);
        }
    }, [activeCapabilities, activeProductModel, activeRatio, activeSubmode, generationMode, onGenerationSubmodeChange, onVideoDurationSecChange, onVideoResolutionChange, routedVideoModes, setActiveRatio, videoDurationSec, videoResolution]);

    const prevFocusSignalRef = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (prevFocusSignalRef.current === undefined) {
            prevFocusSignalRef.current = focusSignal;
            if (autoFocus) richEditorRef.current?.focus();
            return;
        }
        if (prevFocusSignalRef.current !== focusSignal) richEditorRef.current?.focus();
        prevFocusSignalRef.current = focusSignal;
    }, [autoFocus, focusSignal]);

    /** 外部 prompt 被清空时（如切换画板、生成完成后），同步清空富文本编辑器 */
    useEffect(() => {
        latestPromptRef.current = prompt;
        if (!richEditorRef.current) return;

        const editor = richEditorRef.current;
        if (promptDocument) {
            const currentDocument = editor.getJSON();
            if (JSON.stringify(currentDocument) !== JSON.stringify(promptDocument)) {
                editor.setDocument(promptDocument);
            }
            return;
        }

        const editorText = editor.getText();
        if (!prompt && editorText) {
            editor.clear();
            return;
        }
        if (prompt && editorText !== prompt) {
            editor.setText(prompt);
        }
    }, [prompt, promptDocument]);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node;
            const isInsideFloatingPanel = target instanceof window.Element && !!target.closest('[data-prompt-floating-panel]');
            if (rootRef.current && !rootRef.current.contains(target) && !isInsideFloatingPanel) {
                setExpandedPanel(null);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setExpandedPanel(null);
        };

        document.addEventListener('mousedown', handleOutsideClick);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    useEffect(() => {
        if (!attachments.length) {
            setResolvedAttachmentHrefs(current => Object.keys(current).length ? {} : current);
            return;
        }
        let isMounted = true;
        const resolvePreviews = async () => {
            const entries = await Promise.all(attachments.map(async attachment => {
                if (!attachment.href.startsWith('cold-media:')) return [attachment.id, attachment.href] as const;
                const hydrated = await readColdMedia(attachment.href.slice('cold-media:'.length));
                return [attachment.id, hydrated || attachment.href] as const;
            }));
            if (isMounted) setResolvedAttachmentHrefs(Object.fromEntries(entries));
        };
        void resolvePreviews();
        return () => { isMounted = false; };
    }, [attachments]);

    const handleSaveEffect = useCallback(() => {
        if (!prompt.trim()) return;
        const name = window.prompt('给这个提示词起个名字', `我的效果 ${userEffects.length + 1}`);
        if (!name?.trim()) return;

        onAddUserEffect({
            id: `effect_${Date.now()}`,
            name: name.trim(),
            value: prompt.trim(),
        });
    }, [onAddUserEffect, prompt, userEffects.length]);

    const handleDropFiles = useCallback((files: FileList | File[]) => {
        if (!onAddAttachments) return;
        const media = Array.from(files).filter(file => isSupportedAttachment(file.type));
        if (media.length > 0) {
            onAddAttachments(media);
        }
    }, [onAddAttachments]);

    return (
        <div ref={rootRef} className={`theme-aware w-full ${className || ''}`.trim()}>
            <div
                className={`relative overflow-visible border transition-all duration-300 ${shellClass} ${shellClassName || ''} ${isDragActive ? (isDark ? 'scale-[1.01] border-[#4B5B78]' : 'scale-[1.01] border-[#B2CCFF]') : ''}`.trim()}
                onDragEnter={event => {
                    if (!Array.from(event.dataTransfer.items).some(item => isSupportedAttachment(item.type))) return;
                    event.preventDefault();
                    dragDepthRef.current += 1;
                    setIsDragActive(true);
                }}
                onDragOver={event => {
                    if (!Array.from(event.dataTransfer.items).some(item => isSupportedAttachment(item.type))) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                }}
                onDragLeave={event => {
                    if (!Array.from(event.dataTransfer.items).some(item => isSupportedAttachment(item.type))) return;
                    event.preventDefault();
                    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                    if (dragDepthRef.current === 0) setIsDragActive(false);
                }}
                onDrop={event => {
                    event.preventDefault();
                    dragDepthRef.current = 0;
                    setIsDragActive(false);
                    if (event.dataTransfer.files?.length) handleDropFiles(event.dataTransfer.files);
                }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,audio/*"
                    multiple
                    className="hidden"
                    title="上传参考媒体"
                    aria-label="上传参考媒体"
                    onChange={event => {
                        if (event.target.files?.length) {
                            handleDropFiles(event.target.files);
                            event.target.value = '';
                        }
                    }}
                />

                {isDragActive && (
                    <div className="pointer-events-none absolute inset-3 z-20 rounded-[20px] border-[1.5px] border-dashed backdrop-blur-sm" style={{ borderColor: 'var(--isl-mint)', background: 'var(--isl-mint-bg)' }}>
                        <div className="flex h-full items-center justify-center">
                            <div className="isl-chip px-4 py-2 text-sm">松手上传参考媒体</div>
                        </div>
                    </div>
                )}

                <div
                    className={`relative ${compactMode ? 'px-3 pt-2.5' : 'px-3.5 pt-3'}`}
                    style={{
                        '--prompt-editor-color': 'var(--isl-ink)',
                        '--prompt-editor-placeholder': 'var(--isl-ink-ghost)',
                        '--prompt-editor-caret': 'var(--isl-mint-deep)',
                        '--prompt-editor-scrollbar': isDark ? '#4a3a26' : '#e3d7bd',
                        '--prompt-editor-min-height': compactMode ? '42px' : '48px',
                        '--prompt-editor-font-size': compactMode ? '13px' : '14px',
                        '--prompt-editor-line-height': compactMode ? '1.4' : '1.5',
                    } as React.CSSProperties}
                >
                    {(canOpenReferencePicker || (imageReferenceChips?.length || 0) > 0) && (
                        <div
                            className={`${compactMode ? 'mb-1.5' : 'mb-2.5'} flex min-h-14 items-center overflow-x-auto overflow-y-visible px-1 pt-1 isl-scrollbar pb-1`}
                            data-testid="prompt-image-refs"
                            data-layout={(imageReferenceChips?.length || 0) > 1 ? 'jimeng-stack' : (imageReferenceChips?.length || 0) === 1 ? 'single' : 'empty'}
                            onMouseEnter={() => setReferencesExpanded(true)}
                            onMouseLeave={() => setReferencesExpanded(false)}
                        >
                            {canOpenReferencePicker && (
                                <motion.button
                                    type="button"
                                    whileTap={{ scale: 0.92 }}
                                    onClick={() => setReferencePickerOpen(true)}
                                    className="mr-2 flex h-12 w-12 shrink-0 -rotate-3 items-center justify-center rounded-[10px] border border-dashed text-xl font-light transition hover:rotate-0 hover:border-[var(--isl-mint)] hover:bg-[var(--isl-mint-bg)]"
                                    style={{ borderColor: 'var(--isl-border)', color: 'var(--isl-ink-soft)', background: 'var(--isl-surface-2)' }}
                                aria-label="添加工作流参考"
                                title="从工作流节点、资产管理或本地上传添加参考"
                                    data-testid="prompt-reference-add"
                                >+
                                </motion.button>
                            )}
                            {imageReferenceChips && imageReferenceChips.length > 0 && onImageReferenceReorder && (
                              <Reorder.Group
                                axis="x"
                                values={imageReferenceChips}
                                onReorder={next => onImageReferenceReorder(next.map(chip => chip.id))}
                                className="m-0 flex list-none items-center p-0 pr-2"
                                data-expanded={referencesExpanded}
                              >
                                {imageReferenceChips.map((chip, index) => (
                                    <Reorder.Item
                                        key={chip.id}
                                        value={chip}
                                        layout
                                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                                        className="group relative flex h-12 w-12 shrink-0 list-none items-center overflow-visible rounded-[10px] border shadow-sm"
                                        style={{
                                            borderColor: chip.mentioned ? 'var(--isl-mint)' : 'var(--isl-border)',
                                            background: chip.mentioned ? 'var(--isl-mint-bg)' : 'var(--isl-surface-2)',
                                            cursor: 'grab',
                                            marginLeft: index === 0 ? 0 : referencesExpanded || imageReferenceChips.length === 1 ? 7 : -27,
                                            zIndex: index + 1,
                                            transform: referencesExpanded || imageReferenceChips.length === 1 ? 'rotate(0deg)' : `rotate(${index % 2 ? 5 : -5}deg)`,
                                        }}
                                        title={chip.mentioned ? `${chip.label} · 已加入 Provider 参考` : `${chip.label} · 已连线，输入 @${chip.label} 可加入生成参考`}
                                        whileDrag={{ scale: 1.06, boxShadow: '0 6px 18px rgba(99,102,241,0.18)' }}
                                    >
                                        <div className="h-full w-full overflow-hidden rounded-[9px]">
                                            <ReferenceChipPreview chip={chip} />
                                        </div>
                                        <span className="absolute bottom-0.5 left-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black shadow" style={{ background: chip.mentioned ? 'var(--isl-mint-deep)' : 'var(--isl-surface)', color: chip.mentioned ? '#fff' : 'var(--isl-ink-soft)' }}>{index + 1}</span>
                                        {onImageReferenceRemove && (
                                            <button
                                                type="button"
                                                onClick={event => { event.stopPropagation(); onImageReferenceRemove(chip.id); }}
                                                onPointerDown={event => event.stopPropagation()}
                                                className={`absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border shadow transition ${imageReferenceChips.length === 1 || referencesExpanded ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
                                                style={{ color: 'var(--isl-ink)', borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}
                                                title="断开该参考图连线"
                                                aria-label={`移除参考图 ${chip.label}`}
                                            >
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                            </button>
                                        )}
                                    </Reorder.Item>
                                ))}
                              </Reorder.Group>
                            )}
                        </div>
                    )}

                    <RichPromptEditor
                        ref={richEditorRef}
                        referenceItems={editorReferenceItems}
                        placeholder={placeholder}
                        onTextChange={handleEditorChange}
                        onSubmit={handleEditorSubmit}
                        initialText={prompt}
                        initialDocument={promptDocument}
                        assetFolders={assetFolders}
                        assetItems={assetItems}
                        onSelectAsset={onSelectAsset}
                        skillEnabled={skillEnabled}
                    />

                    {variant !== 'inline' && (
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--isl-ink-soft)', fontFamily: 'var(--isl-font)' }}>
                            <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{ background: readyState === 'ready' ? 'var(--isl-mint)' : readyState === 'error' ? 'var(--isl-coral)' : readyState === 'missing-key' ? 'var(--isl-coral)' : readyState === 'generating' ? 'var(--isl-sun)' : 'var(--isl-ink-ghost)' }}
                            />
                            <span className="truncate font-semibold">{readyState === 'ready' ? promptHints[0] : readyCopy}</span>
                            {promptCharCount > 0 && <span className="ml-auto tabular-nums" style={{ color: 'var(--isl-ink-ghost)' }}>{promptCharCount}</span>}
                        </div>
                    )}

                    {attachments.length > 0 && (
                        <div className={`space-y-2 pb-1 ${compactMode ? 'mt-2' : 'mt-2.5'}`}>
                            <div className="flex flex-wrap gap-1.5">
                                {attachments.map(attachment => (
                                    <div
                                        key={attachment.id}
                                        className="group flex items-center gap-2 rounded-[14px] border-[1.5px] px-2 py-1.5 transition-all duration-200 hover:-translate-y-0.5"
                                        style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)' }}
                                    >
                                        <div className="h-8 w-8 overflow-hidden rounded-lg border bg-white" style={{ borderColor: 'var(--isl-border)' }}>
                                            {attachment.mimeType.startsWith('audio/') ? (
                                                <div className="flex h-full w-full items-center justify-center text-xs font-bold" style={{ color: 'var(--isl-mint-deep)', background: 'var(--isl-mint-bg)' }}>AU</div>
                                            ) : attachment.mimeType.startsWith('video/') ? (
                                                <video src={resolvedAttachmentHrefs[attachment.id] || attachment.href} className="h-full w-full object-cover" muted playsInline />
                                            ) : (
                                                <img src={resolvedAttachmentHrefs[attachment.id] || attachment.href} alt={attachment.name} className="h-full w-full object-cover" />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="max-w-[120px] truncate text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>{attachment.name}</div>
                                            <div className="text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>{attachment.mimeType.startsWith('audio/') ? '参考音频' : attachment.mimeType.startsWith('video/') ? '参考视频' : '参考图'}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onRemoveAttachment?.(attachment.id)}
                                            className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-black/5"
                                            style={{ color: 'var(--isl-ink-soft)' }}
                                            title="移除参考媒体"
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M18 6 6 18" />
                                                <path d="m6 6 12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {expandedPanel && (
                    <AdaptivePromptPopover anchorRef={rootRef} preferredSide={popoverDirection} width={popoverWidth}>
                        <div
                            data-panel={expandedPanel}
                            className="isl-pop"
                        >
                            <div className={compactMode ? 'p-2.5' : 'p-4'} onWheel={event => event.stopPropagation()}>
                            {expandedPanel === 'model' && (
                                <>
                                    <div className="mb-2 px-1 text-xs font-extrabold" style={{ color: 'var(--isl-ink)' }}>选择模型</div>
                                    <div data-testid="prompt-model-progressive" data-density="compact" className="flex h-[310px] max-h-[68vh] overflow-hidden rounded-[14px] border" style={{ borderColor: 'var(--isl-border)' }}>
                                        {productModels.length > 0 ? (
                                            <>
                                                <div className="w-[245px] shrink-0 border-r p-1.5" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-sunk)' }}>
                                                    <div className="px-1.5 pb-1 pt-0.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>筛选</div>
                                                    <div className="mb-1.5 flex flex-wrap gap-1 px-0.5">
                                                        <button type="button" onClick={() => setModelCapabilityFilter('all')} className={`h-6 rounded-full px-2 text-[10px] font-bold ${modelCapabilityFilter === 'all' ? 'isl-chip--active' : 'isl-chip'}`}>全部</button>
                                                        {modelCapabilityFilters.map(mode => <button key={mode} type="button" onClick={() => setModelCapabilityFilter(mode)} className={`h-6 rounded-full px-2 text-[10px] font-bold ${modelCapabilityFilter === mode ? 'isl-chip--active' : 'isl-chip'}`}>{PRODUCT_MODE_LABELS[mode]}</button>)}
                                                    </div>
                                                    <div className="max-h-[250px] space-y-px overflow-y-auto pr-0.5 isl-scrollbar">
                                                        {filteredProductModelGroups.map(group => {
                                                            const active = displayedModelGroup?.family === group.family;
                                                            const connectedCount = group.models.filter(product => isProductModelConfigured(product.id, userApiKeys)).length;
                                                            return <button
                                                                key={group.family}
                                                                type="button"
                                                                onMouseEnter={() => setActiveModelFamily(group.family)}
                                                                onFocus={() => setActiveModelFamily(group.family)}
                                                                onClick={() => setActiveModelFamily(group.family)}
                                                                className={`flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left transition ${active ? 'bg-[var(--isl-mint-bg)] text-[var(--isl-mint-deep)]' : 'hover:bg-[var(--isl-surface-2)]'}`}
                                                            >
                                                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[8px] font-black" style={{ background: active ? 'var(--isl-mint)' : 'var(--isl-surface-2)', color: active ? '#fff' : 'var(--isl-ink-soft)' }}>{group.family.slice(0, 2).toUpperCase()}</span>
                                                                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-extrabold" style={{ color: active ? 'var(--isl-mint-deep)' : 'var(--isl-ink)' }}>{group.family}</span><span className="block text-[8px]" style={{ color: 'var(--isl-ink-ghost)' }}>{group.company} · {connectedCount}/{group.models.length}</span></span>
                                                                <span aria-hidden="true" style={{ color: 'var(--isl-ink-ghost)' }}>›</span>
                                                            </button>;
                                                        })}
                                                    </div>
                                                </div>
                                                <div className="min-w-0 flex-1 p-1.5" style={{ background: 'var(--isl-surface)' }}>
                                                    <div className="px-1.5 pb-1 pt-0.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>{displayedModelGroup?.family || '模型版本'}</div>
                                                    <div className="max-h-[275px] space-y-0.5 overflow-y-auto pr-0.5 isl-scrollbar">
                                                        {displayedModelGroup?.models.map(product => {
                                                            const configured = isProductModelConfigured(product.id, userApiKeys);
                                                            const selected = activeModel === product.id || getProductModel(activeModel)?.id === product.id;
                                                            const route = resolveAnyProductRoute(product.id, userApiKeys);
                                                            return <button key={product.id} type="button" onClick={() => {
                                                                if (!configured) { onOpenSettings?.(); setExpandedPanel(null); return; }
                                                                changeActiveModel(product.id);
                                                                setExpandedPanel(null);
                                                            }} className={`w-full rounded-lg border px-2.5 py-1.5 text-left transition ${selected ? 'border-[var(--isl-mint)] bg-[var(--isl-mint-bg)]' : 'border-transparent hover:border-[var(--isl-border)] hover:bg-[var(--isl-surface-2)]'} ${configured ? '' : 'opacity-55'}`}>
                                                                <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-extrabold" style={{ color: selected ? 'var(--isl-mint-deep)' : 'var(--isl-ink)' }}>{product.name}</span><span className="shrink-0 text-[9px] font-bold" style={{ color: configured ? 'var(--isl-mint-deep)' : 'var(--isl-ink-ghost)' }}>{configured ? product.badge || '已连接' : '去配置'}</span></span>
                                                                <span className="mt-0.5 flex flex-wrap gap-0.5">{product.capabilities.modes.map(mode => <span key={mode} className="rounded-full px-1.5 py-px text-[8px]" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)' }}>{PRODUCT_MODE_LABELS[mode]}</span>)}</span>
                                                                {route && <span className="mt-0.5 block truncate text-[8px]" style={{ color: 'var(--isl-ink-ghost)' }}>{route.key.name || route.key.provider} · {route.routeId}</span>}
                                                            </button>;
                                                        })}
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="w-full p-2">
                                                <div className="px-2 pb-2 text-[11px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>选择模型</div>
                                                {currentModelOptions.map(model => <button key={model} type="button" onClick={() => { changeActiveModel(model); setExpandedPanel(null); }} className={`mb-1 w-full rounded-xl border px-3 py-3 text-left text-xs font-bold ${activeModel === model ? 'border-[var(--isl-mint)] bg-[var(--isl-mint-bg)] text-[var(--isl-mint-deep)]' : 'border-transparent text-[var(--isl-ink)] hover:bg-[var(--isl-surface-2)]'}`}>{modelRefLabel(model, userApiKeys)}</button>)}
                                                {currentModelOptions.length === 0 && <div className="px-4 py-12 text-center text-xs" style={{ color: 'var(--isl-ink-soft)' }}>没有可用模型</div>}
                                            </div>
                                        )}
                                    </div>
                                    {!activeRoute && activeProductModel && (
                                        <button type="button" onClick={onOpenSettings} className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center justify-between rounded-[14px] bg-[var(--isl-surface-2)] px-3 py-2 text-xs font-bold">
                                            <span>{activeProductModel.name} 尚未映射 API 线路</span><span>去配置 →</span>
                                        </button>
                                    )}
                                </>
                            )}
                            {expandedPanel === 'submode' && generationMode === 'video' && (
                                <div data-testid="prompt-video-mode-panel" data-density="compact">
                                    <div className="mb-2 px-1 text-xs font-extrabold" style={{ color: 'var(--isl-ink)' }}>生成方式</div>
                                    <div className="grid grid-cols-2 gap-1.5 px-0.5 pb-0.5">
                                        {VIDEO_MODE_ORDER.map(mode => {
                                            const supported = !!activeProductModel && routedVideoModes.includes(mode);
                                            const reason = !activeProductModel
                                                ? '请先选择视频模型'
                                                : (explainUnsupportedVideoMode(activeProductModel.id, mode) || '当前 API 路由不支持该模式');
                                            return (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    aria-pressed={activeSubmode === mode}
                                                    disabled={!supported}
                                                    title={!supported ? reason : undefined}
                                                    onClick={() => { if (!supported) return; onGenerationSubmodeChange?.(mode); setExpandedPanel(null); }}
                                                    className={`h-8 rounded-[10px] px-2 text-[11px] font-bold transition ${!supported ? 'cursor-not-allowed opacity-35' : ''} ${activeSubmode === mode ? 'isl-chip--active' : 'isl-chip'}`}
                                                >
                                                    {PRODUCT_MODE_LABELS[mode]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-1.5 rounded-[10px] bg-[var(--isl-surface-2)] px-2.5 py-2 text-[10px] leading-4 text-[var(--isl-ink-soft)]">
                                        {activeSubmode === 'image-to-video' && '第一个有序图片引用作为首帧。'}
                                        {activeSubmode === 'reference-to-video' && '图片、视频或音频作为主体与风格参考，不当作首帧。'}
                                        {activeSubmode === 'first-last-frame' && '按引用顺序使用前两张图片作为首帧和尾帧。'}
                                        {activeSubmode === 'video-extension' && '使用上游视频作为扩展输入。'}
                                        {activeSubmode === 'text-to-video' && '只使用文字提示生成视频。'}
                                        {videoInputRequirement && <div className="mt-1 font-bold text-[var(--isl-coral-deep)]">{videoInputRequirement}</div>}
                                    </div>
                                </div>
                            )}
                            {expandedPanel === 'parameters' && activeProductModel && activeCapabilities && (
                                <>
                                    <div className="mb-2 px-1 text-xs font-extrabold" style={{ color: 'var(--isl-ink)' }}>生成参数</div>
                                    <div data-testid="prompt-parameter-panel" data-density="compact" className="space-y-2 px-0.5 pb-0.5">
                                        {activeCapabilities.qualities.length > 0 && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>画质</div>
                                                <div className="grid grid-cols-3 gap-1.5">
                                                    {activeCapabilities.qualities.map(quality => (
                                                        <button key={quality} type="button" onClick={() => onGenerationQualityChange?.(quality)} className={`h-8 rounded-[10px] px-2 text-[11px] font-bold ${generationQuality === quality ? 'isl-chip--active' : 'isl-chip'}`}>{quality === 'low' ? '低画质' : quality === 'medium' ? '标准画质' : '高画质'}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
{activeCapabilities.resolutions.length > 0 && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>{generationMode === 'video' ? '分辨率' : '尺寸'}</div>
                                                <div className="grid grid-cols-3 gap-1.5">
                                                    {activeCapabilities.resolutions.map(resolution => {
                                                        const disabledReason = paramDisabledReason('resolution', resolution);
                                                        return (
                                                            <button
                                                                key={resolution}
                                                                type="button"
                                                                disabled={!!disabledReason}
                                                                title={disabledReason || undefined}
                                                                onClick={() => { if (!disabledReason) onVideoResolutionChange?.(resolution); }}
                                                                className={`h-8 rounded-[10px] px-2 text-[11px] font-bold transition ${disabledReason ? 'cursor-not-allowed opacity-35' : ''} ${videoResolution === resolution ? 'isl-chip--active' : 'isl-chip'}`}
                                                            >
                                                                {resolution}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {activeCapabilities.aspectRatios.length > 0 && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>比例</div>
                                                <div className="grid grid-cols-4 gap-1.5">
                                                    {activeCapabilities.aspectRatios.map(ratio => {
                                                        const disabledReason = paramDisabledReason('aspectRatio', ratio);
                                                        return (
                                                            <button
                                                                key={ratio}
                                                                type="button"
                                                                disabled={!!disabledReason}
                                                                title={disabledReason || undefined}
                                                                onClick={() => { if (!disabledReason) setActiveRatio(ratio); }}
                                                                className={`h-8 rounded-[10px] px-1.5 text-[11px] font-bold transition ${disabledReason ? 'cursor-not-allowed opacity-35' : ''} ${activeRatio === ratio ? 'isl-chip--active' : 'isl-chip'}`}
                                                            >
                                                                {ratio === 'adaptive' ? '自适应' : ratio}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
{generationMode === 'video' && activeCapabilities.durations.length > 0 && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>时长</div>
                                                <div className="grid grid-cols-4 gap-1.5">
                                                    {activeCapabilities.durations.map(duration => {
                                                        const disabledReason = paramDisabledReason('durationSec', duration);
                                                        return (
                                                            <button
                                                                key={duration}
                                                                type="button"
                                                                disabled={!!disabledReason}
                                                                title={disabledReason || (duration === -1 ? '不限' : `${duration} 秒`)}
                                                                onClick={() => { if (!disabledReason) onVideoDurationSecChange?.(duration); }}
                                                                className={`h-8 rounded-[10px] px-2 text-[11px] font-bold transition ${disabledReason ? 'cursor-not-allowed opacity-35' : ''} ${videoDurationSec === duration ? 'isl-chip--active' : 'isl-chip'}`}
                                                            >
                                                                {duration === -1 ? '不限' : `${duration}s`}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {generationMode === 'video' && activeCapabilities.audioControl === 'optional' && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>生成音频</div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <button type="button" aria-pressed={videoGenerateAudio} onClick={() => onVideoGenerateAudioChange?.(true)} className={`h-8 rounded-[10px] px-2 text-[11px] font-bold ${videoGenerateAudio ? 'isl-chip--active' : 'isl-chip'}`}>开启</button>
                                                    <button type="button" aria-pressed={!videoGenerateAudio} onClick={() => onVideoGenerateAudioChange?.(false)} className={`h-8 rounded-[10px] px-2 text-[11px] font-bold ${!videoGenerateAudio ? 'isl-chip--active' : 'isl-chip'}`}>关闭</button>
                                                </div>
                                            </div>
                                        )}
                                        {generationMode === 'video' && activeCapabilities.audioControl === 'always' && <div className="rounded-[14px] bg-[var(--isl-surface-2)] px-3 py-2 text-xs font-bold text-[var(--isl-ink-soft)]">该模型始终生成原生音频</div>}
                                        {activeProductModel.id.startsWith('flovart:veo-3.1') && (activeSubmode === 'reference-to-video' || videoResolution?.toLowerCase() !== '720p') && <div className="rounded-[14px] bg-[var(--isl-mint-bg)] px-3 py-2 text-[11px] font-semibold text-[var(--isl-mint-deep)]">当前 Veo 组合按官方约束固定为 8 秒。</div>}
                                    </div>
                                </>
                            )}
                            {expandedPanel === 'more' && (
                                <>
                                    {activeProductModel && activeCapabilities && (activeCapabilities.supportsWebSearch || activeCapabilities.supportsRealPersonCheck) && (
                                        <div className="mb-2 space-y-1 border-b border-[var(--isl-border)] pb-2">
                                            <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--isl-ink-soft)' }}>高级选项</div>
                                            {activeCapabilities.supportsWebSearch && (
                                                <button type="button" onClick={() => onWebSearchToggle?.(!webSearchEnabled)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-bold transition-colors hover:bg-[var(--isl-surface-2)] ${webSearchEnabled ? 'text-[var(--isl-mint-deep)]' : ''}`}><span>联网搜索</span><span>{webSearchEnabled ? 'ON' : 'OFF'}</span></button>
                                            )}
                                            {activeCapabilities.supportsRealPersonCheck && (
                                                <button type="button" onClick={() => onRealPersonCheckToggle?.(!realPersonCheckEnabled)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-bold transition-colors hover:bg-[var(--isl-surface-2)] ${realPersonCheckEnabled ? 'text-[var(--isl-mint-deep)]' : ''}`}><span>真人素材预检测</span><span>{realPersonCheckEnabled ? 'ON' : 'OFF'}</span></button>
                                            )}
                                        </div>
                                    )}
                                    <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--isl-ink-soft)' }}>更多操作</div>
                                    {isSeedanceVideoModel && !activeProductModel && (
                                        <div className="mx-1 mb-2 rounded-[18px] border-[1.5px] p-3" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)' }}>
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>Seedance 视频参数</div>
                                                    <div className="mt-0.5 text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>分辨率、声音、水印</div>
                                                </div>
                                                {isSeedanceFastModel && (
                                                    <span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ color: 'var(--isl-sun-deep)', background: 'rgba(251,191,36,0.14)' }}>
                                                        Fast 最高 720p
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-3">
                                                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--isl-ink-soft)' }}>分辨率</div>
                                                <div className="grid grid-cols-3 gap-1.5">
                                                    {SEEDANCE_RESOLUTIONS.map(resolution => {
                                                        const disabled = isSeedanceFastModel && resolution === '1080p';
                                                        return (
                                                            <button
                                                                key={resolution}
                                                                type="button"
                                                                disabled={disabled}
                                                                onClick={() => onVideoResolutionChange?.(resolution)}
                                                                className={`rounded-[12px] px-2 py-1.5 text-xs font-bold transition ${disabled ? 'cursor-not-allowed opacity-35' : ''} ${videoResolution === resolution ? 'isl-chip--active' : 'isl-chip'}`}
                                                                title={disabled ? 'Fast 模型不支持 1080p，会自动降到 720p' : resolution}
                                                            >
                                                                {resolution}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <div className="mt-3 grid grid-cols-2 gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => onVideoGenerateAudioChange?.(!videoGenerateAudio)}
                                                    className={`rounded-[12px] px-3 py-2 text-left text-xs font-bold transition ${videoGenerateAudio ? 'isl-chip--active' : 'isl-chip'}`}
                                                    aria-pressed={videoGenerateAudio}
                                                >
                                                    生成声音 {videoGenerateAudio ? 'ON' : 'OFF'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onVideoWatermarkChange?.(!videoWatermark)}
                                                    className={`rounded-[12px] px-3 py-2 text-left text-xs font-bold transition ${videoWatermark ? 'isl-chip--active' : 'isl-chip'}`}
                                                    aria-pressed={videoWatermark}
                                                >
                                                    水印 {videoWatermark ? 'ON' : 'OFF'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    <div className="space-y-1">
                                        {userApiKeys.length > 0 && (
                                            <MenuOptionButton
                                                label={`API Key · ${userApiKeys.length} 个`}
                                                description={userApiKeys.find(k => k.isDefault)?.name || '点击打开设置管理 Key 与映射'}
                                                onClick={() => { onOpenSettings?.(); setExpandedPanel(null); }}
                                            />
                                        )}
                                        {canOpenReferencePicker && (
                                            <MenuOptionButton
                                            label="添加工作流参考"
                                            description="从工作流节点、资产管理或本地上传"
                                                onClick={() => {
                                                    setReferencePickerOpen(true);
                                                    setExpandedPanel(null);
                                                }}
                                            />
                                        )}

                                        {onLockCharacterFromSelection && (
                                            <MenuOptionButton
                                                label="从当前选择锁定角色"
                                                description={canLockCharacter ? '把当前图片保存为后续生成参考' : '先选中一张图片元素'}
                                                onClick={() => onLockCharacterFromSelection()}
                                            />
                                        )}

                                        {characterLocks.length > 0 && (
                                            <>
                                                <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#98A2B3]">角色锁定</div>
                                                <MenuOptionButton label="不使用角色锁定" active={activeCharacterLockId == null} onClick={() => onSetActiveCharacterLock?.(null)} />
                                                {characterLocks.map(lock => <MenuOptionButton key={lock.id} label={lock.name} active={activeCharacterLockId === lock.id} onClick={() => onSetActiveCharacterLock?.(lock.id)} />)}
                                            </>
                                        )}

                                        {variant !== 'inline' && (
                                            <MenuOptionButton label="保存当前提示词" description="存成一个可复用效果" onClick={handleSaveEffect} />
                                        )}

                                        {userEffects.length > 0 && (
                                            <div className="max-h-40 space-y-1 overflow-y-auto pt-2 pr-1">
                                                {userEffects.map(effect => (
                                                    <div key={effect.id} className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--isl-surface-2)' }}>
                                                        <button
                                                            type="button"
                                                            className="min-w-0 flex-1 text-left"
                                                            onClick={() => {
                                                                replacePrompt(effect.value);
                                                                setExpandedPanel(null);
                                                            }}
                                                        >
                                                            <div className="truncate text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>{effect.name}</div>
                                                            <div className="truncate text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{effect.value}</div>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => onDeleteUserEffect(effect.id)}
                                                            className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-black/5"
                                                            style={{ color: 'var(--isl-ink-soft)' }}
                                                            title="删除已保存提示词"
                                                        >
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <path d="M18 6 6 18" />
                                                                <path d="m6 6 12 12" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {editorReferenceItems.length > 0 && (
                                            <div className="rounded-2xl px-3 py-3 text-sm" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)' }}>
                                                在输入框里输入 <span className="font-bold" style={{ color: 'var(--isl-mint-deep)' }}>@</span>，可直接引用工作流节点或资产。
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                            {expandedPanel === 'batch' && onBatchCountChange && (
                                <div className="px-1">
                                    <div className="mb-2 text-xs font-extrabold" style={{ color: 'var(--isl-ink)' }}>批量方案数量</div>
                                    <div className="flex items-center gap-2">
                                        {[1, 2, 4].map(count => {
                                            const active = batchCount === count;
                                            return (
                                                <button
                                                    key={count}
                                                    type="button"
                                                    onClick={() => { onBatchCountChange(count); setExpandedPanel(null); }}
                                                    className={`flex h-12 min-w-[56px] flex-1 items-center justify-center rounded-[16px] px-3 text-sm font-bold transition ${active ? 'isl-chip--active' : 'isl-chip'}`}
                                                    style={active ? undefined : { color: 'var(--isl-ink-soft)' }}
                                                    aria-pressed={active}
                                                    title={count === 1 ? '单张方案' : `输出 ${count} 张方案`}
                                                >
                                                    ×{count}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            </div>
                        </div>
                    </AdaptivePromptPopover>
                )}

                <div className={`relative flex items-center gap-2 border-t ${compactMode ? 'px-2.5 py-2' : 'px-3 py-2.5'}`} style={{ borderColor: 'var(--isl-border)' }}>
                    <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto isl-scrollbar">
                            {(() => {
                                const keyCount = userApiKeys.length;
                                if (keyCount === 0) {
                                    return (
                                        <button
                                            type="button"
                                            onClick={onOpenSettings}
                                            className={`${triggerClass} shrink-0 ${compactMode ? 'h-7 w-7 px-0 text-[11px]' : 'h-8 px-3 text-xs'}`}
                                            style={{ color: 'var(--isl-coral-deep)' }}
                                            aria-label="配置 API Key"
                                            title="尚未配置 API Key，点击打开设置"
                                        >
                                            🔑<span className={compactMode ? 'sr-only' : 'ml-1'}>未配置 API Key</span>
                                        </button>
                                    );
                                }
                                return null;
                            })()}

                            <div className="relative">
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'model'} onClick={() => setExpandedPanel(prev => (prev === 'model' ? null : 'model'))} className={`${triggerClass} shrink-0 ${expandedPanel === 'model' ? activeTriggerClass : ''}`}>
                                    <span className="max-w-[150px] truncate">{getModelLabel(generationMode, selectedTextModel, selectedImageModel, selectedVideoModel, userApiKeys)}</span>
                                    
                                </button>
                            </div>

                            {generationMode === 'video' && VIDEO_MODE_ORDER.length > 1 && (
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'submode'} onClick={() => setExpandedPanel(prev => (prev === 'submode' ? null : 'submode'))} className={`${triggerClass} shrink-0 ${expandedPanel === 'submode' ? activeTriggerClass : ''}`} title="视频生成方式">
                                    <span>{PRODUCT_MODE_LABELS[activeSubmode]}</span>
                                    
                                </button>
                            )}

                            {activeProductModel && (
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'parameters'} onClick={() => setExpandedPanel(prev => (prev === 'parameters' ? null : 'parameters'))} className={`${triggerClass} shrink-0 ${expandedPanel === 'parameters' ? activeTriggerClass : ''}`} title="生成参数">
                                    <span className="max-w-[220px] truncate">{paramSummary || '参数'}</span>
                                    
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={onAutoEnhanceToggle}
                                title={isAutoEnhanceEnabled ? '关闭自动润色（生成前不再自动优化提示词）' : '开启自动润色（生成前自动用 LLM 优化提示词）'}
                                className={`${triggerClass} shrink-0 ${isAutoEnhanceEnabled ? activeTriggerClass : ''}`}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
                                </svg>
                                <span className="sr-only">{isAutoEnhanceEnabled ? '润色已开启' : '润色'}</span>
                            </button>

                            <button type="button" onClick={() => void handleTranslatePrompt()} disabled={!onEnhancePrompt || !prompt.trim() || isTranslating} className={`${triggerClass} shrink-0 disabled:cursor-not-allowed disabled:opacity-40`} title="翻译提示词">
                                <span className="text-sm font-black">{isTranslating ? '…' : '译'}</span><span className="sr-only">翻译提示词</span>
                            </button>
                            {preTranslatePrompt != null && (
                                <button type="button" onClick={handleRevertTranslate} className={`${triggerClass} shrink-0`} title="还原翻译前的提示词">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
                                    <span className="sr-only">还原翻译</span>
                                </button>
                            )}

                            <div className="relative">
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'more'} aria-label="更多操作" onClick={() => setExpandedPanel(prev => (prev === 'more' ? null : 'more'))} className={`${triggerClass} shrink-0 ${expandedPanel === 'more' ? activeTriggerClass : ''}`} title="更多操作">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        {activeProductModel && (
                            <div className="flex h-8 shrink-0 items-center px-2.5 text-[11px] font-bold" title={providerUsageLabel ? '供应商返回的本次用量' : estimatedCostLabel ? '按当前 API Key 计价规则估算；最终以供应商账单或 Token 回执为准' : '当前 API Key 尚未配置可计算的计价规则'}>
                                <span style={{ color: providerUsageLabel || estimatedCostLabel ? 'var(--isl-mint-deep)' : 'var(--isl-ink-ghost)' }}>{providerUsageLabel || estimatedCostLabel || '费用 --'}</span>
                            </div>
                        )}
                        {(generationMode === 'image' || generationMode === 'video' && allowVideoBatch) && onBatchCountChange && (
                            <div className="relative">
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'batch'} onClick={() => setExpandedPanel(prev => (prev === 'batch' ? null : 'batch'))} className={`${triggerClass} shrink-0 ${expandedPanel === 'batch' ? activeTriggerClass : ''}`} title="批量方案数量">
                                    <span className="text-xs font-bold">×{batchCount}</span>
                                    
                                </button>
                            </div>
                        )}

                        {error && onRetry && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (isSeedanceVideoModel && !window.confirm('Seedance 重试会创建一个全新任务，可能再次消耗额度。确定继续吗？')) return;
                                    onRetry();
                                }}
                                className={`${triggerClass} ${compactMode ? 'h-9 px-3 text-xs' : 'h-10 px-4 text-sm'}`}
                                style={{ color: 'var(--isl-coral-deep)' }}
                                title={isSeedanceVideoModel ? '创建新的 Seedance 任务，可能再次扣费' : '使用相同参数重新生成'}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6"/><path d="M3.5 16.5A9 9 0 1 0 2 12"/></svg>
                                <span className="ml-1">重试</span>
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={() => {
                                if (isLoading && onStop) onStop();
                                else if (prompt.trim() && readyState !== 'missing-key' && !videoInputRequirement) onGenerate();
                            }}
                            disabled={(isLoading && !onStop) || (!isLoading && (!prompt.trim() || readyState === 'missing-key' || Boolean(videoInputRequirement)))}
                            aria-label={isLoading && onStop ? (isSeedanceVideoModel ? '停止并尝试取消任务' : '停止生成') : t('promptBar.generate')}
                            title={isLoading && onStop ? (isSeedanceVideoModel ? '停止本地等待并尝试取消上游任务；若已进入生成阶段，上游仍可能继续计费' : '停止生成') : videoInputRequirement || t('promptBar.generate')}
                            className={`isl-go ${compactMode ? 'h-10 w-10 min-w-10 rounded-full p-0 text-xs' : 'h-10 min-w-[116px] px-5 text-sm'}`}
                        >
                            {compactMode ? (isLoading && !onStop ? (
                                <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
                                </svg>
                            ) : isLoading ? (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                            ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>
                            )) : isLoading && !onStop ? (
                                <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
                                </svg>
                            ) : isLoading ? <span className="text-xs font-semibold">{isSeedanceVideoModel ? '停止/取消' : '停止'}</span> : (
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold">{error ? '重试' : batchCount > 1 ? `生成 ${batchCount} 版` : '开始生成'}</span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                        <path d="M5 12h14" />
                                        <path d="m12 5 7 7-7 7" />
                                    </svg>
                                </div>
                            )}
                        </button>
                    </div>
                </div>
            </div>
            <AssetReferencePicker
                open={referencePickerOpen}
                language={language}
                workflowItems={referenceItems}
                connectedIds={imageReferenceChips?.map(chip => chip.id)}
                library={assetLibrary}
                onClose={() => setReferencePickerOpen(false)}
                onSelectWorkflow={onSelectWorkflowReference}
                onSelectAsset={onSelectAsset}
                onUploadFiles={addReferenceFiles}
            />
        </div>
    );
};
