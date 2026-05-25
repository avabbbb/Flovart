import React, { useEffect, useMemo, useState } from 'react';
import { QUICK_COMMANDS, SETUP_TEXT } from '../tools/flovart/core.js';

interface AgentBridgePanelProps {
    theme: 'light' | 'dark';
    compactMode: boolean;
}

const getRuntimeApi = () => (window as any).__flovartAPI;

const setupCommands = [
    'npm run flovart:cli -- doctor --json',
    'npm run flovart:cli -- init --host opencode',
    'npm run flovart:cli -- batch.plan --prompt "product launch" --count 4 --json',
];

const capabilityCards = [
    { title: 'Runtime', body: 'Inspect canvas, media, provider readiness, and active jobs.', command: 'flovart.status' },
    { title: 'Setup', body: 'Write host-specific MCP config for OpenCode, Claude, Cursor, Roo, Windsurf, or VS Code.', command: 'flovart.init_host' },
    { title: 'Creative Ops', body: 'Search inspiration, enhance prompts, and plan multi-shot batches locally.', command: 'flovart.plan_batch' },
    { title: 'Canvas', body: 'Create, update, select, generate, and watch image/video elements.', command: 'flovart.command_execute' },
];

export const AgentBridgePanel: React.FC<AgentBridgePanelProps> = ({ theme, compactMode }) => {
    const isDark = theme === 'dark';
    const [runtimeReady, setRuntimeReady] = useState(() => !!getRuntimeApi());
    const [status, setStatus] = useState<any>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const shell = isDark
        ? 'border-white/8 bg-[radial-gradient(circle_at_18%_0%,rgba(16,185,129,0.12),transparent_30%),linear-gradient(180deg,#10141b_0%,#0a0d12_100%)] text-white'
        : 'border-neutral-200 bg-[linear-gradient(180deg,#fbfaf7_0%,#f5f1e8_52%,#ffffff_100%)] text-neutral-950';
    const card = isDark
        ? 'border-white/10 bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
        : 'border-neutral-200 bg-white/78 shadow-sm';
    const muted = isDark ? 'text-white/42' : 'text-neutral-500';
    const strong = isDark ? 'text-white' : 'text-neutral-950';
    const panelClass = `flex h-full min-h-0 flex-col overflow-y-auto ${compactMode ? 'gap-3 p-3' : 'gap-4 p-4'} ${shell}`;

    useEffect(() => {
        const refresh = () => {
            const api = getRuntimeApi();
            setRuntimeReady(!!api);
            try {
                setStatus(api?.status?.() || null);
            } catch {
                setStatus(null);
            }
        };
        refresh();
        window.addEventListener('flovart:api-ready', refresh);
        const timer = window.setInterval(refresh, 3000);
        return () => {
            window.removeEventListener('flovart:api-ready', refresh);
            window.clearInterval(timer);
        };
    }, []);

    const provider = status?.provider;
    const statusPill = useMemo(() => runtimeReady
        ? isDark ? 'bg-emerald-300/12 text-emerald-100 ring-emerald-300/20' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
        : isDark ? 'bg-amber-300/12 text-amber-100 ring-amber-300/20' : 'bg-amber-50 text-amber-700 ring-amber-200', [runtimeReady, isDark]);

    const copyText = async (id: string, text: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(id);
        window.setTimeout(() => setCopied(null), 1200);
    };

    return (
        <div className={panelClass}>
            <section className={`overflow-hidden rounded-[28px] border ${card}`}>
                <div className="relative p-4">
                    <div className={`absolute right-3 top-3 h-16 w-16 rounded-full blur-2xl ${isDark ? 'bg-emerald-300/20' : 'bg-amber-200/70'}`} />
                    <div className={`text-[10px] font-bold uppercase tracking-[0.24em] ${muted}`}>Flovart Agent Bridge</div>
                    <div className="mt-2 flex items-start justify-between gap-3">
                        <div>
                            <h3 className={`text-xl font-semibold tracking-[-0.04em] ${strong}`}>Canvas ops for coding agents</h3>
                            <p className={`mt-2 max-w-[24rem] text-[11px] leading-relaxed ${muted}`}>
                                A deterministic MCP and CLI control surface for OpenCode, Claude Code, Codex, Cursor, Roo, Windsurf, and VS Code. Secrets stay in the browser UI.
                            </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${statusPill}`}>
                            {runtimeReady ? 'runtime online' : 'shadow mode'}
                        </span>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-3 gap-2">
                {(['image', 'video', 'text'] as const).map(kind => (
                    <div key={kind} className={`rounded-2xl border p-3 ${card}`}>
                        <div className={`text-[9px] font-bold uppercase tracking-[0.18em] ${muted}`}>{kind}</div>
                        <div className={`mt-1 text-[12px] font-semibold ${provider?.configured?.[kind] ? 'text-emerald-400' : isDark ? 'text-amber-200' : 'text-amber-700'}`}>
                            {provider?.configured?.[kind] ? 'ready' : 'setup'}
                        </div>
                    </div>
                ))}
            </section>

            <section className={`rounded-[24px] border p-3 ${card}`}>
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h4 className={`text-sm font-semibold tracking-[-0.02em] ${strong}`}>Runtime snapshot</h4>
                        <p className={`mt-1 text-[10px] ${muted}`}>Live when CDP is connected, safe shadow fallback otherwise.</p>
                    </div>
                    <div className={`rounded-2xl px-3 py-2 text-right ${isDark ? 'bg-black/20' : 'bg-neutral-100'}`}>
                        <div className={`text-[9px] uppercase tracking-[0.16em] ${muted}`}>jobs</div>
                        <div className={`text-base font-semibold ${strong}`}>{status?.jobs ?? 0}</div>
                    </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className={`rounded-2xl border p-2.5 ${isDark ? 'border-white/8 bg-black/16' : 'border-neutral-200 bg-white'}`}>
                        <div className={muted}>Media elements</div>
                        <div className={`mt-1 font-semibold ${strong}`}>{status?.mediaElements ?? 0}</div>
                    </div>
                    <div className={`rounded-2xl border p-2.5 ${isDark ? 'border-white/8 bg-black/16' : 'border-neutral-200 bg-white'}`}>
                        <div className={muted}>Selected models</div>
                        <div className={`mt-1 truncate font-semibold ${strong}`}>{provider?.selectedModels?.image || 'browser default'}</div>
                    </div>
                </div>
            </section>

            <section className="grid gap-2">
                {capabilityCards.map(item => (
                    <div key={item.command} className={`rounded-[22px] border p-3 ${card}`}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h4 className={`text-[12px] font-semibold ${strong}`}>{item.title}</h4>
                                <p className={`mt-1 text-[10px] leading-relaxed ${muted}`}>{item.body}</p>
                            </div>
                            <code className={`shrink-0 rounded-full px-2 py-1 text-[9px] ${isDark ? 'bg-black/24 text-emerald-100/80' : 'bg-neutral-100 text-neutral-700'}`}>{item.command}</code>
                        </div>
                    </div>
                ))}
            </section>

            <section className={`rounded-[24px] border p-3 ${isDark ? 'border-white/10 bg-black/32' : 'border-neutral-900 bg-neutral-950 text-white'}`}>
                <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold tracking-[-0.02em]">Command shelf</h4>
                    <button type="button" onClick={() => copyText('setup', SETUP_TEXT)} className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/70 hover:bg-white/15 hover:text-white">
                        {copied === 'setup' ? 'copied' : 'copy setup'}
                    </button>
                </div>
                <div className="mt-3 grid gap-2">
                    {setupCommands.map((command, index) => (
                        <button
                            key={command}
                            type="button"
                            onClick={() => copyText(`cmd-${index}`, command)}
                            className="group flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left font-mono text-[10px] text-white/68 transition hover:border-white/18 hover:bg-white/[0.07]"
                        >
                            <span className="truncate">{command}</span>
                            <span className="shrink-0 text-white/35 group-hover:text-white/70">{copied === `cmd-${index}` ? 'copied' : 'copy'}</span>
                        </button>
                    ))}
                </div>
            </section>

            <section className={`rounded-[24px] border p-3 ${card}`}>
                <h4 className={`text-sm font-semibold tracking-[-0.02em] ${strong}`}>Quick commands</h4>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {QUICK_COMMANDS.map(command => (
                        <span key={command} className={`rounded-full border px-2.5 py-1 text-[10px] ${isDark ? 'border-white/10 bg-white/[0.03] text-white/45' : 'border-neutral-200 bg-white text-neutral-500'}`}>
                            {command}
                        </span>
                    ))}
                </div>
            </section>
        </div>
    );
};

export default AgentBridgePanel;
