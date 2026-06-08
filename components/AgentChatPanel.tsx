import React, { useEffect, useRef, useState } from 'react';
import type { GenerationHistoryItem } from '../types';
import { getFlovartRuntimeApi, getRuntimeErrorMessage } from '../services/flovartRuntime';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { executeFlovartCommand } from '../tools/flovart/core.js';

interface AgentChatPanelProps {
    theme: 'light' | 'dark';
    compactMode: boolean;
    generationHistory: GenerationHistoryItem[];
    onCreateImage?: (prompt: string, name?: string) => Promise<void>;
    onCreateVideo?: (prompt: string, sourceImageIds?: string[]) => Promise<void>;
    runtimeStage?: string;
    runtimeJobs?: RuntimeJobSnapshot[];
}

interface RuntimeJobSnapshot {
    jobId: string;
    command: string;
    status: 'accepted' | 'running' | 'succeeded' | 'failed' | 'canceled';
    progress: {
        pct: number;
        stage: string;
    };
    updatedAt: number;
}

interface MessageLog {
    id: string;
    sender: 'user' | 'agent' | 'system';
    text: string;
    time: string;
    role: string;
    status?: 'idle' | 'running' | 'error' | 'success';
}

const AGENT_CHAT_LOGS_STORAGE_KEY = 'agentChat.logs.v1';
const AGENT_CHAT_LOG_MAX = 200;

const isMessageLog = (value: unknown): value is MessageLog => (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as MessageLog).id === 'string' &&
    typeof (value as MessageLog).text === 'string' &&
    typeof (value as MessageLog).time === 'string' &&
    typeof (value as MessageLog).role === 'string' &&
    typeof (value as MessageLog).sender === 'string'
);

const loadPersistedLogs = (): MessageLog[] | null => {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(AGENT_CHAT_LOGS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        const valid = parsed.filter(isMessageLog);
        return valid.length > 0 ? valid : null;
    } catch {
        return null;
    }
};

