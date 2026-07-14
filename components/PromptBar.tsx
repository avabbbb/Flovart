import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Reorder } from 'motion/react';
import type {
    CharacterLockProfile,
    ChatAttachment,
    Element,
    GenerationMode,
    PromptEnhanceMode,
    PromptEnhanceResult,
    ProductModelMode,
    UserApiKey,
    UserEffect,
} from '../types';
import RichPromptEditor, { type RichPromptEditorHandle } from './RichPromptEditor';
import type { MentionItem } from './MentionList';
export type { MentionItem } from './MentionList';
import { extractMentions } from './CanvasMentionExtension';
import type { ImageReferenceChip } from './workflow/references';
import { PROVIDER_LABELS, type VideoAspectRatio } from '../services/aiGateway';

import { readColdMedia } from '../utils/mediaIndexedDB';
import { modelRefLabel, modelRefModelId, modelRefProvider, modelRefSearchText } from '../utils/modelRefs';
import {
    getProductModel,
    getProductModelsByCompany,
    isProductModelConfigured,
    resolveProductModelRoute,
    sanitizeProductGenerationParams,
} from '../services/productModelCatalog';

export interface PromptBarProps {
    t: (key: string, ...args: any[]) => string;
    theme: 'light' | 'dark';
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
    canvasElements?: Element[];
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
    popoverDirection?: 'up' | 'down';
    onRetry?: () => void;
    error?: string | null;
    progressStage?: string;
    autoFocus?: boolean;
    focusSignal?: number;
}

type ExpandPanel = 'model' | 'parameters' | 'advanced' | 'more' | null;

const TYPE_LABELS: Record<Element['type'], string> = {
    image: '图片',
    video: '视频',
    shape: '形状',
    text: '文字',
    path: '画笔',
    group: '组合',
    arrow: '箭头',
    line: '线条',
};

function getElementLabel(element: Element): string {
    return element.name?.trim() || `${TYPE_LABELS[element.type]} ${element.id.slice(-4)}`;
}

function getMentionDescription(element: Element): string {
    const typeLabel = TYPE_LABELS[element.type] || element.type;
    if (element.type === 'image' || element.type === 'video') {
        return `${typeLabel} · ${Math.round(element.width)}×${Math.round(element.height)}`;
    }
    if (element.type === 'text') {
        const text = element.text.replace(/\s+/g, ' ').trim();
        return text ? `${typeLabel} · ${text.slice(0, 24)}` : typeLabel;
    }
    if (element.type === 'shape') {
        return `${typeLabel} · ${element.shapeType}`;
    }
    return typeLabel;
}

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

function getModelLabel(mode: GenerationMode, textModel?: string, imageModel?: string, videoModel?: string, userApiKeys: UserApiKey[] = []): string {
    const model = mode === 'text' ? textModel : mode === 'video' || mode === 'keyframe' ? videoModel : imageModel;
    if (!model) return mode === 'text' ? '选择文本模型' : mode === 'video' || mode === 'keyframe' ? '选择视频模型' : '选择图片模型';
    const product = getProductModel(model);
    if (product) return product.name;
    const provider = modelRefProvider(model, userApiKeys);
    const shortProvider = PROVIDER_LABELS[provider]?.split(' ')[0] || provider;
    return `${shortProvider} · ${modelRefModelId(model).replace(/^(google|openai|anthropic|openrouter)\//, '')}`;
}

const PopoverHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
    <div className="px-2 pb-1.5">
        <div className="text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>{title}</div>
        {subtitle && <div className="mt-0.5 text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>{subtitle}</div>}
    </div>
);

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
const RECENT_MODELS_KEY = 'flovart-recent-models';
const MAX_RECENT_MODELS = 5;
function getRecentModels(): string[] {
    try { const raw = localStorage.getItem(RECENT_MODELS_KEY); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
}
function addRecentModel(model: string) {
    const recent = getRecentModels().filter(m => m !== model);
    recent.unshift(model);
    try { localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_MODELS))); } catch {}
}

