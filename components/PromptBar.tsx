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
import { extractMentions } from './CanvasMentionExtension';
import { inferProviderFromModel, PROVIDER_LABELS, getModelCapabilityTags, getSupportedRatios } from '../services/aiGateway';
import { SOCIAL_PRESETS } from '../utils/socialPresets';

interface PromptBarProps {
    t: (key: string, ...args: any[]) => string;
    theme: 'light' | 'dark';
    compactMode?: boolean;
    prompt: string;
    setPrompt: (prompt: string) => void;
    onGenerate: () => void;
    isLoading: boolean;
    isSelectionActive: boolean;
    selectedElementCount: number;
    userEffects: UserEffect[];
    onAddUserEffect: (effect: UserEffect) => void;
    onDeleteUserEffect: (id: string) => void;
    generationMode: GenerationMode;
    setGenerationMode: (mode: GenerationMode) => void;
    videoAspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
    setVideoAspectRatio: (ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9') => void;
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
    attachments?: ChatAttachment[];
    onAddAttachments?: (files: FileList | File[]) => void;
    onRemoveAttachment?: (id: string) => void;
    onMentionedElementIds?: (ids: string[]) => void;
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
    variant?: 'global' | 'inline';
    className?: string;
    shellClassName?: string;
    hideApiStatus?: boolean;
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

function getModeLabel(mode: GenerationMode): string {
    if (mode === 'video') return '视频';
    if (mode === 'keyframe') return '首尾帧';
    return '图片';
}

function getModelLabel(mode: GenerationMode, imageModel?: string, videoModel?: string): string {
    const model = mode === 'video' ? videoModel : imageModel;
    if (!model) return mode === 'video' ? '选择视频模型' : '选择图片模型';
    const provider = inferProviderFromModel(model);
    const shortProvider = PROVIDER_LABELS[provider]?.split(' ')[0] || provider;
    return `${shortProvider} · ${model.replace(/^(google|openai|anthropic|openrouter)\//, '')}`;
}

const PopoverHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
    <div className="px-2 pb-1.5">
        <div className="text-xs font-semibold text-[var(--text-primary)]">{title}</div>
        {subtitle && <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{subtitle}</div>}
    </div>
);

const MenuOptionButton: React.FC<{ label: string; active?: boolean; description?: string; onClick: () => void }> = ({ label, active = false, description, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left transition ${
            active ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--panel-muted)]'
        }`}
    >
        <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{label}</span>
            {description && <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">{description}</span>}
        </span>
        {active && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="m5 13 4 4L19 7" />
            </svg>
        )}
    </button>
);

const isSupportedAttachment = (type: string) => type.startsWith('image/') || type.startsWith('video/');

export const PromptBar: React.FC<PromptBarProps> = ({
    t,
    theme,
    compactMode = false,
    prompt,
    setPrompt,
    onGenerate,
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
    attachments = [],
    onAddAttachments,
    onRemoveAttachment,
    onMentionedElementIds,
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
    variant = 'global',
    className,
    shellClassName,
    hideApiStatus = false,
}) => {
    const isDark = theme === 'dark';
    const rootRef = useRef<HTMLDivElement>(null);
    const richEditorRef = useRef<RichPromptEditorHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);

    const [expandedPanel, setExpandedPanel] = useState<ExpandPanel>(null);
    const [isDragActive, setIsDragActive] = useState(false);

    const triggerClass = `inline-flex ${compactMode ? 'h-7 gap-1 px-2.5 text-[11px]' : 'h-8 gap-1.5 px-3 text-xs'} items-center rounded-full border font-medium transition ${
        isDark ? 'border-[#2A3140] bg-[#1B2029] text-[#D0D5DD] hover:bg-[#252C39]' : 'border-[#E5E7EB] bg-[#F5F7FA] text-[#344054] hover:border-[#D0D5DD] hover:bg-white'
    }`;
    const activeTriggerClass = isDark ? 'border-[#4B5B78] bg-[#202734] text-white shadow-sm' : 'border-[#D0D5DD] bg-white text-[#111827] shadow-sm';
    const popoverCardClass = `absolute bottom-full left-0 z-[80] mb-2 ${compactMode ? 'min-w-[200px] rounded-[14px]' : 'min-w-[220px] rounded-[16px]'} border p-1.5 shadow-[0_20px_50px_rgba(15,23,42,0.14)] ${
        isDark ? 'border-[#2A3140] bg-[#161A22]' : 'border-[#E5E7EB] bg-white'
    }`;
    const shellClass = `${compactMode ? 'rounded-[18px]' : 'rounded-[20px]'} ${isDark ? 'border-[#2A3140] bg-[#12151B] shadow-[0_20px_50px_rgba(0,0,0,0.24)]' : 'border-[#E4E7EC] bg-white shadow-[0_20px_50px_rgba(15,23,42,0.10)]'}`;

    /** 将画布元素转换为 RichPromptEditor 需要的 MentionItem[] */
    const canvasItems = useMemo<MentionItem[]>(() =>
        canvasElements
            .filter(el => el.isVisible !== false)
            .map(el => ({
                id: el.id,
                label: getElementLabel(el),
                thumbnail: el.type === 'image' ? el.href : '',
                elementType: el.type,
            })),
        [canvasElements]
    );

    /** 当前视频模型支持的比例列表 */
    const supportedRatios = useMemo(() => {
        if (!selectedVideoModel) return ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
        return getSupportedRatios(selectedVideoModel);
    }, [selectedVideoModel]);

    const currentModelOptions = generationMode === 'video' ? videoModelOptions : imageModelOptions;
    const placeholder = useMemo(() => {
        if (!isSelectionActive) return '使用 @ 引用画布中的图片，例如：把 @图片1 的人物替换为 @图片2 的兔子';
        if (selectedElementCount === 1) return '描述你想对当前元素做什么';
        return `已选中 ${selectedElementCount} 个元素，补充组合生成描述`;
    }, [isSelectionActive, selectedElementCount]);

    /** 编辑器文本 + mention 变化时同步到父组件 */
    const handleEditorChange = useCallback((plainText: string, json: Record<string, unknown>) => {
        setPrompt(plainText);
        const mentions = extractMentions(json);
        const uniqueIds = [...new Set(mentions.map(m => m.id))];
        onMentionedElementIds?.(uniqueIds);
    }, [setPrompt, onMentionedElementIds]);

    /** 编辑器 Enter 提交 */
    const handleEditorSubmit = useCallback(() => {
        if (prompt.trim() && !isLoading) onGenerate();
    }, [prompt, isLoading, onGenerate]);

    /** 外部 prompt 被清空时（如切换画板、生成完成后），同步清空富文本编辑器 */
    useEffect(() => {
        if (!prompt && richEditorRef.current) {
            const editorText = richEditorRef.current.getText();
            if (editorText) richEditorRef.current.clear();
        }
    }, [prompt]);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setExpandedPanel(null);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

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
                className={`relative overflow-visible rounded-[20px] border transition-all duration-200 ${shellClass} ${shellClassName || ''} ${isDragActive ? (isDark ? 'scale-[1.01] border-[#4B5B78]' : 'scale-[1.01] border-[#B2CCFF]') : ''}`.trim()}
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
                    accept="image/*,video/*"
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
                    <div className={`pointer-events-none absolute inset-3 z-20 rounded-[26px] border border-dashed backdrop-blur-sm ${isDark ? 'border-[#4B5B78] bg-[#1B2029]/72' : 'border-[#84ADFF] bg-[#EEF4FF]/78'}`}>
                        <div className="flex h-full items-center justify-center">
                            <div className="rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-[#111827] shadow-lg">松手上传参考媒体</div>
                        </div>
                    </div>
                )}

                <div
                    className={`relative ${compactMode ? 'px-3 pt-2.5' : 'px-3.5 pt-3'}`}
                    style={{
                        '--prompt-editor-color': isDark ? '#F8FAFC' : '#111827',
                        '--prompt-editor-placeholder': isDark ? '#667085' : '#C2CAD7',
                        '--prompt-editor-caret': isDark ? '#818CF8' : '#4f46e5',
                        '--prompt-editor-scrollbar': isDark ? '#2A3140' : '#e5e7eb',
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
                    />

                    {attachments.length > 0 && (
                        <div className={`space-y-2 pb-1 ${compactMode ? 'mt-2' : 'mt-2.5'}`}>
                            <div className="flex flex-wrap gap-1.5">
                                {attachments.map(attachment => (
                                    <div
                                        key={attachment.id}
                                        className={`group flex items-center gap-2 rounded-[14px] border px-2 py-1.5 transition-all duration-200 hover:-translate-y-0.5 ${isDark ? 'border-[#2A3140] bg-[#171C24]' : 'border-[#E4E7EC] bg-[#F8FAFC]'}`}
                                    >
                                        <div className="h-8 w-8 overflow-hidden rounded-lg border border-[var(--border-color)] bg-white">
                                            {attachment.mimeType.startsWith('video/') ? (
                                                <video src={attachment.href} className="h-full w-full object-cover" muted playsInline />
                                            ) : (
                                                <img src={attachment.href} alt={attachment.name} className="h-full w-full object-cover" />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <div className={`max-w-[120px] truncate text-xs font-medium ${isDark ? 'text-[#F8FAFC]' : 'text-[#111827]'}`}>{attachment.name}</div>
                                            <div className="text-[10px] text-[var(--text-muted)]">{attachment.mimeType.startsWith('video/') ? '参考视频' : '参考图'}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onRemoveAttachment?.(attachment.id)}
                                            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${isDark ? 'text-[#98A2B3] hover:bg-[#202734] hover:text-white' : 'text-[#667085] hover:bg-white hover:text-[#111827]'}`}
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

                <div className={`relative flex items-center justify-between gap-3 border-t ${compactMode ? 'px-2.5 py-2' : 'px-3 py-2.5'} ${isDark ? 'border-[#2A3140]' : 'border-[#EEF1F5]'}`}>
                    <div className="min-w-0 flex-1 overflow-visible">
                        <div className="flex flex-wrap items-center gap-2">
                            {/* API Key 状态指示器 — 与设置面板联动 */}
                            {!hideApiStatus && (() => {
                                const defaultKey = userApiKeys.find(k => k.isDefault);
                                const keyCount = userApiKeys.length;
                                if (keyCount === 0) {
                                    return (
                                        <button
                                            type="button"
                                            onClick={onOpenSettings}
                                            className={`inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed px-3 text-[11px] font-medium transition ${
                                                isDark ? 'border-[#7A271A] text-[#FDA29B] hover:bg-[#3A1616]' : 'border-[#FECACA] text-[#DC2626] hover:bg-[#FEF3F2]'
                                            }`}
                                        >
                                            🔑 未配置 API Key
                                        </button>
                                    );
                                }
                                return (
                                    <button
                                        type="button"
                                        onClick={onOpenSettings}
                                        className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${
                                            isDark ? 'border-[#2A3140] bg-[#1B2029] text-[#D0D5DD] hover:bg-[#252C39]' : 'border-[#E5E7EB] bg-[#F5F7FA] text-[#344054] hover:bg-white'
                                        }`}
                                        title={`已配置 ${keyCount} 个 Key，点击打开设置管理`}
                                    >
                                        <span className={`inline-block h-2 w-2 rounded-full ${defaultKey?.status === 'ok' ? 'bg-green-500' : 'bg-yellow-400'}`} />
                                        <span className="max-w-[100px] truncate">{defaultKey?.name || defaultKey?.provider || 'API Key'}</span>
                                        {keyCount > 1 && <span className={`text-[10px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>+{keyCount - 1}</span>}
                                    </button>
                                );
                            })()}


                            <div className="relative">
                                <button type="button" onClick={() => setExpandedPanel(prev => (prev === 'mode' ? null : 'mode'))} className={`${triggerClass} ${expandedPanel === 'mode' ? activeTriggerClass : ''}`}>
                                    {getModeLabel(generationMode)}
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                                </button>
                                {expandedPanel === 'mode' && <div className={popoverCardClass}><PopoverHeader title="生成类型" subtitle="选择图片、视频或首尾帧模式" /><div className="space-y-1">{(['image', 'video', 'keyframe'] as GenerationMode[]).map(mode => <MenuOptionButton key={mode} label={getModeLabel(mode)} active={generationMode === mode} onClick={() => { setGenerationMode(mode); setExpandedPanel(null); }} />)}</div></div>}
                            </div>

                            <div className="relative">
                                <button type="button" onClick={() => setExpandedPanel(prev => (prev === 'model' ? null : 'model'))} className={`${triggerClass} ${expandedPanel === 'model' ? activeTriggerClass : ''}`}>
                                    <span className="max-w-[150px] truncate">{getModelLabel(generationMode, selectedImageModel, selectedVideoModel)}</span>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                                </button>
                                {expandedPanel === 'model' && (
                                    <div className={`${popoverCardClass} w-[290px]`}>
                                        <PopoverHeader title="模型设置" subtitle="向上弹出选择，不打断输入流程" />
                                        <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
                                            <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#98A2B3]">{generationMode === 'video' ? '视频模型' : '图片模型'}</div>
                                            {(() => {
                                                // 按 provider 分组显示模型列表
                                                const grouped = new Map<string, string[]>();
                                                for (const model of currentModelOptions) {
                                                    const provider = inferProviderFromModel(model);
                                                    const label = PROVIDER_LABELS[provider] || provider;
                                                    if (!grouped.has(label)) grouped.set(label, []);
                                                    grouped.get(label)!.push(model);
                                                }
                                                const selectedModel = generationMode === 'video' ? selectedVideoModel : selectedImageModel;
                                                return Array.from(grouped.entries()).map(([providerLabel, models]) => (
                                                    <div key={providerLabel}>
                                                        {grouped.size > 1 && (
                                                            <div className={`mt-1.5 px-2 pb-0.5 text-[10px] font-semibold tracking-wide ${isDark ? 'text-[#528BFF]' : 'text-[#175CD3]'}`}>
                                                                {providerLabel}
                                                            </div>
                                                        )}
                                                        {models.map(model => {
                                                            const capTags = getModelCapabilityTags(model);
                                                            const shortName = model.replace(/^(google|openai|anthropic|openrouter)\//, '');
                                                            return (
                                                            <MenuOptionButton
                                                                key={model}
                                                                label={capTags ? `${capTags} ${shortName}` : shortName}
                                                                active={selectedModel === model}
                                                                onClick={() => {
                                                                    generationMode === 'video' ? onVideoModelChange?.(model) : onImageModelChange?.(model);
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
                                                <div className="grid grid-cols-3 gap-2 px-1 pt-3">
                                                    {(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const).map(ratio => {
                                                        const supported = (supportedRatios as readonly string[]).includes(ratio);
                                                        return (
                                                        <button
                                                            key={ratio}
                                                            type="button"
                                                            disabled={!supported}
                                                            onClick={() => setVideoAspectRatio(ratio)}
                                                            title={supported ? undefined : '当前视频模型不支持此比例'}
                                                            className={`rounded-2xl border px-3 py-2 text-sm font-medium transition ${!supported ? 'opacity-35 cursor-not-allowed' : ''} ${videoAspectRatio === ratio ? 'border-[#B2CCFF] bg-[#EEF4FF] text-[#175CD3]' : isDark ? 'border-[#2A3140] bg-[#1B2029] text-[#D0D5DD] hover:bg-[#252C39]' : 'border-[#E5E7EB] bg-[#F9FAFB] text-[#344054] hover:bg-white'}`}
                                                        >
                                                            {ratio}
                                                        </button>
                                                        );
                                                    })}
                                                </div>
                                                <div className="px-1 pt-2">
                                                    <p className={`text-xs mb-1.5 ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>平台预设</p>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {Object.entries(SOCIAL_PRESETS).map(([key, preset]) => (
                                                            <div key={key} className="relative group">
                                                                <button
                                                                    type="button"
                                                                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${isDark ? 'border-[#2A3140] bg-[#1B2029] text-[#D0D5DD] hover:bg-[#252C39]' : 'border-[#E5E7EB] bg-[#F9FAFB] text-[#344054] hover:bg-white'}`}
                                                                    onClick={() => setVideoAspectRatio(preset.ratios[0].ratio)}
                                                                    title={preset.ratios.map(r => `${r.desc}: ${r.ratio}`).join(', ')}
                                                                >
                                                                    {preset.label}
                                                                </button>
                                                                {preset.ratios.length > 1 && (
                                                                    <div className={`absolute bottom-full left-0 mb-1 hidden group-hover:flex flex-col rounded-lg border shadow-lg p-1 min-w-[140px] ${isDark ? 'bg-[#1B2029] border-[#2A3140]' : 'bg-white border-[#E5E7EB]'}`} style={{ zIndex: 1 }}>
                                                                        {preset.ratios.map(r => (
                                                                            <button
                                                                                key={r.desc}
                                                                                type="button"
                                                                                className={`text-left rounded-md px-2 py-1 text-xs transition ${videoAspectRatio === r.ratio ? 'text-[#175CD3] font-semibold' : isDark ? 'text-[#D0D5DD] hover:bg-[#252C39]' : 'text-[#344054] hover:bg-[#F5F7FA]'}`}
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
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={onAutoEnhanceToggle}
                                title={isAutoEnhanceEnabled ? '关闭自动润色（生成前不再自动优化提示词）' : '开启自动润色（生成前自动用 LLM 优化提示词）'}
                                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${
                                    isAutoEnhanceEnabled
                                        ? isDark
                                            ? 'border-[#528BFF] bg-[#1E3A5F] text-[#B2CCFF] shadow-sm'
                                            : 'border-[#84ADFF] bg-[#EEF4FF] text-[#175CD3] shadow-sm'
                                        : isDark
                                            ? 'border-[#2A3140] bg-[#1B2029] text-[#667085] hover:bg-[#252C39]'
                                            : 'border-[#E5E7EB] bg-[#F5F7FA] text-[#98A2B3] hover:border-[#D0D5DD] hover:bg-white'
                                }`}
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
                                {expandedPanel === 'more' && (
                                    <div className={`${popoverCardClass} left-auto right-0 w-[320px]`}>
                                        <PopoverHeader title="更多操作" subtitle="参考图、角色锁定、效果存储" />
                                        <div className="space-y-1">
                                            <MenuOptionButton
                                                label="上传参考图"
                                                description="点击选择，或直接把图片拖到输入框"
                                                onClick={() => {
                                                    fileInputRef.current?.click();
                                                    setExpandedPanel(null);
                                                }}
                                            />

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

                                            <MenuOptionButton label="保存当前提示词" description="存成一个可复用效果" onClick={handleSaveEffect} />

                                            {userEffects.length > 0 && (
                                                <div className="max-h-40 space-y-1 overflow-y-auto pt-2 pr-1">
                                                    {userEffects.map(effect => (
                                                        <div key={effect.id} className={`flex items-center gap-2 rounded-2xl px-3 py-2 ${isDark ? 'bg-[#1B2029]' : 'bg-[#F9FAFB]'}`}>
                                                            <button
                                                                type="button"
                                                                className="min-w-0 flex-1 text-left"
                                                                onClick={() => {
                                                                    setPrompt(effect.value);
                                                                    setExpandedPanel(null);
                                                                }}
                                                            >
                                                                <div className="truncate text-sm font-medium text-[var(--text-primary)]">{effect.name}</div>
                                                                <div className="truncate text-xs text-[var(--text-muted)]">{effect.value}</div>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => onDeleteUserEffect(effect.id)}
                                                                className={`flex h-8 w-8 items-center justify-center rounded-full transition ${isDark ? 'text-[#98A2B3] hover:bg-[#202734] hover:text-white' : 'text-[#667085] hover:bg-white hover:text-[#111827]'}`}
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
                                                <div className={`rounded-2xl px-3 py-3 text-sm ${isDark ? 'bg-[#1B2029] text-[#98A2B3]' : 'bg-[#F9FAFB] text-[#667085]'}`}>
                                                    在输入框里输入 <span className={`font-semibold ${isDark ? 'text-[#F3F4F6]' : 'text-[#344054]'}`}>@</span>，可直接引用画布里的元素卡片。
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Batch count toggle */}
                    {variant !== 'inline' && generationMode === 'image' && onBatchCountChange && (
                        <button
                            type="button"
                            onClick={() => {
                                const next = batchCount === 1 ? 2 : batchCount === 2 ? 4 : 1;
                                onBatchCountChange(next);
                            }}
                            title={batchCount === 1 ? '单张生成 — 点击切换批量' : `批量生成 ${batchCount} 张方案`}
                            className={`flex h-9 min-w-[36px] items-center justify-center rounded-xl px-2 text-xs font-semibold transition ${
                                batchCount > 1
                                    ? (isDark ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white')
                                    : (isDark ? 'bg-[#2A3142] text-[#98A2B3] hover:bg-[#3A4458]' : 'bg-[#F2F4F7] text-[#667085] hover:bg-[#E4E7EC]')
                            }`}
                        >
                            ×{batchCount}
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => {
                            if (prompt.trim() && !isLoading) onGenerate();
                        }}
                        disabled={isLoading || !prompt.trim()}
                        aria-label={t('promptBar.generate')}
                        title={t('promptBar.generate')}
                        className={`flex h-9 min-w-[72px] items-center justify-center rounded-xl px-3 transition disabled:cursor-not-allowed ${isDark ? 'bg-[#F3F4F6] text-[#111827] hover:bg-white disabled:bg-[#3A4458] disabled:text-[#98A2B3]' : 'bg-[#111827] text-white hover:bg-[#0F172A] disabled:bg-[#D0D5DD]'}`}
                    >
                        {isLoading ? (
                            <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
                            </svg>
                        ) : (
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold">{batchCount > 1 ? `生成 ×${batchCount}` : '生成'}</span>
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
    );
};
