import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetCategory, AssetItem, AssetLibrary, GenerationHistoryItem } from '../types';
import { AgentChatPanel } from './AgentChatPanel';
import { rhGetWebAppNodes, rhRunWebApp, rhUploadWebAppDataUrl, type RHWebAppNodeInfo, type RHWebAppOutputItem, type RHWebAppTaskStatus } from '../services/runningHubService';

type RightPanelTab = 'history' | 'inspiration' | 'agent' | 'runningHub';

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
}

const CATEGORY_LABELS: Record<AssetCategory, string> = {
    character: '角色',
    scene: '场景',
    prop: '道具',
};

const CategoryTabs: React.FC<{ value: AssetCategory; onChange: (c: AssetCategory) => void; isDark?: boolean }> = ({ value, onChange, isDark }) => (
    <div className="inline-flex items-center gap-3">
        {(Object.keys(CATEGORY_LABELS) as AssetCategory[]).map(category => (
            <button
                key={category}
                type="button"
                onClick={() => onChange(category)}
                className={`border-b px-0 py-2 text-xs font-medium transition-all ${
                    value === category
                        ? isDark ? 'border-[#F3F4F6] text-[#F3F4F6]' : 'border-neutral-900 text-neutral-900'
                        : isDark ? 'border-transparent text-[#667085] hover:text-[#D0D5DD]' : 'border-transparent text-neutral-500 hover:text-neutral-800'
                }`}
            >
                {CATEGORY_LABELS[category]}
            </button>
        ))}
    </div>
);

