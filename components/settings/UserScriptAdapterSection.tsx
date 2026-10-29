import React from 'react';
import {
    buildUserScriptAuthoringBrief,
    getStoredUserScriptProvider,
    parseUserScriptDefinition,
    saveUserScriptProvider,
} from '../../services/userScriptAuthoring';

interface UserScriptAdapterSectionProps {
    /** 当前 Key 绑定的适配脚本 id（extraConfig.providerScriptId） */
    scriptId?: string;
    modelName?: string;
    t: (key: string, ...args: unknown[]) => string;
    onBind: (scriptId: string | undefined) => void;
}

/**
 * 付 Infinite Canvas 的三步引导：看懂规则 → 复制说明让外部 Agent 写 → 粘贴保存。
 * 与对方不同，脚本是受限 JSON mapping（不执行任意 JS），保存前由 UserScriptProviderAdapter 校验。
 */
export function UserScriptAdapterSection({ scriptId, modelName, t, onBind }: UserScriptAdapterSectionProps) {
    const copy = (name: string, ...args: unknown[]) => t('settingsExtra.keyDialog.scriptAdapter.' + name, ...args);
    const [draft, setDraft] = React.useState(() => {
        const stored = getStoredUserScriptProvider(scriptId);
        return stored ? JSON.stringify(stored, null, 2) : '';
    });
    const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);

    const handleCopyBrief = async () => {
        const brief = buildUserScriptAuthoringBrief({ modelName, draft });
        try {
            await navigator.clipboard.writeText(brief);
            setStatus({ ok: true, text: copy('briefCopied') });
        } catch (error) {
            setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) });
        }
    };

    const handleSave = () => {
        try {
            const definition = parseUserScriptDefinition(draft);
            saveUserScriptProvider(definition);
            onBind(definition.id);
            setStatus({ ok: true, text: copy('saved', definition.id) });
        } catch (error) {
            setStatus({ ok: false, text: copy('invalid', error instanceof Error ? error.message : String(error)) });
        }
    };

    const handleUnbind = () => {
        onBind(undefined);
        setStatus(null);
    };

    const stepClass = 'rounded-xl bg-[var(--isl-card)] px-3 py-2';
    return (
        <section className="rounded-2xl border-[1.5px] border-[var(--isl-border)] bg-[var(--isl-surface-2)] p-3 space-y-2" data-testid="user-script-adapter">
            <div>
                <div className="text-sm font-bold text-[var(--isl-ink)]">{copy('title')}</div>
                <div className="mt-0.5 text-[11px] text-[var(--isl-ink-soft)]">{copy('description')}</div>
            </div>
            <div className="grid gap-2 text-[11px] leading-5 text-[var(--isl-ink-soft)]">
                <div className={stepClass}>
                    <div className="font-bold text-[var(--isl-ink)]">{copy('stepRule')}</div>
                    <div>{copy('stepRuleHint')}</div>
                </div>
                <div className={stepClass}>
                    <div className="font-bold text-[var(--isl-ink)]">{copy('stepAi')}</div>
                    <div>{copy('stepAiHint')}</div>
                    <div className="opacity-80">{copy('stepAiIncludes')}</div>
                    <button type="button" onClick={() => { void handleCopyBrief(); }} className="isl-chip isl-chip--active mt-2 px-3 py-1.5 text-xs">
                        {copy('copyBrief')}
                    </button>
                </div>
                <div className={stepClass}>
                    <div className="font-bold text-[var(--isl-ink)]">{copy('stepPaste')}</div>
                    <div>{copy('stepPasteHint')}</div>
                </div>
            </div>
            <textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => event.stopPropagation()}
                onKeyUp={event => event.stopPropagation()}
                placeholder={copy('placeholder')}
                spellCheck={false}
                rows={8}
                aria-label={copy('title')}
                className="isl-well w-full px-3 py-2 font-mono text-xs text-[var(--isl-ink)] outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={handleSave} disabled={!draft.trim()} className="isl-chip isl-chip--active px-3 py-1.5 text-xs disabled:opacity-50">
                    {copy('save')}
                </button>
                {scriptId && (
                    <button type="button" onClick={handleUnbind} className="isl-chip px-3 py-1.5 text-xs">
                        {copy('remove')}
                    </button>
                )}
                <span className="text-[11px] text-[var(--isl-ink-soft)]">{scriptId ? copy('bound', scriptId) : copy('none')}</span>
            </div>
            {status && (
                <div role="status" className={'rounded-xl px-3 py-2 text-[11px] ' + (status.ok ? 'text-[var(--isl-ink)]' : 'text-[#D92D20]')}>
                    {status.text}
                </div>
            )}
        </section>
    );
}
