import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetCategory, AssetItem, AssetLibrary, GenerationHistoryItem, Element, UserApiKey, ModelPreference } from '../types';
import { AgentChatPanel } from './AgentChatPanel';
import { Chat } from './agent-chat/Chat';

type RightPanelTab = 'history' | 'inspiration' | 'agent';

interface RightPanelProps {
    theme: 'light' | 'dark';
    isMinimized: boolean;
    onToggleMinimize: () => void;
    outerGap: number;
    defaultWidth: number;
    minWidth: number;
    widthCap: number;
    compactMode: boolean;
    library: AssetLibrary;
    generationHistory: GenerationHistoryItem[];
    onRemove: (category: AssetCategory, id: string) => void;
    onRename: (category: AssetCategory, id: string, name: string) => void;
    onWidthChange?: (width: number) => void;
    onReversePrompt?: (imageDataUrl: string, mimeType: string, width?: number, height?: number) => void;
    onCreateImage?: (prompt: string, name?: string) => Promise<void>;
    onCreateVideo?: (prompt: string, sourceImageIds?: string[]) => Promise<void>;
    runtimeStage?: string;
    runtimeJobs?: Array<{
        jobId: string;
        command: string;
        status: 'accepted' | 'running' | 'succeeded' | 'failed' | 'canceled';
        progress: { pct: number; stage: string };
        updatedAt: number;
    }>;
    // Agent Chat (new)
    elements?: Element[];
    selectedElementIds?: string[];
    setSelectedElementIds?: (ids: string[]) => void;
    commitAction?: (updater: (prev: Element[]) => Element[]) => void;
    handleGenerate?: (
        promptOverride?: string,
        source?: 'prompt' | 'right' | 'agent',
        modeOverride?: 'image' | 'video' | 'keyframe',
        selectedElementIdsOverride?: string[],
        mentionedElementIdsOverride?: string[],
    ) => Promise<void>;
    userApiKeys?: UserApiKey[];
    modelPreference?: ModelPreference;
    // Phase 1.3: pending attachments from canvas pop-bar "加入对话"
    pendingChatAttachments?: Array<{ url: string; mimeType: string }>;
    onConsumeChatAttachments?: () => void;
}

const CATEGORY_LABELS: Record<AssetCategory, string> = {
    character: '角色',
    scene: '场景',
    prop: '道具',
};

const CategoryTabs: React.FC<{ value: AssetCategory; onChange: (c: AssetCategory) => void; isDark?: boolean }> = ({ value, onChange }) => (
    <div className="isl-tabbar">
        {(Object.keys(CATEGORY_LABELS) as AssetCategory[]).map(category => (
            <button
                key={category}
                type="button"
                onClick={() => onChange(category)}
                className={`isl-tab px-3 py-1.5 text-xs ${value === category ? 'isl-tab--active' : ''}`}
            >
                {CATEGORY_LABELS[category]}
            </button>
        ))}
    </div>
);

const EmptyHistory: React.FC<{ isDark?: boolean }> = () => (
    <div className="isl-well flex flex-1 items-center justify-center border-dashed px-6 py-10 text-center">
        <div>
            <div className="isl-avatar mx-auto flex h-12 w-12 items-center justify-center" style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                </svg>
            </div>
            <p className="mt-3 text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>还没有历史生成内容</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>在底部输入提示词并点击生成，结果会自动保存到这里。</p>
            <div className="isl-chip mx-auto mt-4 inline-flex h-auto items-center gap-2 px-3 py-1.5 text-xs">
                <span>向下看</span>
                <span>↓</span>
                <span>PromptBar</span>
            </div>
        </div>
    </div>
);

/**
 * RunningHub WebApp 面板 — AI 应用工作流接入
 *
 * 用户输入 API Key + WebApp ID → 获取可修改节点 → 修改参数 → 提交任务 → 显示结果
 */
