import React from 'react';
import { getExtensionBridge, type ExtensionBridgeStatus } from '../../services/extensionBridge';

interface ExtensionPairingSectionProps {
    isDark: boolean;
    t: (key: string, ...args: unknown[]) => string;
}

type StatusTone = 'ok' | 'wait' | 'warn' | 'idle';

const STATUS_TONE: Record<ExtensionBridgeStatus, StatusTone> = {
    unconfigured: 'idle',
    'not-installed': 'warn',
    idle: 'idle',
    connecting: 'wait',
    none: 'idle',
    pending: 'wait',
    approved: 'ok',
    rejected: 'warn',
    revoked: 'warn',
    disconnected: 'warn',
    unsupported: 'warn',
};

const DOT_CLASS: Record<StatusTone, string> = {
    ok: 'bg-emerald-500',
    wait: 'bg-amber-400',
    warn: 'bg-rose-500',
    idle: 'bg-[#98A2B3]',
};

function cx(...parts: string[]): string {
    return parts.filter(Boolean).join(' ');
}

/**
 * 网页画布与 Flovart 浏览器插件的配对入口。批准与撤销只在插件 popup 中完成，
 * 这里只负责发起配对、展示状态和主动断开，避免网页单方面自批准。
 */
export function ExtensionPairingSection({ isDark, t }: ExtensionPairingSectionProps) {
    const copy = (name: string, ...args: unknown[]) => t('settingsExtra.extension.' + name, ...args);
    const bridge = getExtensionBridge();
    const state = React.useSyncExternalStore(bridge.subscribe, bridge.getState);
    const { status } = state;

    // 打开设置时静默探测一次（不发起配对），已批准的画布会直接恢复连接。
    React.useEffect(() => {
        if (bridge.getState().status === 'idle') void bridge.connect();
    }, [bridge]);

    const connected = status === 'approved' || status === 'pending' || status === 'none';
    const canPair = status === 'none' || status === 'rejected' || status === 'revoked' || status === 'disconnected' || status === 'idle';
    const canRetry = status === 'not-installed';
    const inkClass = isDark ? 'text-[#D0D5DD]' : 'text-[#344054]';
    const softClass = isDark ? 'text-[#667085]' : 'text-[#98A2B3]';
    const buttonClass = cx(
        'rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
        isDark ? 'border-[#2A3140] text-[#D0D5DD] hover:bg-[#1B2029]' : 'border-[#E4E7EC] text-[#344054] hover:bg-white',
    );

    return (
        <div className={cx('rounded-2xl p-4', isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]')}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className={cx('text-sm font-medium', inkClass)}>{copy('title')}</div>
                    <div className={cx('mt-1 text-xs', softClass)}>{copy('details')}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                    {canPair && (
                        <button type="button" className={buttonClass} onClick={() => void bridge.connect({ requestPairing: true })}>
                            {copy('pair')}
                        </button>
                    )}
                    {canRetry && (
                        <button type="button" className={buttonClass} onClick={() => void bridge.connect()}>
                            {copy('retry')}
                        </button>
                    )}
                    {connected && (
                        <button type="button" className={buttonClass} onClick={() => bridge.disconnect()}>
                            {copy('disconnect')}
                        </button>
                    )}
                </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs" aria-live="polite">
                <span className={cx('inline-block h-2 w-2 rounded-full', DOT_CLASS[STATUS_TONE[status]])} aria-hidden="true" />
                <span className={inkClass}>{copy('status.' + status)}</span>
                {state.extensionVersion && (
                    <span className={softClass}>· {copy('version', state.extensionVersion)}</span>
                )}
            </div>
        </div>
    );
}
