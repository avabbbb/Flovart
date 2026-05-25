import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const presetCopy = {
    zho: [
        { id: 'director', label: '小风导演', short: '导演', note: '统一镜头语言、风格密度和资产节奏。' },
        { id: 'script', label: '剧本架构师', short: '剧本', note: '把一句需求拆成镜头、关键帧和提示词。' },
        { id: 'vibe', label: '氛围矩阵', short: '氛围', note: '收紧氛围、色调和角色一致性。' },
    ],
    en: [
        { id: 'director', label: 'Director Feng', short: 'Director', note: 'Coordinate camera language, style density, and asset rhythm.' },
        { id: 'script', label: 'Script Architect', short: 'Script', note: 'Turn one request into shots, keyframes, and prompts.' },
        { id: 'vibe', label: 'Vibe Matrix', short: 'Vibe', note: 'Tighten atmosphere, palette, and character consistency.' },
    ],
} as const;

const panelCopy = {
    zho: {
        title: '内置剧本工坊',
        live: '在线',
        initial: '原子指令工坊在线。输入镜头需求，我会直接调度画布运行时并把结果回写到右侧历史。',
        videoReceived: '收到视频指令，正在绑定首帧上下文并点火视频路由。',
        imageReceived: '收到图像指令，正在整理提示词并点火图像路由。',
        videoQueued: '视频任务已通过原子运行时总线入队，卡片会就地显示排队与进度。',
        imageQueued: '图片任务已通过原子运行时总线入队，卡片会就地显示排队与进度。',
        agentFailed: 'Agent 调度失败。',
        taskMatrix: '任务矩阵',
        active: '运行中',
        running: '运行中',
        latest: '最新',
        queue: '队列',
        noJobs: '暂无运行时任务。',
        snapshots: '时间线快照',
        noHistory: '还没有生成历史。',
        inputPlaceholder: (role: string) => `和${role}对话...`,
        exec: '执行',
        run: '运行',
        online: '智能体面板在线',
    },
    en: {
        title: 'Built-In Script Workshop',
        live: 'LIVE',
        initial: 'Atomic command workshop is online. Describe a shot and I will dispatch the canvas runtime.',
        videoReceived: 'Video command received. Binding first-frame context and igniting video route.',
        imageReceived: 'Image command received. Normalizing prompt and igniting image route.',
        videoQueued: 'Video task queued through the atomic runtime bus. The card will show queue and progress inline.',
        imageQueued: 'Image task queued through the atomic runtime bus. The card will show queue and progress inline.',
        agentFailed: 'Agent dispatch failed.',
        taskMatrix: 'Task Matrix',
        active: 'Active',
        running: 'Running',
        latest: 'Latest',
        queue: 'Queue',
        noJobs: 'No runtime jobs yet.',
        snapshots: 'Timeline Snapshots',
        noHistory: 'No generation history yet.',
        inputPlaceholder: (role: string) => `Talk to ${role} Agent...`,
        exec: 'EXEC',
        run: 'RUN',
        online: 'AGENT DOCK ONLINE',
    },
} as const;

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const createAgentElementId = () => `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const inferAction = (text: string): 'image' | 'video' => (
    /视频|短片|镜头|motion|camera|video|clip|运镜/i.test(text) ? 'video' : 'image'
);

const commandLabelMap: Record<string, string> = {
    'generate.image': 'IMG',
    'generate.video': 'VID',
    'element.ignite': 'RUN',
    'element.update-prompt': 'PROMPT',
    'element.create': 'CREATE',
};

const opsCards = [
    {
        id: 'doctor',
        title: 'Doctor',
        command: 'flovart.doctor',
        note: 'Check MCP, host config, and runtime bridge readiness.',
        tone: 'from-sky-400/24 to-cyan-300/6',
    },
    {
        id: 'init',
        title: 'Host Init',
        command: 'flovart.init_host',
        note: 'Write OpenCode, Claude, Cursor, Roo, Windsurf, or VS Code config.',
        tone: 'from-violet-400/24 to-fuchsia-300/6',
    },
    {
        id: 'plan',
        title: 'Batch Plan',
        command: 'flovart.plan_batch',
        note: 'Turn one brief into structured multi-direction prompts.',
        tone: 'from-amber-300/24 to-orange-300/6',
    },
    {
        id: 'enhance',
        title: 'Enhance',
        command: 'flovart.enhance_prompt',
        note: 'Refine lightweight prompts before generation without exposing keys.',
        tone: 'from-emerald-300/24 to-lime-300/6',
    },
] as const;

function formatJobCommand(command: string): string {
    return commandLabelMap[command] || command.replace(/^.*\./, '').slice(0, 8).toUpperCase();
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
    theme,
    compactMode,
    generationHistory,
    onCreateImage,
    onCreateVideo,
    runtimeStage,
    runtimeJobs = [],
}) => {
    const isDark = theme === 'dark';
    const language = useWorkspaceStore(state => state.language);
    const copy = language === 'zho' ? panelCopy.zho : panelCopy.en;
    const presets = useMemo(() => language === 'zho' ? presetCopy.zho : presetCopy.en, [language]);
    const [typedText, setTypedText] = useState('');
    const [chosenRole, setChosenRole] = useState<string>('director');
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<MessageLog[]>([
        {
            id: 'init_1',
            sender: 'agent',
            text: copy.initial,
            time: nowLabel(),
            role: presets[0].label,
            status: 'idle',
        },
    ]);

    const endRef = useRef<HTMLDivElement>(null);
    const activePreset = useMemo(() => presets.find(item => item.id === chosenRole) || presets[0], [chosenRole, presets]);
    const recentHistory = useMemo(() => generationHistory.slice(-4).reverse(), [generationHistory]);
    const runningJobs = useMemo(() => runtimeJobs.filter(job => job.status === 'running' || job.status === 'accepted'), [runtimeJobs]);
    const recentJobs = useMemo(() => runtimeJobs.slice(0, 4), [runtimeJobs]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => {
        setLogs(prev => prev.map((log, index) => (
            index === 0 && log.id === 'init_1'
                ? { ...log, text: copy.initial, role: presets[0].label }
                : log
        )));
    }, [copy.initial, presets]);

    const pushLog = (entry: Omit<MessageLog, 'id' | 'time'>) => {
        setLogs(prev => [...prev, { ...entry, id: `${entry.sender}_${Date.now()}_${prev.length}`, time: nowLabel() }]);
    };

    const handleCommitStream = async () => {
        const prompt = typedText.trim();
        if (!prompt || isRunning) return;

        setTypedText('');
        pushLog({ sender: 'user', text: prompt, role: 'Xiao Feng' });
        setIsRunning(true);

        const action = inferAction(prompt);
        pushLog({
            sender: 'agent',
            text: action === 'video' ? copy.videoReceived : copy.imageReceived,
            role: activePreset.label,
            status: 'running',
        });

        try {
            const runtimeApi = getFlovartRuntimeApi();
            const layerName = language === 'zho' ? `智能体产物 ${generationHistory.length + 1}` : `Agent Output ${generationHistory.length + 1}`;

            if (runtimeApi) {
                const created = await executeFlovartCommand('element.create', {
                    id: createAgentElementId(),
                    type: action,
                    name: layerName,
                    x: 120 + generationHistory.length * 36,
                    y: 140 + generationHistory.length * 32,
                    width: action === 'video' ? 240 : 180,
                    height: action === 'video' ? 140 : 180,
                }, runtimeApi);

                const elementId = typeof created.id === 'string' ? created.id : '';
                if (created.ok === false || !elementId) {
                    throw new Error(getRuntimeErrorMessage(created, 'Agent 创建资产失败。'));
                }

                const updated = await executeFlovartCommand('element.update-prompt', { elementId, textPrompt: prompt }, runtimeApi);
                if (updated.ok === false) {
                    throw new Error(getRuntimeErrorMessage(updated, 'Agent 写入提示词失败。'));
                }

                const ignited = await executeFlovartCommand('element.ignite', { elementId }, runtimeApi);
                if (ignited.ok === false) {
                    throw new Error(getRuntimeErrorMessage(ignited, 'Agent 点火失败。'));
                }
            } else if (action === 'video') {
                await onCreateVideo?.(prompt);
            } else {
                await onCreateImage?.(prompt, layerName);
            }

            pushLog({
                sender: 'agent',
                text: action === 'video' ? copy.videoQueued : copy.imageQueued,
                role: activePreset.label,
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
        <div className={`flex h-full min-h-0 flex-col border-l ${isDark ? 'border-white/8 bg-[radial-gradient(circle_at_20%_0%,rgba(120,119,198,0.16),transparent_32%),linear-gradient(180deg,#11151d_0%,#0b0f15_100%)]' : 'border-neutral-200 bg-[linear-gradient(180deg,#fbfaf7_0%,#f6f4ef_46%,#ffffff_100%)]'} ${compactMode ? 'text-[11px]' : 'text-xs'}`}>
            <div className={`border-b px-3 py-3 ${isDark ? 'border-white/8 bg-black/10' : 'border-black/8 bg-white/55 backdrop-blur-xl'}`}>
                <div className="flex items-center justify-between">
                    <div>
                        <div className={`text-[9px] font-bold uppercase tracking-[0.22em] ${isDark ? 'text-white/38' : 'text-neutral-400'}`}>Agent Ops</div>
                        <div className={`mt-1 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em] ${isDark ? 'text-white' : 'text-neutral-950'}`}>
                            <span>{copy.title}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${isDark ? 'bg-emerald-300/12 text-emerald-200 ring-1 ring-emerald-300/18' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}>{copy.live}</span>
                        </div>
                        <div className={`mt-1 text-[11px] font-medium ${isDark ? 'text-white/62' : 'text-neutral-600'}`}>{activePreset.label}</div>
                    </div>
                    <div className={`grid h-9 w-9 place-items-center rounded-2xl border text-[13px] font-black ${isDark ? 'border-white/10 bg-white/6 text-emerald-200 shadow-[0_0_40px_rgba(16,185,129,0.12)]' : 'border-black/8 bg-white text-neutral-950 shadow-sm'}`}>
                        F
                    </div>
                </div>
                <div className="mt-3 flex gap-1.5">
                    {presets.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setChosenRole(item.id)}
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                                chosenRole === item.id
                                    ? isDark ? 'border-emerald-300/40 bg-emerald-300/12 text-emerald-100' : 'border-neutral-900 bg-neutral-950 text-white'
                                    : isDark
                                        ? 'border-white/10 bg-white/[0.03] text-white/42 hover:border-white/18 hover:text-white/78'
                                        : 'border-neutral-200 bg-white/70 text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'
                            }`}
                            title={item.note}
                        >
                            {item.short}
                        </button>
                    ))}
                </div>
                <div className={`mt-2 text-[10px] leading-relaxed ${isDark ? 'text-white/42' : 'text-neutral-500'}`}>{activePreset.note}</div>
            </div>

            <div className={`border-b px-3 py-3 ${isDark ? 'border-white/8 bg-white/[0.02]' : 'border-black/8 bg-white/35'}`}>
                <div className={`mb-2 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.18em] ${isDark ? 'text-white/36' : 'text-neutral-400'}`}>
                    <span>Control Surface</span>
                    <span>MCP + CLI</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {opsCards.map(card => (
                        <div
                            key={card.id}
                            className={`group rounded-2xl border p-2.5 transition ${isDark ? 'border-white/10 bg-white/[0.035] hover:border-white/18' : 'border-neutral-200 bg-white/80 shadow-sm hover:border-neutral-300'} `}
                        >
                            <div className={`mb-2 h-10 rounded-xl bg-gradient-to-br ${card.tone} ${isDark ? 'ring-1 ring-white/8' : 'ring-1 ring-black/5'}`} />
                            <div className={`text-[11px] font-semibold tracking-[-0.01em] ${isDark ? 'text-white/92' : 'text-neutral-950'}`}>{card.title}</div>
                            <div className={`mt-1 rounded-lg px-1.5 py-1 font-mono text-[9px] ${isDark ? 'bg-black/24 text-emerald-100/76' : 'bg-neutral-100 text-neutral-700'}`}>{card.command}</div>
                            <div className={`mt-1.5 line-clamp-2 text-[9px] leading-relaxed ${isDark ? 'text-white/38' : 'text-neutral-500'}`}>{card.note}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className={`border-b px-3 py-3 ${isDark ? 'border-white/8 bg-black/8' : 'border-black/8 bg-white/55'}`}>
                <div className={`mb-2 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.16em] ${isDark ? 'text-white/36' : 'text-neutral-400'}`}>
                    <span>{copy.taskMatrix}</span>
                    <span>{runningJobs.length} {copy.active}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div className={`rounded-2xl border px-2.5 py-2 ${isDark ? 'border-white/10 bg-white/[0.035]' : 'border-neutral-200 bg-white shadow-sm'}`}>
                        <div className={`text-[8px] uppercase tracking-[0.14em] ${isDark ? 'text-white/34' : 'text-neutral-400'}`}>{copy.running}</div>
                        <div className={`mt-1 text-[15px] font-semibold ${isDark ? 'text-white' : 'text-neutral-950'}`}>{runningJobs.length}</div>
                    </div>
                    <div className={`rounded-2xl border px-2.5 py-2 ${isDark ? 'border-white/10 bg-white/[0.035]' : 'border-neutral-200 bg-white shadow-sm'}`}>
                        <div className={`text-[8px] uppercase tracking-[0.14em] ${isDark ? 'text-white/34' : 'text-neutral-400'}`}>{copy.latest}</div>
                        <div className={`mt-1 truncate text-[11px] font-semibold ${isDark ? 'text-white/78' : 'text-neutral-800'}`}>{runtimeStage?.trim() || 'idle'}</div>
                    </div>
                    <div className={`rounded-2xl border px-2.5 py-2 ${isDark ? 'border-white/10 bg-white/[0.035]' : 'border-neutral-200 bg-white shadow-sm'}`}>
                        <div className={`text-[8px] uppercase tracking-[0.14em] ${isDark ? 'text-white/34' : 'text-neutral-400'}`}>{copy.queue}</div>
                        <div className={`mt-1 text-[15px] font-semibold ${isDark ? 'text-white' : 'text-neutral-950'}`}>{runtimeJobs.length}</div>
                    </div>
                </div>
                <div className="mt-1.5 grid gap-1">
                    {recentJobs.length === 0 ? (
                        <div className={`rounded-[4px] border px-2 py-1.5 text-[10px] ${isDark ? 'border-[#202734] bg-[#121822] text-[#667085]' : 'border-neutral-200 bg-white text-neutral-500'}`}>
                            {copy.noJobs}
                        </div>
                    ) : recentJobs.map(job => {
                        const progress = Math.max(0, Math.min(100, job.progress?.pct || 0));
                        const isRunningJob = job.status === 'running' || job.status === 'accepted';
                        const statusTone = job.status === 'failed'
                            ? 'text-rose-400'
                            : job.status === 'succeeded'
                                ? 'text-[#00ff88]'
                                : 'text-amber-400';

                        return (
                            <div
                                key={job.jobId}
                                className={`rounded-[4px] border px-2 py-1.5 ${isDark ? 'border-[#202734] bg-[#121822]' : 'border-neutral-200 bg-white'}`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className={`rounded-[2px] border px-1 py-0.5 text-[8px] font-bold tracking-[0.12em] ${isDark ? 'border-[#2A3140] bg-[#0d1117] text-[#98A2B3]' : 'border-neutral-200 bg-neutral-50 text-neutral-500'}`}>{formatJobCommand(job.command)}</span>
                                        <span className={`truncate text-[10px] ${isDark ? 'text-[#D0D5DD]' : 'text-neutral-800'}`}>{job.progress.stage || job.command}</span>
                                    </div>
                                    <span className={`text-[9px] font-bold uppercase tracking-[0.12em] ${statusTone}`}>{job.status}</span>
                                </div>
                                <div className={`mt-1 h-[2px] overflow-hidden rounded-full ${isDark ? 'bg-[#1B2029]' : 'bg-neutral-100'}`}>
                                    <div
                                        className={`h-full rounded-full ${job.status === 'failed' ? 'bg-rose-500' : isRunningJob ? 'bg-[#00ff88]' : 'bg-[#94a3b8]'}`}
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className={`border-b px-2.5 py-2 ${isDark ? 'border-[#202734] bg-[#0f141c]' : 'border-neutral-200 bg-neutral-50/50'}`}>
                <div className={`mb-1 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.16em] ${isDark ? 'text-[#667085]' : 'text-neutral-500'}`}>
                    <span>{copy.snapshots}</span>
                    <span>{generationHistory.length}</span>
                </div>
                <div className="grid gap-1">
                    {recentHistory.length === 0 ? (
                        <div className={`rounded-[4px] border px-2 py-1.5 text-[10px] ${isDark ? 'border-[#202734] bg-[#121822] text-[#667085]' : 'border-neutral-200 bg-white text-neutral-500'}`}>
                            {copy.noHistory}
                        </div>
                    ) : recentHistory.map(item => (
                        <div
                            key={item.id}
                            className={`flex items-center gap-2 rounded-[4px] border px-2 py-1.5 ${isDark ? 'border-[#202734] bg-[#121822]' : 'border-neutral-200 bg-white'}`}
                        >
                            <div className={`h-8 w-8 shrink-0 overflow-hidden rounded-[2px] ${isDark ? 'bg-[#0b0f15]' : 'bg-neutral-100'}`}>
                                <img src={item.dataUrl} alt={item.name || item.prompt} className="h-full w-full object-cover" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className={`truncate text-[10px] font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-neutral-800'}`}>{item.name || item.prompt}</div>
                                <div className={`mt-0.5 text-[9px] ${isDark ? 'text-[#667085]' : 'text-neutral-500'}`}>{item.width}x{item.height}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-2 select-text">
                {logs.map(log => {
                    const isUser = log.sender === 'user';
                    const isError = log.status === 'error';
                    return (
                        <div key={log.id} className={`flex max-w-[94%] flex-col gap-1 ${isUser ? 'self-end items-end' : 'self-start items-start'}`}>
                            <div className={`flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.14em] ${isDark ? 'text-[#667085]' : 'text-neutral-500'}`}>
                                <span className={isUser ? '' : isError ? 'text-rose-400' : 'text-amber-400/80'}>[{log.role}]</span>
                                <span>{log.time}</span>
                            </div>
                            <div className={`rounded-[4px] border px-2 py-1.5 leading-relaxed ${
                                isUser
                                    ? isDark
                                        ? 'border-[#2A3140] bg-[#171c25] text-[#D0D5DD]'
                                        : 'border-neutral-200 bg-neutral-50 text-neutral-800'
                                    : isError
                                        ? 'border-rose-500/30 bg-rose-500/8 text-rose-200'
                                        : isDark
                                            ? 'border-[#202734] bg-[#121822] text-[#F3F4F6]'
                                            : 'border-neutral-200 bg-white text-neutral-800'
                            }`}>
                                {log.text}
                            </div>
                        </div>
                    );
                })}
                <div ref={endRef} />
            </div>

            <div className={`border-t px-2.5 py-2 ${isDark ? 'border-[#202734] bg-black/10' : 'border-neutral-200 bg-neutral-50/80'}`}>
                <div className={`flex items-center gap-1.5 rounded-[4px] border px-1.5 py-1.5 ${isDark ? 'border-[#2A3140] bg-[#0d1117]' : 'border-neutral-200 bg-white'}`}>
                    <input
                        type="text"
                        className={`min-w-0 flex-1 border-0 bg-transparent font-sans text-xs outline-none ${isDark ? 'text-[#E5E7EB] placeholder:text-[#475467]' : 'text-neutral-800 placeholder:text-neutral-400'}`}
                        placeholder={copy.inputPlaceholder(activePreset.short)}
                        value={typedText}
                        disabled={isRunning}
                        onChange={(event) => setTypedText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void handleCommitStream();
                            }
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => void handleCommitStream()}
                        disabled={!typedText.trim() || isRunning}
                        className={`rounded-[3px] border px-2 py-0.5 text-[10px] font-bold transition ${isDark ? 'border-[#3A4458] text-[#98A2B3] hover:border-[#667085]' : 'border-neutral-300 text-neutral-600 hover:border-neutral-400'} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                        {isRunning ? copy.run : copy.exec}
                    </button>
                </div>
                <div className={`mt-1 text-right text-[8px] tracking-[0.12em] ${isDark ? 'text-[#475467]' : 'text-neutral-400'}`}>
                    {copy.online}
                </div>
            </div>
        </div>
    );
};

export default AgentChatPanel;