const EmptyHistory: React.FC<{ isDark?: boolean }> = ({ isDark }) => (
    <div className={`flex flex-1 items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center ${
        isDark ? 'border-[#2A3140] bg-[#161A22]' : 'border-neutral-200 bg-neutral-50'
    }`}>
        <div>
            <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl ${
                isDark ? 'bg-[#1B2029] text-[#667085]' : 'bg-white text-neutral-300 shadow-sm'
            }`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                </svg>
            </div>
            <p className={`mt-3 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-neutral-700'}`}>还没有历史生成内容</p>
            <p className={`mt-1 text-xs ${isDark ? 'text-[#667085]' : 'text-neutral-500'}`}>新的图片生成后会自动保存到本地，并显示在这里。</p>
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

    const inputClass = `w-full rounded-xl border px-3 py-2 text-xs outline-none transition ${
        isDark
            ? 'border-[#2A3140] bg-[#161A22] text-[#F3F4F6] placeholder:text-[#667085] focus:border-[#4B5B78]'
            : 'border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400'
    }`;

    const btnClass = `rounded-lg border px-4 py-2 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${
        isDark
            ? 'border-[#2A3140] bg-[#161A22] text-[#F3F4F6] hover:border-[#4B5B78] hover:bg-[#1B2029]'
            : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50'
    }`;

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
                <h3 className={`text-sm font-bold ${isDark ? 'text-[#F3F4F6]' : 'text-neutral-900'}`}>
                    🚀 RunningHub AI 应用
                </h3>
                <p className={`mt-1 text-xs ${isDark ? 'text-[#667085]' : 'text-neutral-500'}`}>
                    接入 RunningHub WebApp 工作流，输入 WebApp ID 即可调用。
                </p>
            </div>

            {/* API Key */}
            <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-[#98A2B3]' : 'text-neutral-500'}`}>
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
                    className="mt-1 block text-[10px] text-blue-500 hover:underline"
                >
                    获取 API Key ↗
                </a>
            </div>

            {/* WebApp ID */}
            <div>
                <label className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-[#98A2B3]' : 'text-neutral-500'}`}>
                    WebApp ID
                </label>
                <input
                    value={webappId}
                    onChange={e => setWebappId(e.target.value)}
                    placeholder="如: 1937084629516193794"
                    className={inputClass}
                />
                <p className={`mt-1 text-[10px] ${isDark ? 'text-[#667085]' : 'text-neutral-400'}`}>
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
                <div className={`rounded-xl px-3 py-2 text-xs ${isDark ? 'bg-red-900/30 text-red-300' : 'bg-red-50 text-red-600'}`}>
                    ✗ {error}
                </div>
            )}

            {/* 节点列表 */}
            {nodes.length > 0 && (
                <div className={`rounded-xl border ${isDark ? 'border-[#2A3140]' : 'border-neutral-200'}`}>
                    <div className={`px-3 py-2 text-[11px] font-semibold ${isDark ? 'bg-[#1B2029] text-[#98A2B3]' : 'bg-neutral-50 text-neutral-500'} rounded-t-xl`}>
                        可修改节点 ({nodes.length})
                    </div>
                    <div className="max-h-[300px] overflow-y-auto divide-y divide-neutral-100">
                        {nodes.map((node, i) => (
                            <div key={`${node.nodeId}-${node.fieldName}-${i}`} className={`px-3 py-2.5 ${isDark ? 'divide-[#2A3140]' : ''}`}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-[11px] font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-neutral-700'}`}>
                                        {node.description || node.nodeName}
                                    </span>
                                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-mono ${
                                        isDark ? 'bg-[#1B2029] text-[#667085]' : 'bg-neutral-100 text-neutral-400'
                                    }`}>
                                        {node.fieldType}
                                    </span>
                                </div>
                                {node.fieldType === 'IMAGE' || node.fieldType === 'AUDIO' || node.fieldType === 'VIDEO' ? (
                                    <div className={`text-[10px] italic ${isDark ? 'text-[#667085]' : 'text-neutral-400'}`}>
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
                <div className={`rounded-xl border ${isDark ? 'border-green-800 bg-green-900/20' : 'border-green-200 bg-green-50'} p-3`}>
                    <div className={`mb-2 text-xs font-semibold ${isDark ? 'text-green-300' : 'text-green-700'}`}>
                        🎉 生成结果
                    </div>
                    {outputs.map((out, i) => (
                        <a
                            key={i}
                            href={out.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mb-1 block truncate text-xs text-blue-500 hover:underline"
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
                className={`theme-aware fixed z-20 flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm ${
                    isDark ? 'border-[#2A3140] bg-[#12151B] text-[#98A2B3] hover:text-white' : 'border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900'
                }`}
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
                className={`compact-right-panel theme-aware fixed z-[30] flex flex-col overflow-hidden border shadow-xl backdrop-blur-xl ${
                    compactMode ? 'rounded-[24px]' : 'rounded-[28px]'
                } ${isDark ? 'border-[#2A3140] bg-[#12151B]/96' : 'border-neutral-200/60 bg-white/96'}`}
            >
                <div
                    className={`absolute left-0 top-0 z-10 h-full cursor-ew-resize transition-colors hover:bg-blue-400/70 ${compactMode ? 'w-1' : 'w-1.5'}`}
                    onPointerDown={handleResizePointerDown}
                />

                <div className={`flex items-center justify-between border-b ${isDark ? 'border-[#2A3140]' : 'border-neutral-200/60'} ${compactMode ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
                    <div className={`flex items-center gap-3 ${compactMode ? 'text-[12px]' : ''}`}>
                        {([
                            { key: 'agent' as RightPanelTab, label: 'Agent Studio', icon: null },
                            { key: 'history' as RightPanelTab, label: '历史', icon: null },
                            { key: 'inspiration' as RightPanelTab, label: '素材库', icon: null },
                            { key: 'runningHub' as RightPanelTab, label: 'RH', icon: '🚀' },
                        ]).map(tab => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveTab(tab.key)}
                                className={`right-panel-tab ${activeTab === tab.key ? 'active' : ''} ${compactMode ? 'text-[12px]' : ''}`}
                            >
                                {tab.icon ? `${tab.icon} ${tab.label}` : tab.label}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={onToggleMinimize}
                        className={`rounded-md border px-2 py-1.5 text-[11px] transition-colors ${isDark ? 'border-[#2A3140] text-[#667085] hover:border-[#4B5B78] hover:text-[#D0D5DD]' : 'border-neutral-200 text-neutral-400 hover:border-neutral-300 hover:text-neutral-700'}`}
                        title="收起"
                    >
                        收起
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                    {activeTab === 'history' && (
                        <div className={`flex h-full min-h-0 flex-col ${compactMode ? 'gap-3 p-3' : 'gap-3 p-4'}`}>
                            <div className="flex min-h-0 flex-1 flex-col">
                                <div className="mb-3 flex items-center justify-between">
                                    <div>
                                        <h3 className={`text-sm font-semibold ${isDark ? 'text-[#F3F4F6]' : 'text-neutral-900'}`}>历史生成</h3>
                                        <p className={`mt-0.5 text-xs ${isDark ? 'text-[#667085]' : 'text-neutral-500'}`}>自动保存到本地，可直接拖到画布。</p>
                                    </div>
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${isDark ? 'bg-[#1B2029] text-[#98A2B3]' : 'bg-neutral-100 text-neutral-500'}`}>
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
                                                    className={`history-card group border ${
                                                        isDark ? 'border-[#2A3140] bg-[#161A22]' : 'border-neutral-100 bg-white'
                                                    }`}
                                                    draggable
                                                    onDragStart={event => handleHistoryDragStart(event, item)}
                                                >
                                                    <div className={`history-card-img m-1.5 ${isDark ? 'bg-[#1B2029]' : 'bg-neutral-50'}`}>
                                                        <img
                                                            src={item.dataUrl}
                                                            alt={item.name || item.prompt}
                                                            className={`w-full object-cover ${compactMode ? 'aspect-[4/3]' : 'aspect-square'}`}
                                                        />
                                                    </div>
                                                    <div className="px-2.5 pb-2.5 pt-1">
                                                        <p className={`line-clamp-2 text-xs font-medium leading-[1.4] ${isDark ? 'text-[#D0D5DD]' : 'text-neutral-800'}`}>
                                                            {item.name || item.prompt}
                                                        </p>
                                                        <div className={`mt-1.5 flex items-center justify-between text-[10px] ${isDark ? 'text-[#667085]' : 'text-neutral-400'}`}>
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

                    {activeTab === 'inspiration' && (
                        <div className="flex h-full min-h-0 flex-col">
                            <div className={`flex items-center justify-between border-b ${isDark ? 'border-[#2A3140]' : 'border-neutral-200/60'} ${compactMode ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
                                <CategoryTabs value={category} onChange={setCategory} isDark={isDark} />
                                <span className={`text-[11px] tabular-nums ${isDark ? 'text-[#667085]' : 'text-neutral-500'}`}>{items.length} 项</span>
                            </div>

                            <div className={`min-h-0 flex-1 overflow-y-auto ${compactMode ? 'p-2.5' : 'p-3'}`}>
                                {items.length === 0 ? (
                                    <div className={`flex h-full items-center justify-center ${isDark ? 'text-[#667085]' : 'text-neutral-400'}`}>
                                        <div className="text-center">
                                            <svg className={`mx-auto mb-3 h-14 w-14 ${isDark ? 'opacity-30' : 'opacity-20'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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
                                                className={`inspiration-item group relative cursor-grab border active:cursor-grabbing ${
                                                    isDark ? 'border-[#2A3140] bg-[#161A22]' : 'border-neutral-100 bg-white'
                                                }`}
                                                draggable
                                                onDragStart={event => handleLibraryDragStart(event, item)}
                                            >
                                                <img src={item.dataUrl} alt={item.name || ''} className={`w-full object-contain ${isDark ? 'bg-[#1B2029]' : 'bg-neutral-50'}`} />

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
                                                            className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs outline-none shadow-lg ${
                                                                isDark ? 'border-[#4B5B78] bg-[#161A22]/95 text-[#F3F4F6]' : 'border-blue-400 bg-white/95 text-neutral-900'
                                                            }`}
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

                    {activeTab === 'agent' && (
                        <div className="h-full min-h-0 px-0 py-0">
                            <AgentChatPanel
                                theme={theme}
                                compactMode={compactMode}
                                generationHistory={generationHistory}
                                onCreateImage={onCreateImage}
                                onCreateVideo={onCreateVideo}
                                runtimeStage={runtimeStage}
                                runtimeJobs={runtimeJobs}
                            />
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
