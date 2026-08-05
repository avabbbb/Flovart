import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '../components/SettingsPanel';

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
        t={(key) => key}
        clearKeysOnExit={false}
        setClearKeysOnExit={() => undefined}
    />,
);

describe('SettingsPanel runtime credential selection', () => {
    beforeEach(() => {
        runtimeExecute.mockReset();
        runtimeExecute.mockResolvedValue({ providers: [multiCredentialStatus] });
    });

    it('shows a per-provider credential selector when multiple Runtime credentials exist', async () => {
        renderSettings();
        await waitFor(() => expect(runtimeExecute).toHaveBeenCalledWith(expect.objectContaining({ command: 'provider.status' })));
        const select = await screen.findByLabelText('RunningHub Runtime 凭证选择') as HTMLSelectElement;
        expect(Array.from(select.options).map(option => option.textContent)).toEqual(['生产账号', '测试账号']);
        expect(screen.getByText('2 个安全凭证可供 Production Runtime 使用')).toBeInTheDocument();
    });

    it('lets the designer pick one Runtime credential before one-click import into the canvas API config', async () => {
        const onAddApiKey = vi.fn();
        renderSettings(onAddApiKey);
        await waitFor(() => expect(runtimeExecute).toHaveBeenCalled());
        const select = await screen.findByLabelText('RunningHub Runtime 凭证选择');
        fireEvent.change(select, { target: { value: 'cred-b' } });
        fireEvent.click(screen.getByRole('button', { name: '一键导入到 API 配置' }));

        expect(onAddApiKey).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'runningHub',
            key: 'runtime:cred-b',
            runtimeManaged: { credentialId: 'cred-b' },
            name: 'RunningHub（Runtime 托管）',
        }));
    });

    it('keeps the import button disabled once the selected credential is already imported', async () => {
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
                t={(key) => key}
                clearKeysOnExit={false}
                setClearKeysOnExit={() => undefined}
            />,
        );
        await waitFor(() => expect(runtimeExecute).toHaveBeenCalled());
        const select = await screen.findByLabelText('RunningHub Runtime 凭证选择');
        fireEvent.change(select, { target: { value: 'cred-b' } });
        expect(screen.getByRole('button', { name: '已导入 API 配置' })).toBeDisabled();
    });
});
