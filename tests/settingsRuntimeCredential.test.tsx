import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '../components/SettingsPanel';
import { translations } from '../utils/translations';

const { runtimeExecute } = vi.hoisted(() => ({ runtimeExecute: vi.fn() }));

vi.mock('../services/flovartRuntime', () => ({
    getFlovartRuntimeApi: () => ({ execute: runtimeExecute }),
}));

const multiCredentialStatus = {
    provider: 'runningHub',
    ready: true,
    capabilities: ['image', 'video'],
    credentials: [
        { label: '生产账号', available: true, credentialId: 'cred-a' },
        { label: '测试账号', available: true, credentialId: 'cred-b' },
    ],
    routes: [
        { productModel: 'flovart:gpt-image-2', routeId: 'rhart-image-g-2/text-to-image' },
    ],
};

const zhT = (key: string, ...args: unknown[]): string => {
    const value = key.split('.').reduce<unknown>((current, part) => {
        if (!current || typeof current !== 'object' || !(part in current)) return undefined;
        return (current as Record<string, unknown>)[part];
    }, translations.zho as unknown);
    return String(typeof value === 'function' ? value(...args) : (value ?? key));
};

const renderSettings = (onAddApiKey: (payload: unknown) => void = () => undefined) => render(
    <SettingsPanel
        isOpen
        onClose={() => undefined}
        resolvedTheme="dark"
        userApiKeys={[]}
        onAddApiKey={onAddApiKey as never}
        onDeleteApiKey={() => undefined}
        onUpdateApiKey={() => undefined}
        onSetDefaultApiKey={() => undefined}
        t={zhT}
        clearKeysOnExit={false}
        setClearKeysOnExit={() => undefined}
    />,
);

describe('SettingsPanel runtime credential selection', () => {
    beforeEach(() => {
        runtimeExecute.mockReset();
        runtimeExecute.mockResolvedValue({ providers: [multiCredentialStatus] });
    });

    it('shows Runtime route metadata without exposing a browser credential selector', async () => {
        renderSettings();
        await waitFor(() => expect(runtimeExecute).toHaveBeenCalledWith(expect.objectContaining({ command: 'provider.status' })));
        expect(await screen.findByText('可用凭证：生产账号、测试账号')).toBeInTheDocument();
        expect(screen.getByText('2 个安全凭证可供 Production Runtime 使用')).toBeInTheDocument();
        expect(screen.queryByLabelText('RunningHub Runtime 凭证选择')).toBeNull();
        expect(screen.queryByRole('button', { name: /导入到 API 配置/ })).toBeNull();
    });

    it('keeps Runtime credentials in the Runtime boundary instead of synthesizing a browser API key', async () => {
        const onAddApiKey = vi.fn();
        renderSettings(onAddApiKey);
        await waitFor(() => expect(runtimeExecute).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: '一键导入到 API 配置' })).toBeNull();
        expect(onAddApiKey).not.toHaveBeenCalled();
    });

    it('does not offer a Runtime import action even when an old managed entry exists', async () => {
        const imported: Array<Record<string, unknown>> = [{
            id: 'imported-key',
            provider: 'runningHub',
            capabilities: ['image'],
            key: 'runtime:cred-b',
            name: 'RunningHub（Runtime 托管）',
            runtimeManaged: { credentialId: 'cred-b' },
            createdAt: 1,
            updatedAt: 1,
        }];
        render(
            <SettingsPanel
                isOpen
                onClose={() => undefined}
                resolvedTheme="dark"
                userApiKeys={imported as never}
                onAddApiKey={() => undefined}
                onDeleteApiKey={() => undefined}
                onUpdateApiKey={() => undefined}
                onSetDefaultApiKey={() => undefined}
                t={zhT}
                clearKeysOnExit={false}
                setClearKeysOnExit={() => undefined}
            />,
        );
        await waitFor(() => expect(runtimeExecute).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: /一键导入|已导入 API 配置/ })).toBeNull();
    });
});
