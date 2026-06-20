import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    CharacterLockProfile,
    ChatAttachment,
    Element,
    GenerationMode,
    PromptEnhanceMode,
    PromptEnhanceResult,
    UserApiKey,
    UserEffect,
} from '../types';
import RichPromptEditor, { type RichPromptEditorHandle } from './RichPromptEditor';
import type { MentionItem } from './MentionList';
export type { MentionItem } from './MentionList';
import { extractMentions } from './CanvasMentionExtension';
import { inferProviderFromModel, PROVIDER_LABELS, getModelCapabilityTags, getSupportedRatios, type VideoAspectRatio } from '../services/aiGateway';
import { SOCIAL_PRESETS } from '../utils/socialPresets';
import { readColdMedia } from '../utils/mediaIndexedDB';
import { modelRefLabel, modelRefModelId, modelRefProvider, modelRefSearchText } from '../utils/modelRefs';

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
    videoAspectRatio: VideoAspectRatio;
    setVideoAspectRatio: (ratio: VideoAspectRatio) => void;
    videoDurationSec?: number;
    onVideoDurationSecChange?: (durationSec: number) => void;
    videoResolution?: string;
    onVideoResolutionChange?: (resolution: string) => void;
    videoGenerateAudio?: boolean;
    onVideoGenerateAudioChange?: (enabled: boolean) => void;
    videoWatermark?: boolean;
    onVideoWatermarkChange?: (enabled: boolean) => void;
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

type ExpandPanel = 'mode' | 'model' | 'more' | null;

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

