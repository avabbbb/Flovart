import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationHistoryItem } from '../types';

interface AgentChatPanelProps {
    theme: 'light' | 'dark';
    compactMode: boolean;
    generationHistory: GenerationHistoryItem[];
    onCreateImage?: (prompt: string, name?: string) => Promise<void>;
    onCreateVideo?: (prompt: string, sourceImageIds?: string[]) => Promise<void>;
}

interface MessageSnapshot {
    id: string;
    sender: 'human' | 'agent' | 'system';
    text: string;
    timestamp: string;
    roleTag: string;
    status?: 'idle' | 'running' | 'error' | 'success';
}

interface AgentPreset {
    id: string;
    label: string;
    shortLabel: string;
    intent: string;
}

const agentPresets: AgentPreset[] = [
    { id: 'creative-director', label: 'Creative Director', shortLabel: 'Director', intent: '统一视觉判断、短剧节奏和资产生成策略。' },
    { id: 'storyboard-crafter', label: 'Storyboard Crafter', shortLabel: 'Storyboard', intent: '把一句需求拆成可执行镜头和关键帧资产。' },
    { id: 'vibe-supervisor', label: 'Vibe Supervisor', shortLabel: 'Vibe', intent: '检查风格连续性、色调和角色一致性。' },
];

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function inferAgentAction(text: string): 'image' | 'video' {
    return /视频|短片|镜头|运动|运镜|video|clip|camera|motion/i.test(text) ? 'video' : 'image';
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
    theme,
    compactMode,
    generationHistory,
    onCreateImage,
    onCreateVideo,
}) => {
    const isDark = theme === 'dark';
    const [inputText, setInputText] = useState('');
    const [activeRoleId, setActiveRoleId] = useState(agentPresets[0].id);
    const [history, setHistory] = useState<MessageSnapshot[]>(() => [{
        id: 'agent_boot',
        sender: 'agent',
        text: '内置 Agent 剧本工坊已接管右侧面板。输入镜头、图片或短剧需求，我会直接调度画布生成入口。',
        timestamp: nowLabel(),
        roleTag: 'Creative Director',
        status: 'idle',
    }]);
    const [isRunning, setIsRunning] = useState(false);
    const streamEndRef = useRef<HTMLDivElement>(null);

    const activeRole = useMemo(() => (
        agentPresets.find(preset => preset.id === activeRoleId) || agentPresets[0]
    ), [activeRoleId]);

    useEffect(() => {
        streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history]);

    const pushMessage = (message: Omit<MessageSnapshot, 'id' | 'timestamp'>) => {
        setHistory(prev => [...prev, {
            ...message,
            id: `${message.sender}_${Date.now()}_${prev.length}`,
            timestamp: nowLabel(),
        }]);
    };

    const handleSendMessage = async () => {
        const prompt = inputText.trim();
        if (!prompt || isRunning) return;

        setInputText('');
        pushMessage({ sender: 'human', text: prompt, roleTag: 'User' });
        setIsRunning(true);

        const action = inferAgentAction(prompt);
        pushMessage({
            sender: 'agent',
            text: action === 'video'
                ? '收到视频任务，正在选择动态 Provider 视频路由并准备首帧上下文。'
                : '收到图片任务，正在选择动态 Provider 图像路由并准备画布资产。',
            roleTag: activeRole.label,
            status: 'running',
        });

        try {
            if (action === 'video') {
                await onCreateVideo?.(prompt);
            } else {
                await onCreateImage?.(prompt, `Agent Asset ${generationHistory.length + 1}`);
            }
            pushMessage({
                sender: 'agent',
                text: action === 'video'
                    ? '视频任务已交给画布运行时，生成结果会作为新 Video 资产回写。'
                    : '图片任务已交给画布运行时，生成结果会作为新 Image 资产回写。',
                roleTag: activeRole.label,
                status: 'success',
            });
        } catch (error) {
            pushMessage({
                sender: 'system',
                text: error instanceof Error ? error.message : 'Agent 调度失败。',
                roleTag: 'Runtime',
                status: 'error',
            });
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className={`flex h-full min-h-0 flex-col bg-[#12141a] font-mono text-xs text-zinc-400 ${compactMode ? 'text-[11px]' : ''}`}>
            <div className="border-b border-zinc-800/60 p-2">
                <div className="mb-1.5 flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Built-In Team Presets</div>
                    <div className="rounded-[3px] border border-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-600">ONLINE</div>
                </div>
                <div className="flex flex-wrap gap-1">
                    {agentPresets.map(role => (
                        <button
                            key={role.id}
                            type="button"
                            onClick={() => setActiveRoleId(role.id)}
                            className={`cursor-pointer rounded-[3px] border px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                                activeRoleId === role.id
                                    ? 'border-[#00ff88] bg-[#00ff88]/5 text-[#00ff88]'
                                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                            }`}
                            title={role.intent}
                        >
                            {role.shortLabel}
                        </button>
                    ))}
                </div>
                <div className="mt-1.5 truncate text-[9px] text-zinc-600">{activeRole.intent}</div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 select-text">
                {history.map(message => {
                    const isHuman = message.sender === 'human';
                    const isError = message.status === 'error';
                    return (
                        <div key={message.id} className={`flex max-w-[92%] flex-col gap-1 ${isHuman ? 'self-end items-end' : 'self-start items-start'}`}>
                            <div className="flex items-center gap-1.5 text-[9px] font-bold text-zinc-600 select-none">
                                <span className={isHuman ? 'text-zinc-500' : isError ? 'text-rose-400' : 'text-amber-500/80'}>[{message.roleTag}]</span>
                                <span>{message.timestamp}</span>
                            </div>
                            <div className={`rounded-[4px] border p-2 text-xs leading-relaxed ${
                                isHuman
                                    ? 'border-zinc-800 bg-zinc-900/40 text-zinc-300'
                                    : isError
                                        ? 'border-rose-500/30 bg-rose-500/5 text-rose-200'
                                        : 'border-zinc-800/80 bg-[#161a22] text-zinc-200 shadow-[0_12px_32px_rgba(0,0,0,0.6),inset_0_0_1px_rgba(255,255,255,0.08)]'
                            }`}>
                                {message.text}
                            </div>
                        </div>
                    );
                })}
                <div ref={streamEndRef} />
            </div>

            <div className="border-t border-zinc-800/60 bg-black/20 p-2">
                <div className="flex items-center gap-1.5 rounded-[4px] border border-zinc-800/80 bg-neutral-950/40 p-1.5">
                    <input
                        type="text"
                        className="min-w-0 flex-1 border-0 bg-transparent font-sans text-xs text-zinc-200 outline-none placeholder:text-zinc-700"
                        placeholder={`Talk to ${activeRole.shortLabel} Agent...`}
                        value={inputText}
                        disabled={isRunning}
                        onChange={(event) => setInputText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void handleSendMessage();
                            }
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => void handleSendMessage()}
                        disabled={!inputText.trim() || isRunning}
                        className="cursor-pointer rounded-[3px] border border-zinc-700 px-2 py-0.5 text-[10px] font-bold text-zinc-400 transition disabled:cursor-not-allowed disabled:opacity-40 hover:border-zinc-500 active:scale-95"
                    >
                        {isRunning ? 'RUN' : 'SEND'}
                    </button>
                </div>
                <div className="mt-1 text-right text-[8px] tracking-tighter text-zinc-600 select-none">
                    AUTOMATION CORE: AGENT DOCK ONLINE
                </div>
            </div>
        </div>
    );
};

export default AgentChatPanel;
