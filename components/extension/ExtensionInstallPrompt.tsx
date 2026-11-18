import React from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getExtensionBridge } from '../../services/extensionBridge';
import { canUseExtensionDirect } from '../../services/extensionDirectFetch';
import {
    decideExtensionPrompt,
    extensionInstallUrl,
    getExtensionPromptStore,
} from '../../services/extensionInstallPrompt';

interface ExtensionInstallPromptProps {
    isDark: boolean;
    t: (key: string, ...args: unknown[]) => string;
}

function cx(...parts: string[]): string {
    return parts.filter(Boolean).join(' ');
}

/**
 * 非阻塞的插件引导：需要经代理访问网关（或代理被限流）且插件未安装/未配对时出现在左下角。
 * 可关闭（本次会话）或「不再提醒」；请求始终照常经代理回退，不受影响。
 */
export function ExtensionInstallPrompt({ isDark, t }: ExtensionInstallPromptProps) {
    const copy = (name: string) => t('settingsExtra.extension.prompt.' + name);
    const bridge = getExtensionBridge();
    const store = getExtensionPromptStore();
    const bridgeState = React.useSyncExternalStore(bridge.subscribe, bridge.getState);
    const promptState = React.useSyncExternalStore(store.subscribe, store.getState);
    const desktop = React.useMemo(() => {
        try {
            return isTauri();
        } catch {
            return false;
        }
    }, []);

    const decision = decideExtensionPrompt({
        reason: promptState.reason,
        status: bridgeState.status,
        capable: canUseExtensionDirect(bridge),
        dismissedForever: promptState.dismissedForever,
        dismissedThisSession: promptState.dismissedThisSession,
        isDesktop: desktop,
    });
    if (!decision.show || !decision.action || !promptState.reason) return null;

    const primaryClass = 'rounded-xl bg-[#168f82] px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110';
    const ghostClass = cx(
        'rounded-xl px-2.5 py-1.5 text-xs transition',
        isDark ? 'text-[#98A2B3] hover:bg-[#1B2029]' : 'text-[#667085] hover:bg-[#F2F4F7]',
    );
    const openInstall = () => window.open(extensionInstallUrl(), '_blank', 'noopener,noreferrer');

    return (
        <div
            role="status"
            aria-live="polite"
            data-testid="extension-install-prompt"
            className={cx(
                'fixed bottom-5 left-5 z-50 w-[340px] max-w-[calc(100vw-2.5rem)] rounded-2xl border p-4 shadow-lg',
                isDark ? 'border-[#2A3140] bg-[#161A22] text-[#D0D5DD]' : 'border-[#E4E7EC] bg-white text-[#344054]',
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium">{copy('title')}</div>
                <button type="button" aria-label={copy('later')} className={ghostClass} onClick={() => store.dismiss(false)}>×</button>
            </div>
            <p className={cx('mt-1.5 text-xs leading-5', isDark ? 'text-[#98A2B3]' : 'text-[#667085]')}>
                {copy(promptState.reason)} {copy('fallback')}
            </p>
            {decision.action === 'approve' && <p className="mt-2 text-xs">{copy('approve')}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {decision.action === 'install' && <>
                    <button type="button" className={primaryClass} onClick={openInstall}>{copy('install')}</button>
                    <button type="button" className={ghostClass} onClick={() => void bridge.connect()}>{copy('recheck')}</button>
                </>}
                {decision.action === 'pair' && (
                    <button type="button" className={primaryClass} onClick={() => void bridge.connect({ requestPairing: true })}>{copy('pair')}</button>
                )}
                {decision.action === 'update' && (
                    <button type="button" className={primaryClass} onClick={openInstall}>{copy('update')}</button>
                )}
                <span className="flex-1" />
                <button type="button" className={ghostClass} onClick={() => store.dismiss(true)}>{copy('never')}</button>
            </div>
        </div>
    );
}