function getModelLabel(mode: GenerationMode, textModel?: string, imageModel?: string, videoModel?: string, userApiKeys: UserApiKey[] = []): string {
    const model = mode === 'text' ? textModel : mode === 'video' ? videoModel : imageModel;
    if (!model) return mode === 'text' ? '选择文本模型' : mode === 'video' ? '选择视频模型' : '选择图片模型';
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

const SEEDANCE_DURATIONS = [-1, 4, 5, 6, 8, 10, 12, 15] as const;
const SEEDANCE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
const DEFAULT_VIDEO_RATIOS: VideoAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

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
    videoAspectRatio,
    setVideoAspectRatio,
    videoDurationSec = 5,
    onVideoDurationSecChange,
    videoResolution = '720p',
    onVideoResolutionChange,
    videoGenerateAudio = true,
    onVideoGenerateAudioChange,
    videoWatermark = false,
    onVideoWatermarkChange,
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

    /** 当前视频模型支持的比例列表 */
    const isSeedanceVideoModel = useMemo(() => {
        return generationMode === 'video' && !!selectedVideoModel && modelRefModelId(selectedVideoModel).toLowerCase().includes('seedance');
    }, [generationMode, selectedVideoModel]);
    const isSeedanceFastModel = isSeedanceVideoModel && modelRefModelId(selectedVideoModel).toLowerCase().includes('fast');
    const supportedRatios = useMemo(() => {
        if (!selectedVideoModel) return DEFAULT_VIDEO_RATIOS;
        return getSupportedRatios(modelRefModelId(selectedVideoModel));
    }, [selectedVideoModel]);

    const currentModelOptions = generationMode === 'text' ? textModelOptions : generationMode === 'video' ? videoModelOptions : imageModelOptions;
    const activeKey = userApiKeys.find(k => k.isDefault) || userApiKeys[0];
    const activeModel = generationMode === 'text' ? selectedTextModel : generationMode === 'video' ? selectedVideoModel : selectedImageModel;
    const changeActiveModel = (model: string) => generationMode === 'text' ? onTextModelChange?.(model) : generationMode === 'video' ? onVideoModelChange?.(model) : onImageModelChange?.(model);
    const promptCharCount = prompt.trim().length;
    const readyState = !activeKey
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
        if (latestPromptRef.current.trim() && !isLoading) onGenerate();
    }, [isLoading, onGenerate]);

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
                    <div className="border-t border-[var(--isl-border)] bg-[var(--isl-card)]/90 backdrop-blur-md animate-slideDown">
                        <div className="max-h-[45vh] isl-scrollbar p-3">
                            {expandedPanel === 'mode' && (
                                <>
                                    <PopoverHeader title="生成类型" subtitle="选择图片、视频或首尾帧模式" />
                                    <div className="space-y-1">
                                        {modeOptions.map(mode => (
                                            <MenuOptionButton key={mode} label={getModeLabel(mode)} active={generationMode === mode} onClick={() => { setGenerationMode(mode); setExpandedPanel(null); }} />
                                        ))}
                                    </div>
                                </>
                            )}
                            {expandedPanel === 'model' && (
                                <>
                                    <PopoverHeader title="模型设置" subtitle="选择生成模型" />
                                    <div className="max-h-[280px] space-y-1 pr-1">
                                        <div className="px-1 pb-2">
                                            <input
                                                type="text"
                                                value={modelSearchQuery}
                                                onChange={(e) => setModelSearchQuery(e.target.value)}
                                                placeholder="搜索模型..."
                                                className="w-full rounded-[14px] border-[1.5px] px-3 py-1.5 text-xs"
                                                style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)', color: 'var(--isl-ink)', outline: 'none' }}
                                            />
                                        </div>
                                        {!modelSearchQuery && recentModels.filter(m => currentModelOptions.includes(m)).length > 0 && (
                                            <>
                                                <div className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--isl-ink-ghost)' }}>常用</div>
                                                {recentModels.filter(m => currentModelOptions.includes(m)).slice(0, MAX_RECENT_MODELS).map(model => {
                                                    const bareModel = modelRefModelId(model);
                                                    const capTags = getModelCapabilityTags(bareModel);
                                                    const shortName = modelRefLabel(model, userApiKeys).replace(/^(google|openai|anthropic|openrouter)\//, '');
                                                    const selectedModel = activeModel;
                                                    return (
                                                        <MenuOptionButton
                                                            key={`recent-${model}`}
                                                            label={capTags ? `${capTags} ${shortName}` : shortName}
                                                            active={selectedModel === model}
                                                            onClick={() => {
                                                                addRecentModel(model);
                                                                setRecentModels(getRecentModels());
                                                                changeActiveModel(model);
                                                                setExpandedPanel(null);
                                                            }}
                                                        />
                                                    );
                                                })}
                                                <div className="border-t border-[var(--isl-border)] my-1" />
                                            </>
                                        )}
                                        <div className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--isl-ink-ghost)' }}>{generationMode === 'text' ? '文本模型' : generationMode === 'video' ? '视频模型' : '图片模型'}</div>
                                        {(() => {
                                            const filtered = modelSearchQuery
                                                ? currentModelOptions.filter(m => modelRefSearchText(m, userApiKeys).includes(modelSearchQuery.toLowerCase()))
                                                : currentModelOptions;
                                            const grouped = new Map<string, string[]>();
                                            for (const model of filtered) {
                                                const provider = modelRefProvider(model, userApiKeys);
                                                const label = PROVIDER_LABELS[provider] || provider;
                                                if (!grouped.has(label)) grouped.set(label, []);
                                                grouped.get(label)!.push(model);
                                            }
                                            const selectedModel = activeModel;
                                            if (filtered.length === 0 && modelSearchQuery) {
                                                return <div className="px-2 py-3 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>没有匹配的模型</div>;
                                            }
                                            return Array.from(grouped.entries()).map(([providerLabel, models]) => (
                                                <div key={providerLabel}>
                                                    {grouped.size > 1 && (
                                                        <div className="mt-1.5 px-2 pb-0.5 text-[10px] font-bold tracking-wide" style={{ color: 'var(--isl-mint-deep)' }}>
                                                            {providerLabel}
                                                        </div>
                                                    )}
                                                    {models.map(model => {
                                                        const bareModel = modelRefModelId(model);
                                                        const capTags = getModelCapabilityTags(bareModel);
                                                        const shortName = modelRefLabel(model, userApiKeys).replace(/^(google|openai|anthropic|openrouter)\//, '');
                                                        return (
                                                        <MenuOptionButton
                                                            key={model}
                                                            label={capTags ? `${capTags} ${shortName}` : shortName}
                                                            active={selectedModel === model}
                                                            onClick={() => {
                                                                addRecentModel(model);
                                                                setRecentModels(getRecentModels());
                                                                changeActiveModel(model);
                                                                setExpandedPanel(null);
                                                            }}
                                                        />
                                                        );
                                                    })}
                                                </div>
                                            ));
                                        })()}

                                        {generationMode === 'video' && (
                                            <>
                                            <div className="grid grid-cols-4 gap-2 px-1 pt-3">
                                                {((isSeedanceVideoModel ? [...DEFAULT_VIDEO_RATIOS, 'adaptive'] : DEFAULT_VIDEO_RATIOS) as VideoAspectRatio[]).map(ratio => {
                                                    const supported = (supportedRatios as readonly string[]).includes(ratio);
                                                    return (
                                                    <button
                                                        key={ratio}
                                                        type="button"
                                                        disabled={!supported}
                                                        onClick={() => setVideoAspectRatio(ratio)}
                                                        title={supported ? undefined : '当前视频模型不支持此比例'}
                                                        className={`rounded-2xl border-[1.5px] px-3 py-2 text-sm font-bold transition ${!supported ? 'opacity-35 cursor-not-allowed' : ''} ${videoAspectRatio === ratio ? 'isl-chip--active' : 'isl-chip'}`}
                                                    >
                                                        {ratio === 'adaptive' ? '自适应' : ratio}
                                                    </button>
                                                    );
                                                })}
                                            </div>
                                            <div className="px-1 pt-2">
                                                <p className="text-xs mb-1.5" style={{ color: 'var(--isl-ink-soft)' }}>平台预设</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {Object.entries(SOCIAL_PRESETS).map(([key, preset]) => (
                                                        <div key={key} className="relative group">
                                                            <button
                                                                type="button"
                                                                className="isl-chip px-2.5 py-1 text-xs"
                                                                onClick={() => setVideoAspectRatio(preset.ratios[0].ratio)}
                                                                title={preset.ratios.map(r => `${r.desc}: ${r.ratio}`).join(', ')}
                                                            >
                                                                {preset.label}
                                                            </button>
                                                            {preset.ratios.length > 1 && (
                                                                <div className="isl-pop absolute bottom-full left-0 mb-1 hidden group-hover:flex flex-col p-1 min-w-[140px]" style={{ zIndex: 1 }}>
                                                                    {preset.ratios.map(r => (
                                                                        <button
                                                                            key={r.desc}
                                                                            type="button"
                                                                            className={`text-left rounded-md px-2 py-1 text-xs transition ${videoAspectRatio === r.ratio ? 'font-bold' : ''}`}
                                                                            style={{ color: videoAspectRatio === r.ratio ? 'var(--isl-mint-deep)' : 'var(--isl-ink)' }}
                                                                            onClick={() => setVideoAspectRatio(r.ratio)}
                                                                        >
                                                                            {r.desc} ({r.ratio})
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {isSeedanceVideoModel && (
                                                <div className="mx-1 mt-3 rounded-[18px] border-[1.5px] p-3" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)' }}>
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div>
                                                            <div className="text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>Seedance 参数</div>
                                                            <div className="mt-0.5 text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>节点级视频设置，会随当前节点保存</div>
                                                        </div>
                                                        {isSeedanceFastModel && (
                                                            <span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ color: 'var(--isl-sun-deep)', background: 'rgba(251,191,36,0.14)' }}>
                                                                Fast 最高 720p
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="mt-3">
                                                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--isl-ink-soft)' }}>时长</div>
                                                        <div className="grid grid-cols-4 gap-1.5">
                                                            {SEEDANCE_DURATIONS.map(duration => (
                                                                <button
                                                                    key={duration}
                                                                    type="button"
                                                                    onClick={() => onVideoDurationSecChange?.(duration)}
                                                                    className={`rounded-[12px] px-2 py-1.5 text-xs font-bold transition ${videoDurationSec === duration ? 'isl-chip--active' : 'isl-chip'}`}
                                                                    title={duration === -1 ? '智能时长' : `${duration} 秒`}
                                                                >
                                                                    {duration === -1 ? '智能' : `${duration}s`}
                                                                </button>
                                                            ))}
                                                        </div>
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
                                            </>
                                        )}
                                    </div>
                                </>
                            )}
                            {expandedPanel === 'more' && (
                                <>
                                    <PopoverHeader title="更多操作" subtitle="参考图、角色锁定、效果存储" />
                                    <div className="space-y-1">
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
                                const defaultKey = userApiKeys.find(k => k.isDefault);
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
                                return (
                                    <button
                                        type="button"
                                        onClick={onOpenSettings}
                                        className={`isl-chip ${compactMode ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs'}`}
                                        title={`已配置 ${keyCount} 个 Key，点击打开设置管理`}
                                    >
                                        <span className={`inline-block h-2 w-2 rounded-full ${defaultKey?.status === 'ok' ? 'bg-green-500' : 'bg-yellow-400'}`} />
                                        <span className="max-w-[100px] truncate">{defaultKey?.name || defaultKey?.provider || 'API Key'}</span>
                                        {keyCount > 1 && <span className="text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>+{keyCount - 1}</span>}
                                    </button>
                                );
                            })()}


                            <div className="relative">
                                {modeOptions.length > 1 ? (
                                    <>
                                        <button type="button" onClick={() => setExpandedPanel(prev => (prev === 'mode' ? null : 'mode'))} className={`${triggerClass} ${expandedPanel === 'mode' ? activeTriggerClass : ''}`}>
                                            {getModeLabel(generationMode)}
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                                        </button>
                                    </>
                                ) : (
                                    <div className={`${triggerClass} cursor-default`}>
                                        {getModeLabel(generationMode)}
                                    </div>
                                )}
                            </div>

                            <div className="relative">
                                <button type="button" onClick={() => setExpandedPanel(prev => (prev === 'model' ? null : 'model'))} className={`${triggerClass} ${expandedPanel === 'model' ? activeTriggerClass : ''}`}>
                                    <span className="max-w-[150px] truncate">{getModelLabel(generationMode, selectedTextModel, selectedImageModel, selectedVideoModel, userApiKeys)}</span>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={onAutoEnhanceToggle}
                                title={isAutoEnhanceEnabled ? '关闭自动润色（生成前不再自动优化提示词）' : '开启自动润色（生成前自动用 LLM 优化提示词）'}
                                className={`isl-chip ${compactMode ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs'} ${isAutoEnhanceEnabled ? 'isl-chip--active' : ''}`}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
                                </svg>
                                {isAutoEnhanceEnabled ? '润色 ON' : '润色'}
                            </button>

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
                                onClick={onRetry}
                                className={`isl-chip ${compactMode ? 'h-9 px-3 text-xs' : 'h-10 px-4 text-sm'}`}
                                style={{ borderColor: 'var(--isl-coral)', color: 'var(--isl-coral-deep)' }}
                                title="使用相同参数重新生成"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6"/><path d="M3.5 16.5A9 9 0 1 0 2 12"/></svg>
                                <span className="ml-1">重试</span>
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={() => {
                                if (isLoading && onStop) onStop();
                                else if (prompt.trim()) onGenerate();
                            }}
                            disabled={(isLoading && !onStop) || (!isLoading && !prompt.trim())}
                            aria-label={isLoading && onStop ? '停止生成' : t('promptBar.generate')}
                            title={isLoading && onStop ? '停止生成' : t('promptBar.generate')}
                            className={`isl-go ${compactMode ? 'h-9 min-w-[104px] px-4 text-xs' : 'h-10 min-w-[116px] px-5 text-sm'}`}
                        >
                            {isLoading && !onStop ? (
                                <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
                                </svg>
                            ) : isLoading ? <span className="text-xs font-semibold">停止</span> : (
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