const panelCopy = {
    zho: {
        title: 'Agent 对话',
        initial: '我准备好了。直接告诉我你想做什么，越具体越好。',
        agentFailed: '任务执行失败。',
        noHistory: '还没有对话历史。',
        inputPlaceholder: '例如：做一张电影感红色调海报，人物在雨夜街头。Shift+Enter 换行',
        openSystemPrompt: 'System Prompt',
        clearHistory: '清空',
        clearHistoryTitle: '清空对话历史',
        systemPromptTitle: '自定义 System Prompt',
        systemPromptHint: '控制 Agent 的语气、执行方式和提示词风格。',
        viewChat: '对话',
        viewHistory: '历史',
        planTitle: '即将执行',
        exec: '执行',
        run: '执行中',
        imageStarted: '图片任务已开始。完成后会出现在历史记录里。',
        videoStarted: '视频任务已开始。完成后会出现在历史记录里。',
        imageSteps: ['创建图片图层', '写入增强后的提示词', '启动当前图片模型'],
        videoSteps: ['创建视频图层', '写入增强后的提示词', '启动当前视频模型'],
        emptyHistory: '还没有对话。',
        historyHint: '点击一条回到那个时刻。',
    },
    en: {
        title: 'Agent Chat',
        initial: 'I am ready. Tell me what you want to make. More detail helps.',
        agentFailed: 'Task execution failed.',
        noHistory: 'No generation history yet.',
        inputPlaceholder: 'Example: a cinematic red poster. Shift+Enter for newline',
        openSystemPrompt: 'System Prompt',
        clearHistory: 'Clear',
        clearHistoryTitle: 'Clear conversation history',
        systemPromptTitle: 'Custom System Prompt',
        systemPromptHint: 'Control the agent tone, execution behavior, and prompt style.',
        viewChat: 'Chat',
        viewHistory: 'History',
        planTitle: 'Next action',
        exec: 'Execute',
        run: 'Running',
        imageStarted: 'Image task started. It will appear in history when complete.',
        videoStarted: 'Video task started. It will appear in history when complete.',
        imageSteps: ['Create image layer', 'Write enhanced prompt', 'Start current image model'],
        videoSteps: ['Create video layer', 'Write enhanced prompt', 'Start current video model'],
        emptyHistory: 'No conversation yet.',
        historyHint: 'Click a message to jump there.',
    },
} as const;

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const createAgentElementId = () => `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const inferAction = (text: string): 'image' | 'video' => (
    /视频|短片|镜头|运镜|motion|camera|video|clip/i.test(text) ? 'video' : 'image'
);

export interface AgentAtomicCommand {
    command: 'element.create' | 'element.update-prompt' | 'element.ignite';
    args: Record<string, unknown>;
}

export function buildAgentAtomicPlan(input: {
    action: 'image' | 'video';
    elementId: string;
    layerName: string;
    prompt: string;
    historyLength: number;
}): AgentAtomicCommand[] {
    const { action, elementId, layerName, prompt, historyLength } = input;
    return [
        {
            command: 'element.create',
            args: {
                id: elementId,
                type: action,
                name: layerName,
                x: 120 + historyLength * 32,
                y: 140 + historyLength * 28,
                width: action === 'video' ? 240 : 180,
                height: action === 'video' ? 140 : 180,
            },
        },
        {
            command: 'element.update-prompt',
            args: { elementId, textPrompt: prompt },
        },
        {
            command: 'element.ignite',
            args: { elementId },
        },
    ];
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
    theme,
    compactMode,
    generationHistory,
    onCreateImage,
    onCreateVideo,
}) => {
    const language = useWorkspaceStore(state => state.language);
    const copy = language === 'zho' ? panelCopy.zho : panelCopy.en;
    const [typedText, setTypedText] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [showSystemPromptEditor, setShowSystemPromptEditor] = useState(false);
    const [view, setView] = useState<'chat' | 'history'>('chat');
    const [systemPrompt, setSystemPrompt] = useState(
        language === 'zho'
            ? '你是 Flovart 的内置创作助手。把用户需求转成简洁、可执行、适合图像或视频生成的提示词。'
            : 'You are Flovart\'s built-in creative assistant. Turn user requests into concise executable image or video prompts.'
    );
    const [logs, setLogs] = useState<MessageLog[]>(() => {
        const persisted = loadPersistedLogs();
        if (persisted && persisted.length > 0) return persisted;
        return [
            {
                id: 'init_1',
                sender: 'agent',
                text: copy.initial,
                time: nowLabel(),
                role: 'Agent',
                status: 'idle',
            },
        ];
    });

    const endRef = useRef<HTMLDivElement>(null);
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const pendingAction = inferAction(typedText.trim());
    const executionPlan = pendingAction === 'video' ? copy.videoSteps : copy.imageSteps;

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => {
        setLogs(prev => prev.map((log, index) => (
            index === 0 && log.id === 'init_1' ? { ...log, text: copy.initial } : log
        )));
    }, [copy.initial]);

    useEffect(() => {
        if (typeof localStorage === 'undefined') return;
        try {
            const trimmed = logs.length > AGENT_CHAT_LOG_MAX
                ? logs.slice(logs.length - AGENT_CHAT_LOG_MAX)
                : logs;
            localStorage.setItem(AGENT_CHAT_LOGS_STORAGE_KEY, JSON.stringify(trimmed));
        } catch {
            // ignore quota / serialization errors
        }
    }, [logs]);

    const handleClearLogs = () => {
        setLogs([
            {
                id: 'init_1',
                sender: 'agent',
                text: copy.initial,
                time: nowLabel(),
                role: 'Agent',
                status: 'idle',
            },
        ]);
    };

    const pushLog = (entry: Omit<MessageLog, 'id' | 'time'>) => {
        setLogs(prev => [...prev, { ...entry, id: `${entry.sender}_${Date.now()}_${prev.length}`, time: nowLabel() }]);
    };

    const handleCommitStream = async () => {
        const prompt = typedText.trim();
        if (!prompt || isRunning) return;

        const action = inferAction(prompt);
        const finalPrompt = `${systemPrompt}\n\nUser request:\n${prompt}`;
        const layerName = language === 'zho'
            ? `Agent 产物 ${generationHistory.length + 1}`
            : `Agent Output ${generationHistory.length + 1}`;

        setTypedText('');
        pushLog({ sender: 'user', text: prompt, role: 'You' });
        setIsRunning(true);

        try {
            const runtimeApi = getFlovartRuntimeApi();

            if (runtimeApi) {
                const elementId = createAgentElementId();
                const plan = buildAgentAtomicPlan({
                    action,
                    elementId,
                    layerName,
                    prompt: finalPrompt,
                    historyLength: generationHistory.length,
                });

                for (const step of plan) {
                    const result = await executeFlovartCommand(step.command, step.args, runtimeApi);
                    if (result?.ok === false) {
                        throw new Error(getRuntimeErrorMessage(result, `Agent command failed: ${step.command}`));
                    }
                }
            } else if (action === 'video') {
                await onCreateVideo?.(finalPrompt);
            } else {
                await onCreateImage?.(finalPrompt, layerName);
            }

            pushLog({
                sender: 'agent',
                text: action === 'video' ? copy.videoStarted : copy.imageStarted,
                role: 'Agent',
                status: 'success',
            });
        } catch (error) {
            pushLog({
                sender: 'system',
                text: error instanceof Error ? error.message : copy.agentFailed,
                role: 'Runtime',
                status: 'error',
            });
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className={`flv-agent-dock flex h-full min-h-0 flex-col ${compactMode ? 'text-[11px]' : 'text-xs'}`} style={{ background: 'var(--isl-surface)', borderLeft: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)', fontFamily: 'var(--isl-font)' }}>
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5" style={{ borderBottom: '1.5px solid var(--isl-border)' }}>
                <div className="text-[14px] font-extrabold tracking-[-0.01em]" style={{ color: 'var(--isl-ink)' }}>
                    {copy.title}
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={handleClearLogs}
                        disabled={logs.length <= 1}
                        className="isl-chip h-7 px-2.5 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
                        title={copy.clearHistoryTitle}
                    >
                        {copy.clearHistory}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowSystemPromptEditor(prev => !prev)}
                        className={`isl-chip h-7 px-3 text-[11px] ${showSystemPromptEditor ? 'isl-chip--active' : ''}`}
                        title={copy.systemPromptTitle}
                    >
                        {copy.openSystemPrompt}
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-1.5 px-3.5 pt-2" style={{ borderBottom: '1.5px solid var(--isl-border)', paddingBottom: 8 }}>
                <div className="isl-tabbar isl-tabbar--ac flex flex-1 gap-0.5" style={{ padding: 3 }}>
                    <button
                        type="button"
                        onClick={() => setView('chat')}
                        className={`isl-tab min-w-0 flex-1 rounded-full px-2 py-1 text-[11px] ${view === 'chat' ? 'isl-tab--active' : ''}`}
                    >
                        <span className="flex items-center justify-center gap-1.5">
                            {view === 'chat' && (
                                <span
                                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ background: 'var(--isl-mint)', boxShadow: '0 0 0 2px var(--isl-card)' }}
                                />
                            )}
                            {copy.viewChat}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setView('history')}
                        className={`isl-tab min-w-0 flex-1 rounded-full px-2 py-1 text-[11px] ${view === 'history' ? 'isl-tab--active' : ''}`}
                    >
                        <span className="flex items-center justify-center gap-1.5">
                            {view === 'history' && (
                                <span
                                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{ background: 'var(--isl-mint)', boxShadow: '0 0 0 2px var(--isl-card)' }}
                                />
                            )}
                            {copy.viewHistory}
                            <span className="ml-0.5 inline-block rounded-full px-1.5 py-px text-[9px] tabular-nums" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)' }}>
                                {logs.filter(log => log.id !== 'init_1').length}
                            </span>
                        </span>
                    </button>
                </div>
            </div>

            {showSystemPromptEditor && (
                <div className="px-3.5 pt-3">
                    <div className="isl-well p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="text-[12px] font-bold" style={{ color: 'var(--isl-ink)' }}>
                                {copy.systemPromptTitle}
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                                {systemPrompt.length}
                            </div>
                        </div>
                        <textarea
                            value={systemPrompt}
                            onChange={(event) => setSystemPrompt(event.target.value)}
                            rows={3}
                            className="w-full resize-none rounded-xl border-none bg-transparent text-[12px] leading-relaxed outline-none"
                            style={{ color: 'var(--isl-ink)' }}
                            placeholder={copy.systemPromptHint}
                        />
                    </div>
                </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col">
                {view === 'chat' ? (
                    <>
                        <div ref={chatScrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3 select-text">
                            {logs.map(log => {
                                const isUser = log.sender === 'user';
                                const isError = log.status === 'error';
                                return (
                                    <div key={log.id} data-msg-id={log.id} className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                                        <span
                                            className="isl-avatar"
                                            style={{
                                                background: isUser ? 'var(--isl-surface-2)' : isError ? 'rgba(232,97,90,0.18)' : 'var(--isl-mint)',
                                            }}
                                        >
                                            {isUser ? '🧑' : isError ? '⚠️' : '🌱'}
                                        </span>
                                        <div className={`min-w-0 max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
                                            <div className="mb-1 px-1 text-[10px] font-semibold" style={{ color: 'var(--isl-ink-ghost)' }}>
                                                {log.time}
                                            </div>
                                            <div className={`isl-bubble px-3.5 py-2.5 text-[13px] ${isUser ? 'isl-bubble--user' : isError ? 'isl-bubble--error' : 'isl-bubble--agent'}`}>
                                                {log.text}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={endRef} />
                        </div>

                        <div className="px-3.5 py-3" style={{ borderTop: '1.5px solid var(--isl-border)' }}>
                            {typedText.trim() && (
                                <div className="isl-bubble isl-bubble--agent mb-3 px-3 py-3">
                                    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--isl-mint-deep)' }}>
                                        <span>{pendingAction === 'video' ? '🎬' : '🖼️'}</span>
                                        {copy.planTitle}
                                    </div>
                                    <div className="space-y-1.5 text-[11px] leading-relaxed">
                                        {executionPlan.map((step, index) => (
                                            <div key={step} className="flex items-center gap-2">
                                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}>
                                                    {index + 1}
                                                </span>
                                                <span style={{ color: 'var(--isl-ink-soft)' }}>{step}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="isl-well flex items-center gap-2 px-2 py-2">
                                <textarea
                                    rows={1}
                                    className="min-h-9 max-h-32 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[13px] leading-relaxed outline-none"
                                    style={{ color: 'var(--isl-ink)', fontFamily: 'var(--isl-font)' }}
                                    placeholder={copy.inputPlaceholder}
                                    value={typedText}
                                    disabled={isRunning}
                                    onChange={(event) => setTypedText(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' && !event.shiftKey) {
                                            event.preventDefault();
                                            void handleCommitStream();
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleCommitStream()}
                                    disabled={!typedText.trim() || isRunning}
                                    className="isl-go h-9 px-4 text-[12px]"
                                >
                                    {isRunning ? copy.run : copy.exec}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col px-3.5 py-3">
                        <div className="mb-2 text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                            {copy.historyHint}
                        </div>
                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
                            {logs.length <= 1 ? (
                                <div className="rounded-2xl border-[1.5px] px-3 py-6 text-center text-[12px]" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)', color: 'var(--isl-ink-ghost)' }}>
                                    {copy.emptyHistory}
                                </div>
                            ) : (
                                logs.map((log, index) => {
                                    const isUser = log.sender === 'user';
                                    const isError = log.status === 'error';
                                    const isInit = log.id === 'init_1';
                                    return (
                                        <button
                                            type="button"
                                            key={log.id}
                                            onClick={() => {
                                                setView('chat');
                                                requestAnimationFrame(() => {
                                                    const node = document.querySelector(`[data-msg-id="${log.id}"]`);
                                                    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                });
                                            }}
                                            className="flex w-full items-start gap-2.5 rounded-2xl border-[1.5px] px-3 py-2 text-left transition-colors"
                                            style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)', boxShadow: '0 2px 0 0 var(--isl-edge)' }}
                                        >
                                            <span
                                                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                                                style={{
                                                    background: isUser ? 'var(--isl-surface-2)' : isError ? 'rgba(232,97,90,0.18)' : 'var(--isl-mint-bg)',
                                                    color: isUser ? 'var(--isl-ink)' : isError ? 'var(--isl-coral-deep)' : 'var(--isl-mint-deep)',
                                                }}
                                            >
                                                {isUser ? 'U' : isError ? '!' : isInit ? 'i' : 'A'}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="truncate text-[11px] font-bold" style={{ color: 'var(--isl-ink)' }}>
                                                        {isUser ? 'You' : log.role}
                                                    </div>
                                                    <div className="shrink-0 text-[10px] tabular-nums" style={{ color: 'var(--isl-ink-ghost)' }}>
                                                        {log.time}
                                                    </div>
                                                </div>
                                                <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug" style={{ color: 'var(--isl-ink-soft)' }}>
                                                    {log.text}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AgentChatPanel;