const RunningHubWebAppPanel: React.FC<{ theme: 'light' | 'dark'; compactMode: boolean }> = ({ theme, compactMode }) => {
    const isDark = theme === 'dark';
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('rh_webapp_apikey') || '');
    const [webappId, setWebappId] = useState(() => localStorage.getItem('rh_webapp_id') || '');
    const [nodes, setNodes] = useState<RHWebAppNodeInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [taskStatus, setTaskStatus] = useState<RHWebAppTaskStatus | null>(null);
    const [outputs, setOutputs] = useState<RHWebAppOutputItem[]>([]);

    const inputClass = 'isl-well w-full px-3 py-2 text-xs outline-none';

    const btnClass = 'isl-chip h-auto justify-center px-4 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed';

    // 持久化 apiKey & webappId
    useEffect(() => { try { localStorage.setItem('rh_webapp_apikey', apiKey); } catch { /* non-critical */ } }, [apiKey]);
    useEffect(() => { try { localStorage.setItem('rh_webapp_id', webappId); } catch { /* non-critical */ } }, [webappId]);

    // 获取节点列表
    const handleFetchNodes = async () => {
        if (!apiKey.trim() || !webappId.trim()) return;
        setLoading(true);
        setError(null);
        setNodes([]);
        try {
            const list = await rhGetWebAppNodes(apiKey.trim(), webappId.trim());
            setNodes(list);
        } catch (e) {
            setError(e instanceof Error ? e.message : '获取节点失败');
        } finally {
            setLoading(false);
        }
    };

    // 修改节点值
    const handleNodeValueChange = (nodeId: string, fieldName: string, newValue: string) => {
        setNodes(prev => prev.map(n =>
            n.nodeId === nodeId && n.fieldName === fieldName
                ? { ...n, fieldValue: newValue }
                : n
        ));
    };

    // 提交任务
    const handleSubmit = async () => {
        if (!apiKey.trim() || !webappId.trim() || nodes.length === 0) return;
        setLoading(true);
        setError(null);
        setTaskStatus('QUEUED');
        setOutputs([]);
        try {
            const result = await rhRunWebApp(
                apiKey.trim(),
                webappId.trim(),
                nodes,
                (status) => setTaskStatus(status),
            );
            setOutputs(result);
            setTaskStatus('SUCCESS');
        } catch (e) {
            setError(e instanceof Error ? e.message : '任务执行失败');
            setTaskStatus('FAILED');
        } finally {
            setLoading(false);
        }
    };

    const statusLabel: Record<RHWebAppTaskStatus, string> = {
        QUEUED: '⏳ 排队中...',
        RUNNING: '⚡ 运行中...',
        SUCCESS: '✅ 完成',
        FAILED: '❌ 失败',
        UNKNOWN: '❓ 未知',
    };

    return (
        <div className={`flex h-full flex-col ${compactMode ? 'gap-3 p-3' : 'gap-4 p-4'} overflow-y-auto`}>
            {/* 标题 */}
            <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>
                    🚀 RunningHub AI 应用
                </h3>
                <p className="mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>
                    接入 RunningHub WebApp 工作流，输入 WebApp ID 即可调用。
                </p>
            </div>

            {/* API Key */}
            <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--isl-ink-ghost)' }}>
                    API Key
                </label>
                <input
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    type="password"
                    placeholder="粘贴 RunningHub API Key"
                    className={inputClass}
                />
                <a
                    href="https://www.runninghub.cn/enterprise-api/sharedApi"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-[10px] hover:underline"
                    style={{ color: 'var(--isl-mint-deep)' }}
                >
                    获取 API Key ↗
                </a>
            </div>

            {/* WebApp ID */}
            <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--isl-ink-ghost)' }}>
                    WebApp ID
                </label>
                <input
                    value={webappId}
                    onChange={e => setWebappId(e.target.value)}
                    placeholder="如: 1937084629516193794"
                    className={inputClass}
                />
                <p className="mt-1 text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                    WebApp 链接末尾的数字，如 runninghub.cn/ai-detail/<strong>1937...</strong>
                </p>
            </div>

            {/* 获取节点 */}
            <button
                type="button"
                onClick={handleFetchNodes}
                disabled={loading || !apiKey.trim() || !webappId.trim()}
                className={btnClass}
            >
                {loading && nodes.length === 0 && !taskStatus ? '获取中...' : '获取工作流节点'}
            </button>

            {/* 错误提示 */}
            {error && (
                <div className="isl-bubble--error rounded-2xl px-3 py-2 text-xs">
                    ✗ {error}
                </div>
            )}

            {/* 节点列表 */}
            {nodes.length > 0 && (
                <div className="isl-well overflow-hidden">
                    <div className="px-3 py-2 text-[11px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>
                        可修改节点 ({nodes.length})
                    </div>
                    <div className="max-h-[300px] overflow-y-auto">
                        {nodes.map((node, i) => (
                            <div key={`${node.nodeId}-${node.fieldName}-${i}`} className="border-t px-3 py-2.5" style={{ borderColor: 'var(--isl-border)' }}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] font-bold" style={{ color: 'var(--isl-ink)' }}>
                                        {node.description || node.nodeName}
                                    </span>
                                    <span className="rounded-full px-1.5 py-0.5 text-[9px] font-mono" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-ghost)' }}>
                                        {node.fieldType}
                                    </span>
                                </div>
                                {node.fieldType === 'IMAGE' || node.fieldType === 'AUDIO' || node.fieldType === 'VIDEO' ? (
                                    <div className="text-[10px] italic" style={{ color: 'var(--isl-ink-ghost)' }}>
                                        📎 {node.fieldValue || '未设置'}
                                    </div>
                                ) : (
                                    <input
                                        value={node.fieldValue}
                                        onChange={e => handleNodeValueChange(node.nodeId, node.fieldName, e.target.value)}
                                        className={`${inputClass} mt-0.5`}
                                        placeholder={`输入 ${node.fieldName}`}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 提交按钮 */}
            {nodes.length > 0 && (
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={loading}
                    className={btnClass + ' w-full'}
                >
                    {loading && taskStatus ? statusLabel[taskStatus] || '处理中...' : '▶ 提交任务'}
                </button>
            )}

            {/* 输出结果 */}
            {outputs.length > 0 && (
                <div className="rounded-2xl border-[1.5px] p-3" style={{ borderColor: 'var(--isl-mint)', background: 'var(--isl-mint-bg)' }}>
                    <div className="mb-2 text-xs font-bold" style={{ color: 'var(--isl-mint-deep)' }}>
                        🎉 生成结果
                    </div>
                    {outputs.map((out, i) => (
                        <a
                            key={i}
                            href={out.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mb-1 block truncate text-xs hover:underline"
                            style={{ color: 'var(--isl-mint-deep)' }}
                        >
                            {out.fileUrl}
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
};

export const RightPanel: React.FC<RightPanelProps> = ({
    theme,
    isMinimized,
    onToggleMinimize,
    outerGap,
    defaultWidth,
    minWidth,
    widthCap,
    compactMode,
    library,
    generationHistory,
    onRemove,
    onRename,
    onWidthChange,
    onReversePrompt,
    onCreateImage,
    onCreateVideo,
    runtimeStage,
    runtimeJobs = [],
    elements,
    selectedElementIds = [],
    setSelectedElementIds,
    commitAction,
    handleGenerate,
    userApiKeys = [],
    modelPreference,
    pendingChatAttachments,
    onConsumeChatAttachments,
}) => {
    const isDark = theme === 'dark';
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
    const [activeTab, setActiveTab] = useState<RightPanelTab>('agent');
    const [category, setCategory] = useState<AssetCategory>('character');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [panelWidth, setPanelWidth] = useState(() => {
        const saved = localStorage.getItem('rightPanelWidth');
        return saved ? parseInt(saved, 10) : defaultWidth;
    });
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(380);

    const editInputRef = useRef<HTMLInputElement>(null);

    const items = useMemo(() => library[category], [category, library]);

    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const maxWidth = Math.min(widthCap, viewportWidth - outerGap * 2);
        const safeMinWidth = Math.min(minWidth, maxWidth);
        setPanelWidth(prev => {
            const candidate = Number.isNaN(prev) ? defaultWidth : prev;
            return Math.min(maxWidth, Math.max(safeMinWidth, candidate));
        });
    }, [defaultWidth, minWidth, outerGap, viewportWidth, widthCap]);

    useEffect(() => {
        localStorage.setItem('rightPanelWidth', panelWidth.toString());
    }, [panelWidth]);

    useEffect(() => {
        onWidthChange?.(isMinimized ? 2 : panelWidth);
    }, [isMinimized, onWidthChange, panelWidth]);

    useEffect(() => {
        if (!isResizing) return;

        const handlePointerMove = (event: PointerEvent) => {
            const dx = resizeStartX - event.clientX;
            const nextMinWidth = Math.min(minWidth, widthCap, window.innerWidth - outerGap * 2);
            const maxWidth = Math.min(widthCap, window.innerWidth - outerGap * 2);
            setPanelWidth(Math.min(maxWidth, Math.max(nextMinWidth, resizeStartWidth + dx)));
        };

        const handlePointerUp = () => setIsResizing(false);

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isResizing, minWidth, outerGap, resizeStartWidth, resizeStartX, widthCap]);

    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    const handleResizePointerDown = (event: React.PointerEvent) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        setIsResizing(true);
        setResizeStartX(event.clientX);
        setResizeStartWidth(panelWidth);
        event.stopPropagation();
        event.preventDefault();
    };

    const handleLibraryDragStart = (event: React.DragEvent, item: AssetItem) => {
        event.dataTransfer.setData('text/plain', JSON.stringify({ __makingAsset: true, item }));
        event.dataTransfer.effectAllowed = 'copy';
    };

    const handleHistoryDragStart = (event: React.DragEvent, item: GenerationHistoryItem) => {
        event.dataTransfer.setData(
            'text/plain',
            JSON.stringify({
                __makingAsset: true,
                item: {
                    id: item.id,
                    name: item.name || 'Generated',
                    category: 'scene',
                    dataUrl: item.dataUrl,
                    mimeType: item.mimeType,
                    width: item.width,
                    height: item.height,
                    createdAt: item.createdAt,
                },
            })
        );
        event.dataTransfer.effectAllowed = 'copy';
    };

    const handleDoubleClick = (item: AssetItem) => {
        setEditingId(item.id);
        setEditingName(item.name || '');
    };

    const handleSaveEdit = (itemId: string) => {
        if (editingId === itemId && editingName.trim()) {
            onRename(category, itemId, editingName.trim());
        }
        setEditingId(null);
        setEditingName('');
    };

    const formatTime = (timestamp: number) =>
        new Date(timestamp).toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

    return (
        <>
            <button
                type="button"
                onClick={onToggleMinimize}
                style={{
                    top: `${outerGap}px`,
                    right: `${outerGap}px`,
                    opacity: isMinimized ? 1 : 0,
                    pointerEvents: isMinimized ? 'auto' : 'none',
                    transition: 'opacity 0.2s ease-out, transform 0.28s ease-out',
                    transform: isMinimized ? 'translateY(0)' : 'translateY(-6px)',
                }}
                className="isl-icon-btn theme-aware absolute z-20 flex h-10 w-10 items-center justify-center"
                title="打开侧边栏"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M15 3v18" />
                </svg>
            </button>

            <div
                style={{
                    top: `${outerGap}px`,
                    bottom: `${outerGap}px`,
                    right: `${outerGap}px`,
                    width: `${panelWidth}px`,
                    transform: isMinimized ? 'translateX(18px) scale(0.96)' : 'translateX(0) scale(1)',
                    transformOrigin: 'right center',
                    opacity: isMinimized ? 0 : 1,
                    transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease-out, width 0.25s ease-out',
                    pointerEvents: isMinimized ? 'none' : 'auto',
                }}
                className="isl-panel compact-right-panel theme-aware absolute z-[30] flex flex-col overflow-hidden"
            >
                <div
                    className={`absolute left-0 top-0 z-10 h-full cursor-ew-resize transition-colors hover:bg-[#19c8b9]/40 ${compactMode ? 'w-1' : 'w-1.5'}`}
                    onPointerDown={handleResizePointerDown}
                />

                <div className={`border-b ${compactMode ? 'px-2 py-1.5' : 'px-2.5 py-2'}`} style={{ borderColor: 'var(--isl-border)' }}>
                    <div className="isl-tabbar isl-tabbar--ac flex w-full items-center gap-1.5">
                        {[
                            { key: 'agent' as RightPanelTab, label: 'Agent' },
                            { key: 'history' as RightPanelTab, label: 'History' },
                            { key: 'inspiration' as RightPanelTab, label: 'Assets' },
                        ].map(tab => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveTab(tab.key)}
                                className={`isl-tab min-w-0 flex-1 px-2 py-1.5 text-[12px] ${activeTab === tab.key ? 'isl-tab--active' : ''}`}
                            >
                                <span className="flex items-center justify-center gap-1.5 truncate">
                                    {activeTab === tab.key && (
                                        <span
                                            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                            style={{ background: 'var(--isl-mint)', boxShadow: '0 0 0 2px var(--isl-card)' }}
                                        />
                                    )}
                                    <span className="truncate">{tab.label}</span>
                                </span>
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={onToggleMinimize}
                            className="isl-icon-btn isl-tabbar--ac-collapse shrink-0"
                            style={{ width: 26, height: 26 }}
                            title="Collapse"
                            aria-label="Collapse panel"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                    {activeTab === 'history' && (
                        <div className={`flex h-full min-h-0 flex-col ${compactMode ? 'gap-3 p-3' : 'gap-3 p-4'}`}>
                            <div className="flex min-h-0 flex-1 flex-col">
                                <div className="mb-3 flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>历史生成</h3>
                                        <p className="mt-0.5 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>自动保存到本地，可直接拖到画布。</p>
                                    </div>
                                    <span className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}>
                                        {generationHistory.length}
                                    </span>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                                    {generationHistory.length === 0 ? (
                                        <EmptyHistory isDark={isDark} />
                                    ) : (
                                        <div className={`grid ${compactMode ? 'grid-cols-1 gap-2.5' : 'grid-cols-2 gap-2.5'}`}>
                                            {generationHistory.map(item => (
                                                <div
                                                    key={item.id}
                                                    className="history-card group border-[1.5px] isl-elastic"
                                                    style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }}
                                                    draggable
                                                    onDragStart={event => handleHistoryDragStart(event, item)}
                                                >
                                                    <div className="history-card-img m-1.5" style={{ background: 'var(--isl-surface-2)' }}>
                                                        <img
                                                            src={item.dataUrl}
                                                            alt={item.name || item.prompt}
                                                            className={`w-full object-cover ${compactMode ? 'aspect-[4/3]' : 'aspect-square'}`}
                                                        />
                                                    </div>
                                                    <div className="px-2.5 pb-2.5 pt-1">
                                                        <p className="line-clamp-2 text-xs font-bold leading-[1.4]" style={{ color: 'var(--isl-ink)' }}>
                                                            {item.name || item.prompt}
                                                        </p>
                                                        <div className="mt-1.5 flex items-center justify-between text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                                                            <span>{item.width}×{item.height}</span>
                                                            <span>{formatTime(item.createdAt)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'agent' && (
                        <div className="h-full min-h-0 px-0 py-0">
                            {elements && commitAction && handleGenerate && setSelectedElementIds && modelPreference ? (
                                <Chat
                                    theme={theme}
                                    compactMode={compactMode}
                                    elements={elements}
                                    selectedElementIds={selectedElementIds}
                                    setSelectedElementIds={setSelectedElementIds}
                                    commitAction={commitAction}
                                    handleGenerate={handleGenerate}
                                    userApiKeys={userApiKeys}
                                    modelPreference={modelPreference}
                                    pendingAttachments={pendingChatAttachments}
                                    onConsumeAttachments={onConsumeChatAttachments}
                                />
                            ) : (
                                <AgentChatPanel
                                    theme={theme}
                                    compactMode={compactMode}
                                    generationHistory={generationHistory}
                                    onCreateImage={onCreateImage}
                                    onCreateVideo={onCreateVideo}
                                    runtimeStage={runtimeStage}
                                    runtimeJobs={runtimeJobs}
                                />
                            )}
                        </div>
                    )}

                    {activeTab === 'inspiration' && (
                        <div className="flex h-full min-h-0 flex-col">
                            <div className={`flex items-center justify-between border-b ${compactMode ? 'px-3 py-2' : 'px-4 py-2.5'}`} style={{ borderColor: 'var(--isl-border)' }}>
                                <CategoryTabs value={category} onChange={setCategory} isDark={isDark} />
                                <span className="text-[11px] tabular-nums" style={{ color: 'var(--isl-ink-soft)' }}>{items.length} 项</span>
                            </div>

                            <div className={`min-h-0 flex-1 overflow-y-auto ${compactMode ? 'p-2.5' : 'p-3'}`}>
                                {items.length === 0 ? (
                                    <div className="flex h-full items-center justify-center" style={{ color: 'var(--isl-ink-ghost)' }}>
                                        <div className="text-center">
                                            <svg className="mx-auto mb-3 h-14 w-14 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <rect x="3" y="7" width="7" height="10" rx="1" />
                                                <rect x="14" y="4" width="7" height="16" rx="1" />
                                            </svg>
                                            <p className="text-sm">暂无{CATEGORY_LABELS[category]}</p>
                                            <p className="mt-1 text-xs opacity-70">可把历史生成内容拖到画布，或稍后继续扩展素材库。</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`inspiration-grid ${compactMode ? 'compact' : ''}`}>
                                        {items.map(item => (
                                            <div
                                                key={item.id}
                                                className="inspiration-item group relative cursor-grab border-[1.5px] active:cursor-grabbing isl-elastic"
                                                style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }}
                                                draggable
                                                onDragStart={event => handleLibraryDragStart(event, item)}
                                            >
                                                <img src={item.dataUrl} alt={item.name || ''} className="w-full object-contain" style={{ background: 'var(--isl-surface-2)' }} />

                                                {editingId === item.id ? (
                                                    <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
                                                        <input
                                                            ref={editInputRef}
                                                            type="text"
                                                            value={editingName}
                                                            onChange={event => setEditingName(event.target.value)}
                                                            onBlur={() => handleSaveEdit(item.id)}
                                                            onKeyDown={event => {
                                                                if (event.key === 'Enter') {
                                                                    event.preventDefault();
                                                                    handleSaveEdit(item.id);
                                                                } else if (event.key === 'Escape') {
                                                                    setEditingId(null);
                                                                    setEditingName('');
                                                                }
                                                            }}
                                                            className="isl-well min-w-0 flex-1 px-2 py-1 text-xs outline-none"
                                                            placeholder="输入名称"
                                                            aria-label="素材名称"
                                                            title="素材名称"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
                                                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                                                        <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2 text-white">
                                                            <div className="pointer-events-auto min-w-0 cursor-text" onDoubleClick={() => handleDoubleClick(item)}>
                                                                <div className="truncate text-xs font-medium">{item.name || '未命名'}</div>
                                                                <div className="text-[10px] opacity-80">{item.width}×{item.height}</div>
                                                            </div>
                                                            {onReversePrompt && (
                                                                <button
                                                                    type="button"
                                                                    className="pointer-events-auto rounded-lg bg-white/10 p-1 backdrop-blur transition-colors hover:bg-white/20"
                                                                    title="反推 Prompt"
                                                                    onClick={event => {
                                                                        event.stopPropagation();
                                                                        onReversePrompt(item.dataUrl, item.mimeType || 'image/png', item.width, item.height);
                                                                    }}
                                                                >
                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white">
                                                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                                        <polyline points="17 8 12 3 7 8" />
                                                                        <line x1="12" y1="3" x2="12" y2="15" />
                                                                    </svg>
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                className="pointer-events-auto rounded-lg bg-white/10 p-1 backdrop-blur transition-colors hover:bg-white/20"
                                                                title="删除"
                                                                onClick={event => {
                                                                    event.stopPropagation();
                                                                    onRemove(category, item.id);
                                                                }}
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white">
                                                                    <polyline points="3 6 5 6 21 6" />
                                                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                                                    <path d="M10 11v6" />
                                                                    <path d="M14 11v6" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'runningHub' && (
                        <RunningHubWebAppPanel theme={theme} compactMode={compactMode} />
                    )}
                </div>
            </div>
        </>
    );
};
