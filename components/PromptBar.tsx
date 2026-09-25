import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import RichPromptEditor, { resolveEditorMentions, type RichPromptEditorHandle } from './RichPromptEditor';
import type { AssetSuggestion, MentionItem } from './MentionList';
export type { MentionItem } from './MentionList';
import { extractMentions, type MentionData } from './MediaMentionExtension';
import type { ImageReferenceChip } from './workflow/references';
import { useWorkflowMediaUrl } from './workflow/media';
import { createPromptBarGenerationPolicy, PROMPT_IMAGE_MODE_ORDER, PROMPT_VIDEO_MODE_ORDER, type VideoAspectRatio } from '../services/promptBarPolicy';

import { readColdMedia } from '../utils/mediaIndexedDB';
import { displayError } from '../services/displayError';
import { AssetReferencePicker, type ReferencePickerWorkflowItem } from './studio/AssetReferencePicker';
import { ResponsivePopover } from './ResponsivePopover';

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
    /** 图生图/图生视频时是否锁定参考图原始比例（覆盖用户在比例选择中设置）。 */
    preserveReferenceAspectRatio?: boolean;
    onPreserveReferenceAspectRatioChange?: (enabled: boolean) => void;
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
    onResolvePastedMentions?: (mentions: MentionData[]) => Array<MentionData | null>;
    onPasteUnresolvedMentions?: (labels: string[]) => void;
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
    runWithoutPrompt?: boolean;
    providerOptional?: boolean;
    hideGenerationOptions?: boolean;
    runLabel?: string;
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

const PRODUCT_MODE_LABELS: Record<ProductModelMode, { zho: string; en: string }> = {
    'text-to-image': { zho: '文生图', en: 'Text to image' },
    'image-to-image': { zho: '图生图', en: 'Image to image' },
    'text-to-video': { zho: '文生视频', en: 'Text to video' },
    'image-to-video': { zho: '图生视频', en: 'Image to video' },
    'reference-to-video': { zho: '全能参考', en: 'Reference to video' },
    'first-last-frame': { zho: '首尾帧', en: 'First / last frame' },
    'video-extension': { zho: '视频扩展', en: 'Video extension' },
};

const productModeLabel = (mode: ProductModelMode, language: 'en' | 'zho') => PRODUCT_MODE_LABELS[mode][language];

function promptReasonCopy(message: string | null | undefined, language: 'en' | 'zho'): string | null {
    if (!message || language === 'zho') return message || null;
    const exact: Record<string, string> = {
        '该模型不支持图生图': 'This model does not support image-to-image.',
        '该模型不支持纯文生图': 'This model does not support text-to-image.',
        '该模式当前不存在': 'This mode is not available.',
        '该模型不支持多模态参考输入': 'This model does not support multimodal references.',
        '该模型不支持显式首尾帧': 'This model does not support explicit first and last frames.',
        '该模型不支持视频扩展': 'This model does not support video extension.',
        '该模型不支持图生视频': 'This model does not support image-to-video.',
        '该模型不支持该生成方式': 'This model does not support this generation mode.',
        '当前模式下此选项不可用': 'This option is unavailable in the current mode.',
        '请先选择模型': 'Choose a model first.',
        '图生视频需要添加 1 张图片': 'Add one image for image-to-video.',
        '首尾帧需要按顺序添加 2 张图片': 'Add two images in order for first and last frames.',
        '全能参考需要添加至少 1 个素材': 'Add at least one reference asset.',
    };
    if (exact[message]) return exact[message];
    const inputLimit = message.match(/^当前 AI 服务最多接收 (\d+) 个 @(图片|视频|音频) 参考$/);
    if (inputLimit) {
        const kind = inputLimit[2] === '图片' ? 'image' : inputLimit[2] === '视频' ? 'video' : 'audio';
        return `This AI service accepts up to ${inputLimit[1]} ${kind} reference${inputLimit[1] === '1' ? '' : 's'}.`;
    }
    const blockedKind = message.match(/^当前 AI 服务不接收 @(图片|视频|音频) 参考$/);
    if (blockedKind) {
        const kind = blockedKind[1] === '图片' ? 'image' : blockedKind[1] === '视频' ? 'video' : 'audio';
        return `This AI service does not accept ${kind} references.`;
    }
    return /\p{Script=Han}/u.test(message) ? 'This option is unavailable with the current model or route.' : message;
}