export const PromptBar: React.FC<PromptBarProps> = ({
    t,
    theme,
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
    canvasElements = [],
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
    popoverDirection = 'up',
    modeOptions = ['image', 'video', 'keyframe'],
    onRetry,
    error,
    progressStage,
    autoFocus = false,
    focusSignal,
}) => {
    const isDark = theme === 'dark';
    const rootRef = useRef<HTMLDivElement>(null);
    const richEditorRef = useRef<RichPromptEditorHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const latestPromptRef = useRef(prompt);

    const [expandedPanel, setExpandedPanel] = useState<ExpandPanel>(null);
    const [isDragActive, setIsDragActive] = useState(false);
    const [resolvedAttachmentHrefs, setResolvedAttachmentHrefs] = useState<Record<string, string>>({});
    const [modelSearchQuery, setModelSearchQuery] = useState('');
    const [recentModels, setRecentModels] = useState<string[]>(() => getRecentModels());
    const [isTranslating, setIsTranslating] = useState(false);

    const triggerClass = `isl-chip ${compactMode ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs'}`;
    const activeTriggerClass = 'isl-chip--active';
    const popoverCardClass = `isl-pop absolute ${popoverDirection === 'down' ? 'top-full left-0 mt-2' : 'bottom-full left-0 mb-2'} z-[80] ${compactMode ? 'min-w-[200px]' : 'min-w-[220px]'} p-1.5 max-h-[60vh] overflow-y-auto`;
    const shellClass = 'isl-shell';

    /** 将画布元素转换为 RichPromptEditor 需要的 MentionItem[] */
    const canvasItems = useMemo<MentionItem[]>(() =>
        mentionItems || canvasElements
            .filter(el => el.isVisible !== false)
            .map(el => ({
                id: el.id,
                label: getElementLabel(el),
                thumbnail: el.type === 'image' || el.type === 'video' ? el.href : '',
                elementType: el.type,
                description: getMentionDescription(el),
            })),
        [canvasElements, mentionItems]
    );

    /** 当前视频模型是否为 Seedance（用于 Fast 限制 1080p 等模型专属逻辑） */
    const videoLikeMode = generationMode === 'video' || generationMode === 'keyframe';
    const activeModel = generationMode === 'text' ? selectedTextModel : videoLikeMode ? selectedVideoModel : selectedImageModel;
    const activeProductModel = useMemo(() => getProductModel(activeModel), [activeModel]);
    /** 当前能力下的产品模型按公司分组 */
const productModelGroups = useMemo(
        () => activeProductModel ? getProductModelsByCompany(activeProductModel.capability) : [],
        [activeProductModel]
    );
    /** 当前生效的比例 setter：图片用 imageAspectRatio，视频用 videoAspectRatio */
    const activeRatio = generationMode === 'image' ? imageAspectRatio : videoAspectRatio;
    const setActiveRatio = (ratio: VideoAspectRatio) => {
        if (generationMode === 'image') setImageAspectRatio?.(ratio);
        else setVideoAspectRatio(ratio);
    };
    /** 参数摘要：用于 chip 上显示浓度等信息 */
    const paramSummary = useMemo(() => {
        if (!activeProductModel) return '';
        const parts: string[] = [];
        if (activeProductModel.capability === 'image' && generationQuality) {
            parts.push(generationQuality === 'low' ? '低画面' : generationQuality === 'medium' ? '标准' : '高画面');
        }
        if (activeProductModel.capabilities.resolutions.length > 0 && videoResolution) parts.push(videoResolution);
        if (activeProductModel.capabilities.aspectRatios.length > 0 && activeRatio) parts.push(activeRatio === 'adaptive' ? '自适应' : activeRatio);
        if (generationMode === 'video' && activeProductModel.capabilities.durations.length > 0) parts.push(videoDurationSec === -1 ? '无限时' : `${videoDurationSec}s`);
        if (batchCount > 1) parts.push(`×${batchCount}`);
        return parts.filter(Boolean).join(' · ');
    }, [activeProductModel, generationMode, generationQuality, videoResolution, activeRatio, videoDurationSec, batchCount]);
    const isSeedanceVideoModel = useMemo(() => {
        return videoLikeMode && !!selectedVideoModel && modelRefModelId(selectedVideoModel).toLowerCase().includes('seedance');
    }, [selectedVideoModel, videoLikeMode]) || activeProductModel?.id.includes('seedance') === true;
    const isSeedanceFastModel = isSeedanceVideoModel && modelRefModelId(selectedVideoModel).toLowerCase().includes('fast');

    const currentModelOptions = generationMode === 'text' ? textModelOptions : videoLikeMode ? videoModelOptions : imageModelOptions;
    const activeRoute = activeProductModel ? resolveProductModelRoute(activeProductModel.id, userApiKeys) : null;
    const activeKey = activeRoute?.key || userApiKeys.find(k => k.isDefault) || userApiKeys[0];
    const changeActiveModel = (model: string) => generationMode === 'text' ? onTextModelChange?.(model) : videoLikeMode ? onVideoModelChange?.(model) : onImageModelChange?.(model);
    const promptCharCount = prompt.trim().length;
    const readyState = !activeKey || (activeProductModel && !activeRoute)
        ? 'missing-key'
        : error
            ? 'error'
            : !prompt.trim()
                ? 'empty'
                : isLoading
                    ? 'generating'
                    : 'ready';
    const readyCopy = readyState === 'missing-key'
        ? '先连接一个 AI 供应商'
        : readyState === 'error'
            ? (error || '生成失败')
            : readyState === 'empty'
                ? '输入你想生成或修改的画面'
                : readyState === 'generating'
                    ? (progressStage || '正在生成，保持画布打开')
                    : '准备就绪，Ctrl+Enter 生成';
    const promptHints = isSelectionActive
        ? [`已选中 ${selectedElementCount} 个元素`, '描述“怎么改”比描述“是什么”更有效']
        : attachments.length > 0
            ? [`已添加 ${attachments.length} 个参考`, '可以继续输入 @ 引用画布元素']
            : ['支持拖入图片/视频/音频参考', '输入 @ 可引用画布元素'];
    const placeholder = useMemo(() => {
        if (!isSelectionActive) return '使用 @ 引用画布中的图片，例如：把 @图片1 的人物替换为 @图片2 的兔子';
        if (selectedElementCount === 1) return '描述你想对当前元素做什么';
        return `已选中 ${selectedElementCount} 个元素，补充组合生成描述`;
    }, [isSelectionActive, selectedElementCount]);

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
        if (latestPromptRef.current.trim() && !isLoading && readyState !== 'missing-key') onGenerate();
    }, [isLoading, onGenerate, readyState]);

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

    const activeSubmode = generationSubmode || (generationMode === 'video' ? 'text-to-video' : 'text-to-image');

    const handleTranslatePrompt = useCallback(async () => {
        if (!onEnhancePrompt || !prompt.trim() || isTranslating) return;
        setIsTranslating(true);
        try {
            const result = await onEnhancePrompt({ prompt: prompt.trim(), mode: 'translate' });
            if (result.enhancedPrompt?.trim()) replacePrompt(result.enhancedPrompt.trim());
        } finally {
            setIsTranslating(false);
        }
    }, [isTranslating, onEnhancePrompt, prompt, replacePrompt]);

    useEffect(() => {
        if (!activeProductModel || generationMode === 'text') return;
        const capabilities = activeProductModel.capabilities;
        if (!capabilities.modes.includes(activeSubmode)) {
            onGenerationSubmodeChange?.(capabilities.modes[0]);
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
    }, [activeProductModel, activeRatio, activeSubmode, generationMode, onGenerationSubmodeChange, onVideoDurationSecChange, onVideoResolutionChange, setActiveRatio, videoDurationSec, videoResolution]);

    useEffect(() => {
        if (autoFocus || focusSignal !== undefined) richEditorRef.current?.focus();
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
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setExpandedPanel(null);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
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
                    {imageReferenceChips && imageReferenceChips.length > 0 && onImageReferenceReorder && (
                        <div
                            className={`${compactMode ? 'mb-2' : 'mb-2.5'} flex items-center gap-1.5 overflow-x-auto isl-scrollbar pb-1`}
                            data-testid="prompt-image-refs"
                        >
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--isl-ink-soft)' }}>参考</span>
                            <Reorder.Group
                                axis="x"
                                values={imageReferenceChips}
                                onReorder={next => onImageReferenceReorder(next.map(chip => chip.id))}
                                className="list-none m-0 p-0 flex items-center gap-1.5"
                            >
                                {imageReferenceChips.map((chip, index) => (
                                    <Reorder.Item
                                        key={chip.id}
                                        value={chip}
                                        className="group flex shrink-0 list-none items-center gap-1.5 rounded-[14px] border px-1.5 py-1"
                                        style={{
                                            borderColor: chip.mentioned ? 'var(--isl-mint)' : 'var(--isl-border)',
                                            background: chip.mentioned ? 'var(--isl-mint-bg)' : 'var(--isl-surface-2)',
                                            cursor: 'grab',
                                        }}
                                        title={chip.mentioned ? `${chip.label} · 已上送 Provider` : `${chip.label} · 连线但未 @ 引用（不会上送）`}
                                        whileDrag={{ scale: 1.06, boxShadow: '0 6px 18px rgba(99,102,241,0.18)' }}
                                    >
                                        <span
                                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-black"
                                            style={{ background: chip.mentioned ? 'var(--isl-mint-deep)' : 'var(--isl-surface-2)', color: chip.mentioned ? '#fff' : 'var(--isl-ink-soft)' }}
                                        >{index + 1}</span>
                                        <div className="h-7 w-7 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--isl-border)' }}>
                                            {chip.elementType === 'audio' ? (
                                                <div className="flex h-full w-full items-center justify-center text-[10px] font-bold" style={{ color: 'var(--isl-mint-deep)', background: 'var(--isl-mint-bg)' }}>AU</div>
                                            ) : chip.elementType === 'video' ? (
                                                chip.thumbnail ? <video src={chip.thumbnail} className="h-full w-full object-cover" muted playsInline /> : <div className="flex h-full w-full items-center justify-center text-[10px]">🎬</div>
                                            ) : (
                                                chip.thumbnail ? <img src={chip.thumbnail} alt={chip.label} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[10px]">🖼</div>
                                            )}
                                        </div>
                                        <span className="max-w-[96px] truncate text-[11px] font-bold" style={{ color: 'var(--isl-ink)' }}>{chip.label}</span>
                                        {onImageReferenceRemove && (
                                            <button
                                                type="button"
                                                onClick={() => onImageReferenceRemove(chip.id)}
                                                onPointerDown={event => event.stopPropagation()}
                                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition hover:bg-black/5"
                                                style={{ color: 'var(--isl-ink-soft)' }}
                                                title="断开该参考图连线"
                                                aria-label={`移除参考图 ${chip.label}`}
                                            >
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                            </button>
                                        )}
                                    </Reorder.Item>
                                ))}
                            </Reorder.Group>
                        </div>
                    )}

                    <RichPromptEditor
                        ref={richEditorRef}
                        canvasItems={canvasItems}
                        placeholder={placeholder}
                        onTextChange={handleEditorChange}
                        onSubmit={handleEditorSubmit}
                        initialText={prompt}
                        initialDocument={promptDocument}
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
                    <div className="border-t border-[var(--isl-border)] bg-[var(--isl-card)]/90 backdrop-blur-md animate-slideDown" onWheel={event => event.stopPropagation()}>
                        <div className="max-h-[45vh] overflow-y-auto overscroll-contain isl-scrollbar p-3" onWheel={event => event.stopPropagation()}>
                            {expandedPanel === 'model' && (
                                <>
                                    <PopoverHeader title="选择模型" subtitle="固定产品模型，实际 API 线路在设置中映射" />
                                    <div className="px-1 pb-2">
                                        <input
                                            type="text"
                                            value={modelSearchQuery}
                                            onChange={(event) => setModelSearchQuery(event.target.value)}
                                            placeholder="搜索模型、公司或能力..."
                                            className="w-full rounded-[14px] border-[1.5px] px-3 py-2 text-xs"
                                            style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)', color: 'var(--isl-ink)', outline: 'none' }}
                                        />
                                    </div>
                                    <div className="space-y-3 px-1 pb-2">
                                        {activeProductModel
                                            ? productModelGroups.map(group => {
                                                const filtered = group.models.filter(product => {
                                                    if (!modelSearchQuery) return true;
                                                    const haystack = `${product.name} ${product.shortName} ${product.company} ${product.badge || ''} ${product.description}`.toLowerCase();
                                                    return haystack.includes(modelSearchQuery.toLowerCase());
                                                });
                                                if (!filtered.length) return null;
                                                return (
                                                    <div key={group.company}>
                                                        <div className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--isl-ink-soft)' }}>{group.company}</div>
                                                        <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 isl-scrollbar">
                                                            {filtered.map(product => {
                                                                const configured = isProductModelConfigured(product.id, userApiKeys);
                                                                const selected = activeModel === product.id || getProductModel(activeModel)?.id === product.id;
                                                                const route = resolveProductModelRoute(product.id, userApiKeys);
                                                                return (
                                                                    <button
                                                                        key={product.id}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            if (!configured) { onOpenSettings?.(); setExpandedPanel(null); return; }
                                                                            changeActiveModel(product.id);
                                                                            setExpandedPanel(null);
                                                                        }}
                                                                        className={`group relative min-h-[126px] min-w-[196px] snap-start overflow-hidden rounded-[20px] border-[1.5px] p-3 text-left transition-all duration-200 ${selected ? 'isl-chip--active -translate-y-0.5' : 'isl-chip'} ${configured ? 'hover:-translate-y-1' : 'cursor-pointer opacity-55 hover:opacity-80'}`}
                                                                    >
                                                                        <span className="flex items-start justify-between gap-2">
                                                                            <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--isl-surface-2)] text-[11px] font-black">{product.shortName}</span>
                                                                            <span className="rounded-full bg-[var(--isl-surface-2)] px-2 py-1 text-[10px] font-bold" style={{ color: configured ? 'var(--isl-mint-deep)' : 'var(--isl-ink-soft)' }}>
                                                                                {configured ? product.badge || '已连接' : '去配置'}
                                                                            </span>
                                                                        </span>
                                                                        <span className="mt-3 block truncate text-sm font-extrabold">{product.name}</span>
                                                                        <span className="mt-1 block line-clamp-2 text-[10px] leading-4" style={{ color: 'var(--isl-ink-soft)' }}>{product.description}</span>
                                                                        <span className="mt-2 block truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>{route ? `${route.key.name || route.key.provider} · ${route.upstreamModelId}` : product.company}</span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                            : currentModelOptions
                                                .filter(model => !modelSearchQuery || modelRefSearchText(model, userApiKeys).includes(modelSearchQuery.toLowerCase()))
                                                .map(model => (
                                                    <button key={model} type="button" onClick={() => { changeActiveModel(model); setExpandedPanel(null); }} className={`min-w-[184px] rounded-[18px] border-[1.5px] p-3 text-left ${activeModel === model ? 'isl-chip--active' : 'isl-chip'}`}>
                                                        <span className="block text-xs font-bold">{modelRefLabel(model, userApiKeys)}</span>
                                                    </button>
                                                ))}
                                        {(() => {
                                            if (activeProductModel) {
                                                const none = productModelGroups.every(group => !group.models.some(product => {
                                                    if (!modelSearchQuery) return true;
                                                    return `${product.name} ${product.shortName} ${product.company} ${product.badge || ''} ${product.description}`.toLowerCase().includes(modelSearchQuery.toLowerCase());
                                                }));
                                                return none ? <div className="px-3 py-5 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>没有匹配的模型</div> : null;
                                            }
                                            return currentModelOptions.filter(model => !modelSearchQuery || modelRefSearchText(model, userApiKeys).includes(modelSearchQuery.toLowerCase())).length === 0
                                                ? <div className="px-3 py-5 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>没有匹配的模型</div>
                                                : null;
                                        })()}
                                    </div>
                                    {!activeRoute && activeProductModel && (
                                        <button type="button" onClick={onOpenSettings} className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center justify-between rounded-[14px] bg-[var(--isl-surface-2)] px-3 py-2 text-xs font-bold">
                                            <span>{activeProductModel.name} 尚未映射 API 线路</span><span>去配置 →</span>
                                        </button>
                                    )}
                                </>
                            )}
                            {expandedPanel === 'parameters' && activeProductModel && (
                                <>
                                    <PopoverHeader title="生成参数" subtitle={`${activeProductModel.name} 仅显示官方支持的选项`} />
                                    <div className="space-y-3 px-1 pb-1">
                                        {activeProductModel.capabilities.modes.length > 1 && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>生成方式</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {activeProductModel.capabilities.modes.map(mode => (
                                                        <button key={mode} type="button" aria-pressed={activeSubmode === mode} onClick={() => onGenerationSubmodeChange?.(mode)} className={`rounded-[12px] px-3 py-2 text-xs font-bold ${activeSubmode === mode ? 'isl-chip--active' : 'isl-chip'}`}>{PRODUCT_MODE_LABELS[mode]}</button>
                                                    ))}
                                                </div>
                                                {activeSubmode === 'image-to-video' && <div className="mt-2 rounded-[12px] bg-[var(--isl-surface-2)] px-3 py-2 text-[11px] text-[var(--isl-ink-soft)]">第一个按顺序引用的图片会作为首帧。</div>}
                                                {activeSubmode === 'reference-to-video' && <div className="mt-2 rounded-[12px] bg-[var(--isl-surface-2)] px-3 py-2 text-[11px] text-[var(--isl-ink-soft)]">引用媒体只用于角色、产品或风格保持，不会被误当成首帧。</div>}
                                                {activeSubmode === 'first-last-frame' && <div className="mt-2 rounded-[12px] bg-[var(--isl-surface-2)] px-3 py-2 text-[11px] text-[var(--isl-ink-soft)]">需要按顺序引用两张图片：第一张是首帧，第二张是尾帧。</div>}
                                            </div>
                                        )}
                                        {activeProductModel.capabilities.qualities.length > 0 && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>画质</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {activeProductModel.capabilities.qualities.map(quality => (
                                                        <button key={quality} type="button" onClick={() => onGenerationQualityChange?.(quality)} className={`rounded-[12px] px-3 py-2 text-xs font-bold ${generationQuality === quality ? 'isl-chip--active' : 'isl-chip'}`}>{quality === 'low' ? '低' : quality === 'medium' ? '标准' : '高'}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {activeProductModel.capabilities.resolutions.length > 0 && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>{generationMode === 'video' ? '清晰度' : '尺寸'}</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {activeProductModel.capabilities.resolutions.map(resolution => (
                                                        <button key={resolution} type="button" onClick={() => onVideoResolutionChange?.(resolution)} className={`rounded-[12px] px-3 py-2 text-xs font-bold ${videoResolution === resolution ? 'isl-chip--active' : 'isl-chip'}`}>{resolution}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {activeProductModel.capabilities.aspectRatios.length > 0 && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>比例</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {activeProductModel.capabilities.aspectRatios.map(ratio => (
                                                        <button key={ratio} type="button" onClick={() => setActiveRatio(ratio)} className={`rounded-[12px] px-3 py-2 text-xs font-bold ${activeRatio === ratio ? 'isl-chip--active' : 'isl-chip'}`}>{ratio === 'adaptive' ? '自适应' : ratio}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {generationMode === 'video' && activeProductModel.capabilities.durations.length > 0 && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>时长</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {activeProductModel.capabilities.durations.map(duration => (
                                                        <button key={duration} type="button" onClick={() => onVideoDurationSecChange?.(duration)} className={`rounded-[12px] px-3 py-2 text-xs font-bold ${videoDurationSec === duration ? 'isl-chip--active' : 'isl-chip'}`}>{duration === -1 ? '智能' : `${duration}s`}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {generationMode === 'video' && activeProductModel.capabilities.audioControl === 'optional' && (
                                            <button type="button" onClick={() => onVideoGenerateAudioChange?.(!videoGenerateAudio)} className={`w-full rounded-[14px] px-3 py-2 text-left text-xs font-bold ${videoGenerateAudio ? 'isl-chip--active' : 'isl-chip'}`}>生成音频 {videoGenerateAudio ? 'ON' : 'OFF'}</button>
                                        )}
                                        {generationMode === 'video' && activeProductModel.capabilities.audioControl === 'always' && <div className="rounded-[14px] bg-[var(--isl-surface-2)] px-3 py-2 text-xs font-bold text-[var(--isl-ink-soft)]">该模型始终生成原生音频</div>}
                                        {activeProductModel.id.startsWith('flovart:veo-3.1') && (activeSubmode === 'reference-to-video' || videoResolution?.toLowerCase() !== '720p') && <div className="rounded-[14px] bg-[var(--isl-mint-bg)] px-3 py-2 text-[11px] font-semibold text-[var(--isl-mint-deep)]">当前 Veo 组合按官方约束固定为 8 秒。</div>}
                                        {(generationMode === 'image' || (generationMode === 'video' && allowVideoBatch)) && onBatchCountChange && (
                                            <div>
                                                <div className="mb-1.5 text-[10px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>数量</div>
                                                <div className="flex gap-1.5">
                                                    {[1, 2, 4].map(count => (
                                                        <button key={count} type="button" onClick={() => onBatchCountChange(count)} className={`rounded-[12px] px-3 py-2 text-xs font-bold ${batchCount === count ? 'isl-chip--active' : 'isl-chip'}`} aria-pressed={batchCount === count}>{count === 1 ? '×1' : `×${count}`}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                            {expandedPanel === 'advanced' && activeProductModel && (
                                <>
                                    <PopoverHeader title="高级选项" subtitle="不受支持的能力已隐藏" />
                                    <div className="space-y-2 px-1 pb-1">
                                        {activeProductModel.capabilities.supportsWebSearch && (
                                            <button type="button" onClick={() => onWebSearchToggle?.(!webSearchEnabled)} className={`flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left text-xs font-bold ${webSearchEnabled ? 'isl-chip--active' : 'isl-chip'}`}><span>联网搜索</span><span>{webSearchEnabled ? 'ON' : 'OFF'}</span></button>
                                        )}
                                        {activeProductModel.capabilities.supportsRealPersonCheck && (
                                            <button type="button" onClick={() => onRealPersonCheckToggle?.(!realPersonCheckEnabled)} className={`flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-left text-xs font-bold ${realPersonCheckEnabled ? 'isl-chip--active' : 'isl-chip'}`}><span>真人素材预检测</span><span>{realPersonCheckEnabled ? 'ON' : 'OFF'}</span></button>
                                        )}
                                        {!activeProductModel.capabilities.supportsWebSearch && !activeProductModel.capabilities.supportsRealPersonCheck && (
                                            <div className="rounded-[14px] bg-[var(--isl-surface-2)] px-3 py-3 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>当前模型没有额外的高级选项。</div>
                                        )}
                                    </div>
                                </>
                            )}
                            {expandedPanel === 'more' && (
                                <>
                                    <PopoverHeader title="更多操作" subtitle="参考图、角色锁定、效果存储" />
                                    {isSeedanceVideoModel && (
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
                                        {onAddAttachments && (
                                            <MenuOptionButton
                                                label="上传参考图"
                                                description="点击选择，或直接把图片拖到输入框"
                                                onClick={() => {
                                                    fileInputRef.current?.click();
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

                                        {canvasElements.length > 0 && (
                                            <div className="rounded-2xl px-3 py-3 text-sm" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)' }}>
                                                在输入框里输入 <span className="font-bold" style={{ color: 'var(--isl-mint-deep)' }}>@</span>，可直接引用画布里的元素卡片。
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                <div className={`relative flex items-end gap-3 border-t ${compactMode ? 'px-2.5 py-2' : 'px-3 py-2.5'}`} style={{ borderColor: 'var(--isl-border)' }}>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                                const keyCount = userApiKeys.length;
                                if (keyCount === 0) {
                                    return (
                                        <button
                                            type="button"
                                            onClick={onOpenSettings}
                                            className={`isl-chip border-dashed ${compactMode ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs'}`}
                                            style={{ borderColor: 'var(--isl-coral)', color: 'var(--isl-coral-deep)' }}
                                        >
                                            🔑 未配置 API Key
                                        </button>
                                    );
                                }
                                return null;
                            })()}

                            <div className="relative">
                                <button type="button" onClick={() => setExpandedPanel(prev => (prev === 'model' ? null : 'model'))} className={`${triggerClass} ${expandedPanel === 'model' ? activeTriggerClass : ''}`}>
                                    <span className="max-w-[150px] truncate">{getModelLabel(generationMode, selectedTextModel, selectedImageModel, selectedVideoModel, userApiKeys)}</span>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                                </button>
                            </div>

                            {activeProductModel && (
                                <button type="button" onClick={() => setExpandedPanel(prev => (prev === 'parameters' ? null : 'parameters'))} className={`${triggerClass} ${expandedPanel === 'parameters' ? activeTriggerClass : ''}`} title="生成参数">
                                    <span className="max-w-[220px] truncate">{paramSummary || '参数'}</span>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={onAutoEnhanceToggle}
                                title={isAutoEnhanceEnabled ? '关闭自动润色（生成前不再自动优化提示词）' : '开启自动润色（生成前自动用 LLM 优化提示词）'}
                                className={`isl-chip ${compactMode ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs'} ${isAutoEnhanceEnabled ? 'isl-chip--active' : ''}`}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
                                </svg>
                                <span className="sr-only">{isAutoEnhanceEnabled ? '润色已开启' : '润色'}</span>
                            </button>

                            <button type="button" onClick={() => void handleTranslatePrompt()} disabled={!onEnhancePrompt || !prompt.trim() || isTranslating} className={`${triggerClass} disabled:cursor-not-allowed disabled:opacity-40`} title="翻译提示词">
                                <span className="text-sm font-black">译</span><span className="sr-only">翻译提示词</span>
                            </button>

                            {activeProductModel && (
                                <button type="button" onClick={() => setExpandedPanel(prev => (prev === 'advanced' ? null : 'advanced'))} className={`${triggerClass} ${expandedPanel === 'advanced' ? activeTriggerClass : ''}`} title="高级选项">
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" /></svg>
                                    <span className="sr-only">高级选项</span>
                                </button>
                            )}

                            <div className="relative">
                                <button type="button" onClick={() => setExpandedPanel(prev => (prev === 'more' ? null : 'more'))} className={`${triggerClass} ${expandedPanel === 'more' ? activeTriggerClass : ''}`} title="更多操作">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        {(generationMode === 'image' || generationMode === 'video' && allowVideoBatch) && onBatchCountChange && (
                            <div
                                className="isl-well flex h-9 items-center p-1"
                                title="批量方案数量"
                            >
                                {[1, 2, 4].map(count => {
                                    const active = batchCount === count;
                                    return (
                                        <button
                                            key={count}
                                            type="button"
                                            onClick={() => onBatchCountChange(count)}
                                            className={`flex h-7 min-w-[38px] items-center justify-center rounded-[12px] px-2 text-[11px] font-bold transition ${
                                                active ? 'isl-chip--active' : ''
                                            }`}
                                            style={active ? undefined : { color: 'var(--isl-ink-soft)' }}
                                            aria-pressed={active}
                                            title={count === 1 ? '单张方案' : `输出 ${count} 张方案`}
                                        >
                                            X{count}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {error && onRetry && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (isSeedanceVideoModel && !window.confirm('Seedance 重试会创建一个全新任务，可能再次消耗额度。确定继续吗？')) return;
                                    onRetry();
                                }}
                                className={`isl-chip ${compactMode ? 'h-9 px-3 text-xs' : 'h-10 px-4 text-sm'}`}
                                style={{ borderColor: 'var(--isl-coral)', color: 'var(--isl-coral-deep)' }}
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
                                else if (prompt.trim() && readyState !== 'missing-key') onGenerate();
                            }}
                            disabled={(isLoading && !onStop) || (!isLoading && (!prompt.trim() || readyState === 'missing-key'))}
                            aria-label={isLoading && onStop ? (isSeedanceVideoModel ? '停止等待' : '停止生成') : t('promptBar.generate')}
                            title={isLoading && onStop ? (isSeedanceVideoModel ? '停止本地等待；不代表供应商任务已取消，仍可能消耗额度' : '停止生成') : t('promptBar.generate')}
                            className={`isl-go ${compactMode ? 'h-9 min-w-[104px] px-4 text-xs' : 'h-10 min-w-[116px] px-5 text-sm'}`}
                        >
                            {isLoading && !onStop ? (
                                <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
                                </svg>
                            ) : isLoading ? <span className="text-xs font-semibold">{isSeedanceVideoModel ? '停止等待' : '停止'}</span> : (
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
        </div>
    );
};