function ReferenceChipPreview({ chip }: { chip: ImageReferenceChip }) {
    const media = useWorkflowMediaUrl(chip.storageKey, chip.thumbnail);
    if (chip.elementType === 'audio') return <div className="flex h-full w-full items-center justify-center text-[10px] font-bold" style={{ color: 'var(--isl-mint-deep)', background: 'var(--isl-mint-bg)' }}>AU</div>;
    if (!media.url) return <div className="flex h-full w-full items-center justify-center text-[10px]">{chip.elementType === 'video' ? '🎬' : '🖼'}</div>;
    return chip.elementType === 'video'
        ? <video src={media.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
        : <img src={media.url} alt={chip.label} className="h-full w-full object-cover" />;
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
    preserveReferenceAspectRatio = false,
    onPreserveReferenceAspectRatioChange,
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
    onResolvePastedMentions,
    onPasteUnresolvedMentions,
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
    runWithoutPrompt = false,
    providerOptional = false,
    hideGenerationOptions = false,
    runLabel,
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
    const ui = useCallback((zho: string, en: string) => language === 'zho' ? zho : en, [language]);
    const isDark = theme === 'dark';
    const getParamDisabledReason = (kind: 'resolution' | 'aspectRatio' | 'durationSec', value: string | number) => promptReasonCopy(paramDisabledReason(kind, value), language);
    const rootRef = useRef<HTMLDivElement>(null);
    const richEditorRef = useRef<RichPromptEditorHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const latestPromptRef = useRef(prompt);
    // 防止提交链（@ 解析 + 生成）重入：双击发送/Enter 与按钮同帧触发时只生效一次
    const submittingRef = useRef(false);

    const [expandedPanel, setExpandedPanel] = useState<ExpandPanel>(null);
    const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
    // 稳定的锚点包装对象：避免每次渲染新建 { current } 导致 ResponsivePopover 定位 effect 反复执行
    const popoverAnchorBoxRef = useRef<HTMLElement | null>(null);
    // 面板从触发按钮旁自然展开（锚定按钮而非整个 PromptBar 根）
    const togglePanel = (panel: ExpandPanel, trigger: HTMLElement) => {
        setExpandedPanel(previous => (previous === panel ? null : panel));
        popoverAnchorBoxRef.current = trigger;
        setPopoverAnchor(trigger);
    };
    const [isDragActive, setIsDragActive] = useState(false);
    const [referencePickerOpen, setReferencePickerOpen] = useState(false);
    const [referencesExpanded, setReferencesExpanded] = useState(false);
    const [resolvedAttachmentHrefs, setResolvedAttachmentHrefs] = useState<Record<string, string>>({});
    const [modelCapabilityFilter, setModelCapabilityFilter] = useState<ProductModelMode | 'all'>('all');
    const [activeModelFamily, setActiveModelFamily] = useState('');
    const [isTranslating, setIsTranslating] = useState(false);
    const [preTranslatePrompt, setPreTranslatePrompt] = useState<string | null>(null);

    const triggerClass = `inline-flex items-center gap-1 rounded px-1.5 font-semibold transition-colors hover:bg-[var(--isl-surface-2)] ${compactMode ? 'h-6 text-[10px]' : 'h-7 text-[11px]'}`;
    const activeTriggerClass = 'text-[var(--isl-mint-deep)]';
    const popoverWidth = expandedPanel === 'model' ? 660 : expandedPanel === 'submode' ? 360 : expandedPanel === 'parameters' ? 430 : expandedPanel === 'more' ? 480 : expandedPanel === 'batch' ? 100 : 400;
    const shellClass = 'isl-shell';

    const editorReferenceItems = useMemo<MentionItem[]>(() => mentionItems || [], [mentionItems]);
    const pasteReferenceItems = useMemo<MentionItem[]>(() => {
        const tiers: MentionItem[][] = [
            editorReferenceItems,
            referenceItems.map(item => ({
                id: item.id,
                label: item.label,
                thumbnail: item.thumbnail || '',
                elementType: item.elementType,
                description: item.description,
                sourceType: 'connected',
            })),
            assetItems.map(item => ({
                id: `asset:${item.id}`,
                label: item.name || '未命名素材',
                thumbnail: item.thumbnail,
                elementType: item.elementType,
                sourceType: 'assetLibrary',
                assetId: item.id,
            })),
        ];
        const claimedLabels = new Set<string>();
        const result: MentionItem[] = [];
        for (const tier of tiers) {
            const grouped = new Map<string, MentionItem[]>();
            for (const item of tier) {
                const key = item.label.trim().toLocaleLowerCase();
                if (!key || claimedLabels.has(key)) continue;
                const identity = `${item.id}|${item.assetId || ''}`;
                const current = grouped.get(key) || [];
                if (!current.some(candidate => `${candidate.id}|${candidate.assetId || ''}` === identity)) grouped.set(key, [...current, item]);
            }
            for (const [key, items] of grouped) {
                claimedLabels.add(key);
                result.push(...items);
            }
        }
        return result;
    }, [assetItems, editorReferenceItems, referenceItems]);

    /** 当前生效的比例 setter：图片用 imageAspectRatio，视频用 videoAspectRatio */
    const activeRatio = generationMode === 'image' ? imageAspectRatio : videoAspectRatio;
    const setActiveRatio = (ratio: VideoAspectRatio) => {
        if (generationMode === 'image') setImageAspectRatio?.(ratio);
        else setVideoAspectRatio(ratio);
    };
    const policy = useMemo(() => createPromptBarGenerationPolicy({
        generationMode, selectedTextModel, selectedImageModel, selectedVideoModel,
        textModelOptions, imageModelOptions, videoModelOptions, userApiKeys, generationSubmode,
        imageReferenceChips, modelCapabilityFilter, activeModelFamily, generationQuality,
        videoResolution, activeRatio, videoDurationSec, batchCount, preserveReferenceAspectRatio,
    }), [activeModelFamily, activeRatio, batchCount, generationMode, generationQuality, generationSubmode, imageReferenceChips, imageModelOptions, modelCapabilityFilter, preserveReferenceAspectRatio, selectedImageModel, selectedTextModel, selectedVideoModel, textModelOptions, userApiKeys, videoDurationSec, videoModelOptions, videoResolution]);
    const {
        videoLikeMode, activeModel, activeProductModel, activeSubmode, activeRoute, activeRouteContext,
        activeCapabilities, productModels, productModelGroups, modelCapabilityFilters, filteredProductModelGroups, displayedModelGroup,
        paramSummary, isSeedanceVideoModel, isSeedanceFastModel, routedVideoModes, routedImageModes, activeKey,
        estimatedCostLabel, mentionedReferences, mentionedImageCount, effectiveReferenceLimits, videoInputRequirement,
        paramDisabledReason, currentModelOptions,
    } = policy;

    useEffect(() => {
        if (!activeProductModel) return;
        const selectedGroup = productModelGroups.find(group => group.models.some(product => product.id === activeProductModel.id));
        if (selectedGroup) setActiveModelFamily(selectedGroup.family);
    }, [activeProductModel, productModelGroups]);
    const changeActiveModel = (model: string) => generationMode === 'text' ? onTextModelChange?.(model) : videoLikeMode ? onVideoModelChange?.(model) : onImageModelChange?.(model);
    const promptCharCount = prompt.trim().length;
    const promptReady = runWithoutPrompt || Boolean(prompt.trim());
    const localizedVideoInputRequirement = promptReasonCopy(videoInputRequirement, language);
    const missingMediaModel = !providerOptional && generationMode !== 'text' && !activeProductModel;
    const readyState = missingMediaModel || (!providerOptional && (!activeKey || (activeProductModel && !activeRoute)))
        ? 'missing-key'
        : error
            ? 'error'
            : !promptReady
                ? 'empty'
                : videoInputRequirement
                    ? 'invalid-input'
                : isLoading
                    ? 'generating'
                    : 'ready';
    const setupRequired = readyState === 'missing-key' && Boolean(onOpenSettings);
    const setupLabel = userApiKeys.length ? t('promptBarExtra.configureService') : t('promptBarExtra.addService');
    const readyCopy = readyState === 'missing-key'
        ? (!userApiKeys.length ? t('promptBarExtra.addServiceHint') : missingMediaModel ? t('promptBarExtra.pickModelFirst') : t('promptBarExtra.mapRouteFirst'))
        : readyState === 'error'
            ? (promptReasonCopy(error, language) || t('promptBarExtra.generateFailed'))
            : readyState === 'empty'
                ? t('promptBarExtra.emptyPromptHint')
                : readyState === 'invalid-input'
                    ? localizedVideoInputRequirement
                : readyState === 'generating'
            ? (progressStage || t('promptBarExtra.generatingHint'))
                    : t('promptBarExtra.readyHint');
    const promptHints = isSelectionActive
        ? [t('promptBarExtra.selectedElements', selectedElementCount), t('promptBarExtra.describeChangeHint')]
        : attachments.length > 0
            ? [t('promptBarExtra.attachedRefs', attachments.length), t('promptBarExtra.mentionNodeHint')]
            : [t('promptBarExtra.dropMediaHint'), t('promptBarExtra.mentionNodeHint')];
    const placeholder = useMemo(() => {
        if (!isSelectionActive) return t('promptBarExtra.placeholderDefault');
        if (selectedElementCount === 1) return t('promptBarExtra.placeholderSingle');
        return t('promptBarExtra.placeholderMultiple', selectedElementCount);
    }, [isSelectionActive, selectedElementCount, t]);
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
    const handleEditorSubmit = useCallback(async () => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        try {
            // 提交前：把提示词里纯文本的 @名称 解析为真实引用（用户可能手动输入 @资产1 而未走选择器）
            if (richEditorRef.current) {
                resolveEditorMentions(richEditorRef.current, pasteReferenceItems, onResolvePastedMentions);
                // 等 editor 文档更新回流到 prompt 状态，再触发生成
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            if (!(runWithoutPrompt || latestPromptRef.current.trim()) || isLoading || videoInputRequirement) return;
            if (readyState === 'missing-key') {
                onOpenSettings?.();
                return;
            }
            onGenerate();
        } finally {
            submittingRef.current = false;
        }
    }, [isLoading, onGenerate, onOpenSettings, pasteReferenceItems, onResolvePastedMentions, readyState, runWithoutPrompt, videoInputRequirement]);

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
        } catch (error) {
            // 翻译线路异常（限流/网络/Key 失效等）：经 displayError 映射为可展示文案后提示，不再静默吞掉
            alert(displayError(error, ui('翻译失败，请稍后重试。', 'Translation failed. Please try again.')));
        } finally {
            setIsTranslating(false);
        }
    }, [isTranslating, language, onEnhancePrompt, prompt, replacePrompt, ui]);

    const handleRevertTranslate = useCallback(() => {
        if (preTranslatePrompt == null) return;
        replacePrompt(preTranslatePrompt);
        setPreTranslatePrompt(null);
    }, [preTranslatePrompt, replacePrompt]);

    useEffect(() => {
        if (!activeProductModel || !activeCapabilities || generationMode === 'text') return;
        const capabilities = activeCapabilities;
        const availableModes = generationMode === 'video' && routedVideoModes.length ? routedVideoModes
            : generationMode === 'image' && routedImageModes.length ? routedImageModes
            : capabilities.modes;
        if (!availableModes.includes(activeSubmode)) {
            onGenerationSubmodeChange?.(availableModes[0]);
        }
        if (activeRatio && !capabilities.aspectRatios.includes(activeRatio)) {
            setActiveRatio(capabilities.aspectRatios[0]);
        }
        const normalized = policy.sanitizeParameters(activeSubmode, activeRatio, videoResolution, videoDurationSec);
        if (normalized.resolution && normalized.resolution !== videoResolution) {
            onVideoResolutionChange?.(normalized.resolution);
        }
        if (generationMode === 'video' && normalized.durationSec !== undefined && normalized.durationSec !== videoDurationSec) {
            onVideoDurationSecChange?.(normalized.durationSec);
        }
    }, [activeCapabilities, activeProductModel, activeRatio, activeSubmode, generationMode, onGenerationSubmodeChange, onVideoDurationSecChange, onVideoResolutionChange, policy, routedVideoModes, setActiveRatio, videoDurationSec, videoResolution]);

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
        const name = window.prompt(ui('给这个提示词起个名字', 'Name this prompt'), ui(`我的效果 ${userEffects.length + 1}`, `My effect ${userEffects.length + 1}`));
        if (!name?.trim()) return;

        onAddUserEffect({
            id: `effect_${Date.now()}`,
            name: name.trim(),
            value: prompt.trim(),
        });
    }, [language, onAddUserEffect, prompt, userEffects.length, ui]);

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
                    title={ui('上传参考媒体', 'Upload reference media')}
                    aria-label={ui('上传参考媒体', 'Upload reference media')}
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
                            <div className="isl-chip px-4 py-2 text-sm">{ui('松手上传参考媒体', 'Release to upload reference media')}</div>
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
                                aria-label={ui('添加工作流参考', 'Add workflow reference')}
                                title={ui('从工作流节点、资产管理或本地上传添加参考', 'Add a reference from a workflow node, asset library, or local file')}
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
                                {imageReferenceChips.map((chip, index) => {
                                    const routeRejectsChip = generationMode === 'video' && chip.mentioned && effectiveReferenceLimits[chip.elementType] === 0;
                                    return (
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
                                        title={routeRejectsChip ? `${chip.label} · ${ui('当前 AI 服务不接收此类参考', 'This AI service does not accept this reference type')}` : chip.mentioned ? `${chip.label} · ${ui('已加入生成参考', 'Included as a generation reference')}` : `${chip.label} · ${ui('已连线，输入 @ 可加入生成参考', 'Connected. Type @ to include it as a generation reference')}`}
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
                                                title={ui('断开该参考图连线', 'Disconnect this reference')}
                                                aria-label={ui(`移除参考图 ${chip.label}`, `Remove reference ${chip.label}`)}
                                            >
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                            </button>
                                        )}
                                    </Reorder.Item>
                                    );
                                })}
                              </Reorder.Group>
                            )}
                        </div>
                    )}

                    <RichPromptEditor
                        ref={richEditorRef}
                        referenceItems={editorReferenceItems}
                        pasteReferenceItems={pasteReferenceItems}
                        placeholder={placeholder}
                        onTextChange={handleEditorChange}
                        onSubmit={handleEditorSubmit}
                        initialText={prompt}
                        initialDocument={promptDocument}
                        assetFolders={assetFolders}
                        assetItems={assetItems}
                        onSelectAsset={onSelectAsset}
                        onResolvePastedMentions={onResolvePastedMentions}
                        onPasteUnresolvedMentions={onPasteUnresolvedMentions}
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
                                            <div className="text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>{attachment.mimeType.startsWith('audio/') ? ui('参考音频', 'Audio reference') : attachment.mimeType.startsWith('video/') ? ui('参考视频', 'Video reference') : ui('参考图', 'Image reference')}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onRemoveAttachment?.(attachment.id)}
                                            className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-black/5"
                                            style={{ color: 'var(--isl-ink-soft)' }}
                                            title={ui('移除参考媒体', 'Remove reference media')}
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
                    <ResponsivePopover
                        anchorRef={popoverAnchor ? popoverAnchorBoxRef : rootRef}
                        preferredSide={popoverDirection}
                        width={popoverWidth}
                        ariaLabel={expandedPanel === 'model' ? ui('选择模型', 'Choose model') : expandedPanel === 'submode' ? ui('生成方式', 'Generation mode') : expandedPanel === 'parameters' ? ui('生成参数', 'Generation settings') : expandedPanel === 'batch' ? ui('批量方案数量', 'Number of variations') : ui('更多操作', 'More options')}
                        onRequestClose={() => setExpandedPanel(null)}
                        dataTestId="prompt-floating-panel"
                    >
                        <div
                            data-panel={expandedPanel}
                            className="isl-pop"
                        >
                            <div className='p-2.5' onWheel={event => event.stopPropagation()}>
                            {expandedPanel === 'model' && (
                                <>
                                    <div className="mb-1.5 px-1 text-[11px] font-semibold" style={{ color: 'var(--isl-ink)' }}>{ui('选择模型', 'Choose model')}</div>
                                    <div data-testid="prompt-model-progressive" data-density="compact" className="flex h-[320px] max-h-[68vh] overflow-hidden">
                        {productModels.length > 0 ? (
                            <>
                                <div className="flex w-[150px] shrink-0 flex-col border-r p-1" style={{ borderColor: 'var(--isl-border)' }}>
                                    <div className="flex flex-wrap gap-1 px-1 pb-1.5">
                                        <button type="button" onClick={() => setModelCapabilityFilter('all')} className={`h-5 rounded-[5px] px-1.5 text-[9px] font-semibold ${modelCapabilityFilter === 'all' ? 'isl-chip--active' : 'isl-chip'}`}>{ui('全部', 'All')}</button>
                                        {modelCapabilityFilters.map(mode => <button key={mode} type="button" onClick={() => setModelCapabilityFilter(mode)} className={`h-5 rounded-[5px] px-1.5 text-[9px] font-semibold ${modelCapabilityFilter === mode ? 'isl-chip--active' : 'isl-chip'}`}>{productModeLabel(mode, language)}</button>)}
                                    </div>
                                    <div className="min-h-0 flex-1 space-y-px overflow-y-auto pr-0.5 isl-scrollbar">
                                        {filteredProductModelGroups.map(group => {
                                            const active = displayedModelGroup?.family === group.family;
                                            return <button
                                                key={group.family}
                                                type="button"
                                                onClick={() => setActiveModelFamily(active ? '' : group.family)}
                                                className={`flex h-8 w-full items-center gap-1.5 rounded-[5px] px-1.5 text-left transition ${active ? 'bg-[var(--isl-mint-bg)]' : 'hover:bg-[var(--isl-surface-2)]'}`}
                                                title={group.family}
                                            >
                                        <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold" style={{ color: active ? 'var(--isl-mint-deep)' : 'var(--isl-ink)' }}>{group.family}</span><span className="block text-[8px]" style={{ color: 'var(--isl-ink-ghost)' }}>{group.company} · {group.models.filter(product => policy.isProductModelConfigured(product.id)).length}/{group.models.length}</span></span>
                                                <span aria-hidden="true" style={{ color: 'var(--isl-ink-ghost)', fontSize: 9 }}>{active ? '‹' : '›'}</span>
                                            </button>;
                                        })}
                                    </div>
                                </div>
                                <div className="min-w-0 flex-1 p-1">
                                    <div className="px-1 pb-1 text-[10px] font-semibold" style={{ color: 'var(--isl-ink-soft)' }}>{displayedModelGroup?.family || ui('模型', 'Model')}</div>
                                    <div className="min-h-0 max-h-[270px] space-y-0.5 overflow-y-auto pr-0.5 isl-scrollbar">
                                        {displayedModelGroup?.models.map(product => {
                                            const configured = policy.isProductModelConfigured(product.id);
                                            const selected = activeModel === product.id || activeProductModel?.id === product.id;
                                            const route = policy.resolveAnyProductRoute(product.id);
                                            return <button key={product.id} type="button" onClick={() => {
                                                if (!configured) { onOpenSettings?.(); setExpandedPanel(null); return; }
                                                changeActiveModel(product.id);
                                                setExpandedPanel(null);
                                            }} className={`flex w-full items-center gap-2 rounded-[6px] border-0 px-2 py-1.5 text-left transition ${selected ? 'bg-[var(--isl-mint-bg)]' : 'hover:bg-[var(--isl-surface-2)]'} ${configured ? '' : 'opacity-55'}`}>
                                                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold" style={{ color: selected ? 'var(--isl-mint-deep)' : 'var(--isl-ink)' }}>{product.name}</span>
                                                    <span className="mt-px flex flex-wrap gap-1">{product.capabilities.modes.map(mode => <span key={mode} className="rounded-[4px] px-1 text-[8px]" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)' }}>{productModeLabel(mode, language)}</span>)}</span>
                                                    {route && <span className="mt-px block truncate text-[8px]" style={{ color: 'var(--isl-ink-ghost)' }}>{route.key.name || route.key.provider} · {route.routeId}</span>}
                                                </span>
                                                <span className="shrink-0 text-[9px] font-semibold" style={{ color: configured ? 'var(--isl-mint-deep)' : 'var(--isl-ink-ghost)' }}>{configured ? product.badge || ui('已连接', 'Connected') : ui('去配置', 'Configure')}</span>
                                            </button>;
                                        })}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="w-full p-2">
                                {generationMode === 'text' ? <>
                                    <div className="px-2 pb-2 text-[11px] font-semibold" style={{ color: 'var(--isl-ink-soft)' }}>{ui('Agent 文本映射', 'Agent text route')}</div>
                                    <div className="rounded-[6px] bg-[var(--isl-surface-2)] px-3 py-2.5 text-xs" style={{ color: 'var(--isl-ink)' }}>{activeRoute ? `${activeRoute.key.name || activeRoute.key.provider} · ${activeRoute.routeId}` : t('promptBarExtra.agentRouteMissing')}</div>
                                    <button type="button" onClick={() => { onOpenSettings?.(); setExpandedPanel(null); }} className="mt-2 w-full rounded-[6px] border border-[var(--isl-border)] px-3 py-2 text-xs font-semibold">{t('promptBarExtra.openModelMapping')}</button>
                                </> : <>
                                    <div className="px-2 pb-2 text-[11px] font-semibold" style={{ color: 'var(--isl-ink-soft)' }}>{t('promptBarExtra.pickModel')}</div>
                                    {currentModelOptions.map(model => <button key={model} type="button" onClick={() => { changeActiveModel(model); setExpandedPanel(null); }} className={`mb-1 w-full rounded-[6px] border-0 px-2.5 py-2 text-left text-xs font-semibold ${activeModel === model ? 'bg-[var(--isl-mint-bg)] text-[var(--isl-mint-deep)]' : 'text-[var(--isl-ink)] hover:bg-[var(--isl-surface-2)]'}`}>{policy.modelLabel(model)}</button>)}
                                    {currentModelOptions.length === 0 && <div className="px-4 py-12 text-center text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{ui('没有可用模型', 'No models available')}</div>}
                                </>}
                            </div>
                        )}
                    </div>
                    {!activeRoute && activeProductModel && (
                                        <button type="button" onClick={onOpenSettings} className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center justify-between rounded-[6px] bg-[var(--isl-surface-2)] px-2.5 py-1.5 text-[11px] font-semibold">
                                            <span>{t('promptBarExtra.modelNotMapped', activeProductModel.name)}</span><span>{t('promptBarExtra.goConfigure')}</span>
                                        </button>
                                    )}
                                </>
                            )}
                            {expandedPanel === 'submode' && generationMode === 'video' && (
                                <div data-testid="prompt-video-mode-panel" data-density="compact">
                                    <div className="mb-2 px-1 text-xs font-extrabold" style={{ color: 'var(--isl-ink)' }}>{ui('生成方式', 'Generation mode')}</div>
                                    <div className="flex flex-col gap-1 px-0.5 pb-0.5">
                                        {PROMPT_VIDEO_MODE_ORDER.map(mode => {
                                            const supported = !!activeProductModel && routedVideoModes.includes(mode);
                                            const reason = !activeProductModel
                                                ? ui('请先选择视频模型', 'Choose a video model first')
                                                : (promptReasonCopy(policy.explainUnsupportedVideoMode(mode), language) || ui('未映射该模式的 API 线路，请在设置中配置', 'No API route is mapped for this mode. Configure one in Settings.'));
                                            return (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    aria-pressed={activeSubmode === mode}
                                                    disabled={!supported}
                                                    title={!supported ? reason : undefined}
                                                    onClick={() => { if (!supported) return; onGenerationSubmodeChange?.(mode); setExpandedPanel(null); }}
                                                    className={`h-8 w-full rounded-[6px] px-2 text-left text-[11px] font-medium transition ${!supported ? 'cursor-not-allowed opacity-35' : ''} ${activeSubmode === mode ? 'isl-chip--active' : 'isl-chip'}`}
                                                >
                                                    {productModeLabel(mode, language)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-1.5 rounded-[10px] bg-[var(--isl-surface-2)] px-2.5 py-2 text-[10px] leading-4 text-[var(--isl-ink-soft)]">
                                        {activeSubmode === 'image-to-video' && ui('第一个有序图片引用作为首帧。', 'The first ordered image reference is used as the first frame.')}
                                        {activeSubmode === 'reference-to-video' && ui('图片、视频或音频作为主体与风格参考，不当作首帧。', 'Images, video, and audio guide subject and style; they are not treated as the first frame.')}
                                        {activeSubmode === 'first-last-frame' && ui('按引用顺序使用前两张图片作为首帧和尾帧。', 'The first two image references are used as the first and last frames.')}
                                        {activeSubmode === 'video-extension' && ui('使用上游视频作为扩展输入。', 'Use the upstream video as the extension input.')}
                                        {activeSubmode === 'text-to-video' && ui('只使用文字提示生成视频。', 'Generate video from the text prompt only.')}
                                        {localizedVideoInputRequirement && <div className="mt-1 font-bold text-[var(--isl-coral-deep)]">{localizedVideoInputRequirement}</div>}
                                    </div>
                                </div>
                            )}
                            {expandedPanel === 'submode' && generationMode === 'image' && (
                                <div data-testid="prompt-image-mode-panel" data-density="compact">
                                    <div className="mb-2 px-1 text-xs font-extrabold" style={{ color: 'var(--isl-ink)' }}>{ui('生成方式', 'Generation mode')}</div>
                                    <div className="flex flex-col gap-1 px-0.5 pb-0.5">
                                        {PROMPT_IMAGE_MODE_ORDER.map(mode => {
                                            const supported = !!activeProductModel && routedImageModes.includes(mode);
                                            const reason = !activeProductModel
                                                ? ui('请先选择图片模型', 'Choose an image model first')
                                                : (promptReasonCopy(policy.explainUnsupportedImageMode(mode), language) || ui('未映射该模式的 API 线路，请在设置中配置', 'No API route is mapped for this mode. Configure one in Settings.'));
                                            return (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    aria-pressed={activeSubmode === mode}
                                                    disabled={!supported}
                                                    title={!supported ? reason : undefined}
                                                    onClick={() => { if (!supported) return; onGenerationSubmodeChange?.(mode); setExpandedPanel(null); }}
                                                    className={`h-8 w-full rounded-[6px] px-2 text-left text-[11px] font-medium transition ${!supported ? 'cursor-not-allowed opacity-35' : ''} ${activeSubmode === mode ? 'isl-chip--active' : 'isl-chip'}`}
                                                >
                                                    {productModeLabel(mode, language)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-1.5 rounded-[10px] bg-[var(--isl-surface-2)] px-2.5 py-2 text-[10px] leading-4 text-[var(--isl-ink-soft)]">
                                        {activeSubmode === 'image-to-image' && ui('按引用顺序上传参考图，最多 10 张；不写 @ 引用则不发送。', 'References are sent in order, up to 10 images. Only referenced items are sent.')}
                                        {activeSubmode === 'text-to-image' && ui('只使用文字提示生成图片，不读取参考图。', 'Generate from the text prompt only; references are ignored.')}
                                    </div>
                                </div>
                            )}
                            {expandedPanel === 'parameters' && activeProductModel && activeCapabilities && (
                                <>
                                    <div className="mb-1.5 px-1 text-[11px] font-semibold" style={{ color: 'var(--isl-ink)' }}>{ui('生成参数', 'Generation settings')}</div>
                                    <div data-testid="prompt-parameter-panel" data-density="compact" className="max-h-[320px] space-y-2 overflow-y-auto px-0.5 pb-0.5 isl-scrollbar">
                                        {activeCapabilities.qualities.length > 0 && (
                                            <div>
                                                <div className="mb-1 text-[10px] font-semibold" style={{ color: 'var(--isl-ink-soft)' }}>{ui('画质', 'Quality')}</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {activeCapabilities.qualities.map(quality => (
                                                        <button key={quality} type="button" onClick={() => onGenerationQualityChange?.(quality)} className={`h-7 rounded-[6px] px-2 text-[11px] font-medium ${generationQuality === quality ? 'isl-chip--active' : 'isl-chip'}`}>{quality === 'low' ? ui('低画质', 'Low') : quality === 'medium' ? ui('标准画质', 'Standard') : ui('高画质', 'High')}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
{activeCapabilities.resolutions.length > 0 && (
                                            <div>
                                                <div className="mb-1 text-[10px] font-semibold" style={{ color: 'var(--isl-ink-soft)' }}>{generationMode === 'video' ? ui('分辨率', 'Resolution') : ui('尺寸', 'Size')}</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {activeCapabilities.resolutions.map(resolution => {
                                                        const disabledReason = getParamDisabledReason('resolution', resolution);
                                                        return (
                                                            <button
                                                                key={resolution}
                                                                type="button"
                                                                disabled={!!disabledReason}
                                                                title={disabledReason || undefined}
                                                                onClick={() => { if (!disabledReason) onVideoResolutionChange?.(resolution); }}
                                                                className={`h-7 rounded-[6px] px-2 text-[11px] font-medium transition ${disabledReason ? 'cursor-not-allowed opacity-35' : ''} ${videoResolution === resolution ? 'isl-chip--active' : 'isl-chip'}`}
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
                                                <div className="mb-1 text-[10px] font-semibold" style={{ color: 'var(--isl-ink-soft)' }}>{ui('比例', 'Aspect ratio')}</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {activeCapabilities.aspectRatios.map(ratio => {
                                                        const disabledReason = getParamDisabledReason('aspectRatio', ratio);
                                                        const isActive = activeRatio === ratio && !preserveReferenceAspectRatio;
                                                        const dimClass = disabledReason ? 'cursor-not-allowed opacity-35' : preserveReferenceAspectRatio ? 'opacity-50' : '';
                                                        return (
                                                            <button
                                                                key={ratio}
                                                                type="button"
                                                                disabled={!!disabledReason}
                                                                title={disabledReason || undefined}
                                                                onClick={() => { if (!disabledReason) { setActiveRatio(ratio); onPreserveReferenceAspectRatioChange?.(false); } }}
                                                                className={`h-7 rounded-[6px] px-2 text-[11px] font-medium transition ${dimClass} ${isActive ? 'isl-chip--active' : 'isl-chip'}`}
                                                            >
                                                                {ratio === 'adaptive' ? ui('自适应', 'Adaptive') : ratio}
                                                            </button>
                                                        );
                                                    })}
                                                    {(generationMode === 'image' || generationMode === 'video') && onPreserveReferenceAspectRatioChange && (
                                                        <button
                                                            type="button"
                                                            disabled={(imageReferenceChips?.length || 0) === 0}
                                                            onClick={() => { if ((imageReferenceChips?.length || 0) > 0) onPreserveReferenceAspectRatioChange?.(true); }}
                                                            title={(imageReferenceChips?.length || 0) === 0 ? ui('请先添加参考图，才能使用原始宽高比', 'Add a reference image to use its original aspect ratio') : preserveReferenceAspectRatio ? ui('恢复手动选择比例', 'Return to manual aspect ratio') : ui('使用第一张参考图的原始宽高比，自动匹配最接近的支持比例', 'Match the closest supported ratio to the first reference image')}
                                                            className={`h-8 w-full rounded-[6px] px-2 text-left text-[11px] font-medium transition ${preserveReferenceAspectRatio ? 'isl-chip--active' : 'isl-chip'} ${(imageReferenceChips?.length || 0) === 0 ? 'cursor-not-allowed opacity-40' : ''}`}
                                                        >
                                                            {ui('原比例', 'Original')}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
{generationMode === 'video' && activeCapabilities.durations.length > 0 && (
                                            <div>
                                                <div className="mb-1 text-[10px] font-semibold" style={{ color: 'var(--isl-ink-soft)' }}>{ui('时长', 'Duration')}</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {activeCapabilities.durations.map(duration => {
                                                        const disabledReason = getParamDisabledReason('durationSec', duration);
                                                        return (
                                                            <button
                                                                key={duration}
                                                                type="button"
                                                                disabled={!!disabledReason}
                                                                title={disabledReason || (duration === -1 ? ui('不限', 'Unlimited') : `${duration} ${ui('秒', 'seconds')}`)}
                                                                onClick={() => { if (!disabledReason) onVideoDurationSecChange?.(duration); }}
                                                                className={`h-7 rounded-[6px] px-2 text-[11px] font-medium transition ${disabledReason ? 'cursor-not-allowed opacity-35' : ''} ${videoDurationSec === duration ? 'isl-chip--active' : 'isl-chip'}`}
                                                            >
                                                                {duration === -1 ? ui('不限', 'Unlimited') : `${duration}s`}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {generationMode === 'video' && activeCapabilities.audioControl === 'optional' && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>{ui('生成音频', 'Generated audio')}</div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <button type="button" aria-pressed={videoGenerateAudio} onClick={() => onVideoGenerateAudioChange?.(true)} className={`h-7 rounded-[6px] px-2 text-[11px] font-medium ${videoGenerateAudio ? 'isl-chip--active' : 'isl-chip'}`}>{ui('开启', 'On')}</button>
                                                    <button type="button" aria-pressed={!videoGenerateAudio} onClick={() => onVideoGenerateAudioChange?.(false)} className={`h-7 rounded-[6px] px-2 text-[11px] font-medium ${!videoGenerateAudio ? 'isl-chip--active' : 'isl-chip'}`}>{ui('关闭', 'Off')}</button>
                                                </div>
                                            </div>
                                        )}
                                        {generationMode === 'video' && activeCapabilities.audioControl === 'always' && <div className="rounded-[14px] bg-[var(--isl-surface-2)] px-3 py-2 text-xs font-bold text-[var(--isl-ink-soft)]">{ui('该模型始终生成原生音频', 'This model always generates native audio.')}</div>}
                                        {activeProductModel.id.startsWith('flovart:veo-3.1') && (activeSubmode === 'reference-to-video' || videoResolution?.toLowerCase() !== '720p') && <div className="rounded-[14px] bg-[var(--isl-mint-bg)] px-3 py-2 text-[11px] font-semibold text-[var(--isl-mint-deep)]">{ui('当前 Veo 组合按官方约束固定为 8 秒。', 'This Veo configuration is fixed at 8 seconds by the model requirements.')}</div>}
                                    </div>
                                </>
                            )}
                            {expandedPanel === 'more' && (
                                <>
                                    {activeProductModel && activeCapabilities && (activeCapabilities.supportsWebSearch || activeCapabilities.supportsRealPersonCheck) && (
                                        <div className="mb-2 space-y-1 border-b border-[var(--isl-border)] pb-2">
                                            <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--isl-ink-soft)' }}>{ui('高级选项', 'Advanced options')}</div>
                                            {activeCapabilities.supportsWebSearch && (
                                                <button type="button" onClick={() => onWebSearchToggle?.(!webSearchEnabled)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-bold transition-colors hover:bg-[var(--isl-surface-2)] ${webSearchEnabled ? 'text-[var(--isl-mint-deep)]' : ''}`}><span>{ui('联网搜索', 'Web search')}</span><span>{webSearchEnabled ? 'ON' : 'OFF'}</span></button>
                                            )}
                                            {activeCapabilities.supportsRealPersonCheck && (
                                                <button type="button" onClick={() => onRealPersonCheckToggle?.(!realPersonCheckEnabled)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-bold transition-colors hover:bg-[var(--isl-surface-2)] ${realPersonCheckEnabled ? 'text-[var(--isl-mint-deep)]' : ''}`}><span>{ui('真人素材预检测', 'Real-person content check')}</span><span>{realPersonCheckEnabled ? 'ON' : 'OFF'}</span></button>
                                            )}
                                        </div>
                                    )}
                                    <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--isl-ink-soft)' }}>{ui('更多操作', 'More options')}</div>
                                    {isSeedanceVideoModel && !activeProductModel && (
                                        <div className="mx-1 mb-2 rounded-[18px] border-[1.5px] p-3" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)' }}>
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>{ui('Seedance 视频参数', 'Seedance video settings')}</div>
                                                    <div className="mt-0.5 text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>{ui('分辨率、声音、水印', 'Resolution, audio, watermark')}</div>
                                                </div>
                                                {isSeedanceFastModel && (
                                                    <span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ color: 'var(--isl-sun-deep)', background: 'rgba(251,191,36,0.14)' }}>
                                                        {ui('Fast 最高 720p', 'Fast: up to 720p')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-3">
                                                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--isl-ink-soft)' }}>{ui('分辨率', 'Resolution')}</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {SEEDANCE_RESOLUTIONS.map(resolution => {
                                                        const disabled = isSeedanceFastModel && resolution === '1080p';
                                                        return (
                                                            <button
                                                                key={resolution}
                                                                type="button"
                                                                disabled={disabled}
                                                                onClick={() => onVideoResolutionChange?.(resolution)}
                                                                className={`rounded-[12px] px-2 py-1.5 text-xs font-bold transition ${disabled ? 'cursor-not-allowed opacity-35' : ''} ${videoResolution === resolution ? 'isl-chip--active' : 'isl-chip'}`}
                                                                title={disabled ? ui('Fast 模型不支持 1080p，会自动降到 720p', 'Fast does not support 1080p; it will use 720p.') : resolution}
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
                                                    {ui('生成声音', 'Audio')} {videoGenerateAudio ? 'ON' : 'OFF'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onVideoWatermarkChange?.(!videoWatermark)}
                                                    className={`rounded-[12px] px-3 py-2 text-left text-xs font-bold transition ${videoWatermark ? 'isl-chip--active' : 'isl-chip'}`}
                                                    aria-pressed={videoWatermark}
                                                >
                                                    {ui('水印', 'Watermark')} {videoWatermark ? 'ON' : 'OFF'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    <div className="space-y-1">
                                        {userApiKeys.length > 0 && (
                                            <MenuOptionButton
                                                label={ui(`AI 服务 · ${userApiKeys.length} 个`, `AI services · ${userApiKeys.length}`)}
                                                description={userApiKeys.find(k => k.isDefault)?.name || ui('点击打开设置管理访问凭证与模型路线', 'Open Settings to manage credentials and model routes')}
                                                onClick={() => { onOpenSettings?.(); setExpandedPanel(null); }}
                                            />
                                        )}
                                        {canOpenReferencePicker && (
                                            <MenuOptionButton
                                            label={ui('添加工作流参考', 'Add workflow reference')}
                                            description={ui('从工作流节点、资产管理或本地上传', 'From a workflow node, asset library, or local file')}
                                                onClick={() => {
                                                    setReferencePickerOpen(true);
                                                    setExpandedPanel(null);
                                                }}
                                            />
                                        )}

                                        {onLockCharacterFromSelection && (
                                            <MenuOptionButton
                                                label={ui('从当前选择锁定角色', 'Lock character from selection')}
                                                description={canLockCharacter ? ui('把当前图片保存为后续生成参考', 'Save the selected image as a future generation reference') : ui('先选中一张图片元素', 'Select an image element first')}
                                                onClick={() => onLockCharacterFromSelection()}
                                            />
                                        )}

                                        {characterLocks.length > 0 && (
                                            <>
                                                <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#98A2B3]">{ui('角色锁定', 'Character lock')}</div>
                                                <MenuOptionButton label={ui('不使用角色锁定', 'No character lock')} active={activeCharacterLockId == null} onClick={() => onSetActiveCharacterLock?.(null)} />
                                                {characterLocks.map(lock => <MenuOptionButton key={lock.id} label={lock.name} active={activeCharacterLockId === lock.id} onClick={() => onSetActiveCharacterLock?.(lock.id)} />)}
                                            </>
                                        )}

                                        {variant !== 'inline' && (
                                            <MenuOptionButton label={ui('保存当前提示词', 'Save current prompt')} description={ui('存成一个可复用效果', 'Save as a reusable effect')} onClick={handleSaveEffect} />
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
                                                            title={ui('删除已保存提示词', 'Delete saved prompt')}
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
                                                {ui('在输入框里输入 ', 'Type ')}<span className="font-bold" style={{ color: 'var(--isl-mint-deep)' }}>@</span>{ui('，可直接引用工作流节点或资产。', ' to reference workflow nodes or assets.')}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                            {expandedPanel === 'batch' && onBatchCountChange && (
                                <div className="flex flex-col items-center px-1">
                                    <div className="mb-1.5 px-1 text-[11px] font-semibold" style={{ color: 'var(--isl-ink)' }}>{ui('批量方案数量', 'Number of variations')}</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {[1, 2, 4].map(count => {
                                            const active = batchCount === count;
                                            return (
                                                <button
                                                    key={count}
                                                    type="button"
                                                    onClick={() => { onBatchCountChange(count); setExpandedPanel(null); }}
                                                    className={`flex h-8 w-[76px] items-center justify-center rounded-[6px] px-2 text-xs font-semibold transition ${active ? 'isl-chip--active' : 'isl-chip'}`}
                                                    style={active ? undefined : { color: 'var(--isl-ink-soft)' }}
                                                    aria-pressed={active}
                                                    title={count === 1 ? ui('单张方案', 'One variation') : ui(`输出 ${count} 张方案`, `Generate ${count} variations`)}
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
                    </ResponsivePopover>
                )}

                <div className={`relative flex items-center gap-2 border-t ${compactMode ? 'px-2.5 py-2' : 'px-3 py-2.5'}`} style={{ borderColor: 'var(--isl-border)' }}>
                    <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto isl-scrollbar">
                            {!hideGenerationOptions && (() => {
                                const keyCount = userApiKeys.length;
                                if (keyCount === 0) {
                                    return (
                                        <button
                                            type="button"
                                            onClick={onOpenSettings}
                                            className={`${triggerClass} shrink-0 ${compactMode ? 'h-7 w-7 px-0 text-[11px]' : 'h-8 px-3 text-xs'}`}
                                            style={{ color: 'var(--isl-coral-deep)' }}
                                            aria-label={t('promptBarExtra.configureService')}
                                            title={t('promptBarExtra.noServiceTitle')}
                                        >
                                            🔑<span className={compactMode ? 'sr-only' : 'ml-1'}>{t('promptBarExtra.noServiceChip')}</span>
                                        </button>
                                    );
                                }
                                return null;
                            })()}

                            {!hideGenerationOptions && <div className="relative">
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'model'} onClick={event => togglePanel('model', event.currentTarget)} className={`${triggerClass} shrink-0 ${expandedPanel === 'model' ? activeTriggerClass : ''}`}>
                                    <span className="max-w-[150px] truncate">{policy.modelLabelForMode()}</span>
                                    
                                </button>
                            </div>}

                            {!hideGenerationOptions && generationMode === 'video' && PROMPT_VIDEO_MODE_ORDER.length > 1 && (
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'submode'} onClick={event => togglePanel('submode', event.currentTarget)} className={`${triggerClass} shrink-0 ${expandedPanel === 'submode' ? activeTriggerClass : ''}`} title={ui('视频生成方式', 'Video generation mode')}>
                                    <span>{productModeLabel(activeSubmode, language)}</span>

                                </button>
                            )}

                            {!hideGenerationOptions && generationMode === 'image' && routedImageModes.length > 1 && (
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'submode'} onClick={event => togglePanel('submode', event.currentTarget)} className={`${triggerClass} shrink-0 ${expandedPanel === 'submode' ? activeTriggerClass : ''}`} title={ui('图片生成方式', 'Image generation mode')}>
                                    <span>{productModeLabel(activeSubmode, language)}</span>

                                </button>
                            )}

                            {!hideGenerationOptions && generationMode !== 'text' && (
                                <button type="button" aria-haspopup="dialog" aria-expanded={activeProductModel ? expandedPanel === 'parameters' : expandedPanel === 'model'} onClick={event => activeProductModel ? togglePanel('parameters', event.currentTarget) : togglePanel('model', event.currentTarget)} className={`${triggerClass} shrink-0 ${(activeProductModel ? expandedPanel === 'parameters' : expandedPanel === 'model') ? activeTriggerClass : ''}`} title={ui('生成参数', 'Generation settings')}>
                                    <span className="max-w-[220px] truncate">{paramSummary || ui('参数', 'Settings')}</span>
                                </button>
                            )}

                            {!hideGenerationOptions && <button
                                type="button"
                                onClick={onAutoEnhanceToggle}
                                title={isAutoEnhanceEnabled ? ui('关闭自动润色（生成前不再自动优化提示词）', 'Turn off automatic prompt enhancement') : ui('开启自动润色（生成前自动用 LLM 优化提示词）', 'Turn on automatic prompt enhancement before generation')}
                                className={`${triggerClass} shrink-0 ${isAutoEnhanceEnabled ? activeTriggerClass : ''}`}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
                                </svg>
                                <span className="sr-only">{isAutoEnhanceEnabled ? ui('润色已开启', 'Prompt enhancement on') : ui('润色', 'Enhance prompt')}</span>
                            </button>}

                            {!hideGenerationOptions && <button type="button" onClick={() => void handleTranslatePrompt()} disabled={!onEnhancePrompt || !prompt.trim() || isTranslating} className={`${triggerClass} shrink-0 disabled:cursor-not-allowed disabled:opacity-40`} title={ui('翻译提示词', 'Translate prompt')}>
                                <span className="text-sm font-black">{isTranslating ? '…' : ui('译', 'EN')}</span><span className="sr-only">{ui('翻译提示词', 'Translate prompt')}</span>
                            </button>}
                            {!hideGenerationOptions && preTranslatePrompt != null && (
                                <button type="button" onClick={handleRevertTranslate} className={`${triggerClass} shrink-0`} title={ui('还原翻译前的提示词', 'Restore prompt before translation')}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
                                    <span className="sr-only">{ui('还原翻译', 'Restore translation')}</span>
                                </button>
                            )}

                            {!hideGenerationOptions && <div className="relative">
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'more'} aria-label={ui('更多操作', 'More options')} onClick={event => togglePanel('more', event.currentTarget)} className={`${triggerClass} shrink-0 ${expandedPanel === 'more' ? activeTriggerClass : ''}`} title={ui('更多操作', 'More options')}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                                </button>
                            </div>}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        {!hideGenerationOptions && activeProductModel && (
                            <div className="flex h-8 shrink-0 items-center px-2.5 text-[11px] font-bold" title={providerUsageLabel ? ui('供应商返回的本次用量', 'Usage reported by provider') : estimatedCostLabel ? ui('按当前 API Key 计价规则估算；最终以供应商账单或 Token 回执为准', 'Estimated from the current API key pricing; provider billing or token usage is final') : ui('当前 API Key 尚未配置可计算的计价规则', 'No pricing rule is configured for the current API key')}>
                                <span style={{ color: providerUsageLabel || estimatedCostLabel ? 'var(--isl-mint-deep)' : 'var(--isl-ink-ghost)' }}>{providerUsageLabel || estimatedCostLabel || ui('费用 --', 'Cost --')}</span>
                            </div>
                        )}
                        {!hideGenerationOptions && (generationMode === 'image' || generationMode === 'video' && allowVideoBatch) && onBatchCountChange && (
                            <div className="relative">
                                <button type="button" aria-haspopup="dialog" aria-expanded={expandedPanel === 'batch'} onClick={event => togglePanel('batch', event.currentTarget)} className={`${triggerClass} shrink-0 ${expandedPanel === 'batch' ? activeTriggerClass : ''}`} title={ui('批量方案数量', 'Number of variations')}>
                                    <span className="text-xs font-bold">×{batchCount}</span>
                                    
                                </button>
                            </div>
                        )}

                        {error && onRetry && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (isSeedanceVideoModel && !window.confirm(ui('Seedance 重试会创建一个全新任务，可能再次消耗额度。确定继续吗？', 'Retrying Seedance creates a new task and may use credits again. Continue?'))) return;
                                    onRetry();
                                }}
                                className={`${triggerClass} ${compactMode ? 'h-9 px-3 text-xs' : 'h-10 px-4 text-sm'}`}
                                style={{ color: 'var(--isl-coral-deep)' }}
                                title={isSeedanceVideoModel ? ui('创建新的 Seedance 任务，可能再次扣费', 'Create a new Seedance task; this may use credits again') : ui('使用相同参数重新生成', 'Generate again with the same settings')}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6"/><path d="M3.5 16.5A9 9 0 1 0 2 12"/></svg>
                                <span className="ml-1">{t('promptBarExtra.retry')}</span>
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={() => {
                                if (isLoading && onStop) onStop();
                                else if (setupRequired) onOpenSettings?.();
                                else if (promptReady && readyState !== 'missing-key' && !videoInputRequirement) void handleEditorSubmit();
                            }}
                            disabled={(isLoading && !onStop) || (!isLoading && (setupRequired ? false : (!promptReady || readyState === 'missing-key' || Boolean(videoInputRequirement))))}
                            aria-label={isLoading && onStop ? (isSeedanceVideoModel ? t('promptBarExtra.stopSeedance') : t('promptBarExtra.stopGeneration')) : setupRequired ? setupLabel : runLabel || t('promptBar.generate')}
                            title={isLoading && onStop ? (isSeedanceVideoModel ? t('promptBarExtra.stopSeedanceTitle') : t('promptBarExtra.stopGeneration')) : setupRequired ? ui(`${setupLabel}以开始生成`, `${setupLabel} to start generation`) : localizedVideoInputRequirement || runLabel || t('promptBar.generate')}
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
                            ) : isLoading ? <span className="text-xs font-semibold">{isSeedanceVideoModel ? t('promptBarExtra.stopSeedance') : t('promptBarExtra.stopGeneration')}</span> : (
                                <div className="flex flex-wrap gap-1.5">
                                    <span className="text-xs font-semibold">{setupRequired ? setupLabel : error ? t('promptBarExtra.retry') : runLabel || (batchCount > 1 ? t('promptBarExtra.generateVersions', batchCount) : t('promptBarExtra.startGenerating'))}</span>
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
