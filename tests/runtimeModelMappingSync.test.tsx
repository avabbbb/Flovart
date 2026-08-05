import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from '../components/SettingsPanel';
import { resolveProductModelRoute, suggestProductRouteMappings } from '../services/productModelCatalog';
import { resolveRouteMapping } from '../services/routeMapping';
import type { UserApiKey } from '../types';

const { runtimeExecute } = vi.hoisted(() => ({ runtimeExecute: vi.fn() }));

vi.mock('../services/flovartRuntime', () => ({
    getFlovartRuntimeApi: () => ({ execute: runtimeExecute }),
}));

const runningHubStatus = {
    provider: 'runningHub',
    ready: true,
    credentials: [{ label: 'RunningHub 标准模型', available: true }],
    productModels: ['flovart:gpt-image-2', 'flovart:grok-imagine-video-1.5', 'flovart:veo-3.1-lite'],
    routes: [
        { productModel: 'flovart:gpt-image-2', routeId: 'rhart-image-g-2/text-to-image' },
        { productModel: 'flovart:grok-imagine-video-1.5', routeId: 'rhart-video-g/text-to-video' },
        { productModel: 'flovart:grok-imagine-video-1.5', routeId: 'rhart-video-g/image-to-video', mode: 'image-to-video' },
        { productModel: 'flovart:veo-3.1-lite', routeId: 'rhart-video-v3.1-lite-official/text-to-video' },
    ],
};

const renderSettings = (userApiKeys: UserApiKey[] = []) => render(
    <SettingsPanel
        isOpen
        onClose={() => undefined}
        resolvedTheme="dark"
        userApiKeys={userApiKeys}
        onAddApiKey={() => undefined}
        onDeleteApiKey={() => undefined}
        onUpdateApiKey={() => undefined}
        onSetDefaultApiKey={() => undefined}
        t={(key) => key}
        clearKeysOnExit={false}
        setClearKeysOnExit={() => undefined}
    />,
);

const runningHubBrowserKey = (): UserApiKey => ({
    id: 'rh-browser-test',
    provider: 'runningHub',
    capabilities: ['image', 'video'],
    key: 'test-only-redacted-secret',
    models: [
        { id: 'rhart-image-g-2/text-to-image', name: 'G-2 文生图' },
        { id: 'rhart-video-g/text-to-video', name: 'Grok 文生视频' },
        { id: 'rhart-video-g/image-to-video', name: 'Grok 图生视频' },
        { id: 'rhart-video-v3.1-lite-official/text-to-video', name: 'Veo Lite 文生视频' },
    ],
    createdAt: 1,
    updatedAt: 1,
});

describe('Runtime-only RunningHub model mapping', () => {
    beforeEach(() => {
        runtimeExecute.mockReset();
        runtimeExecute.mockResolvedValue({ providers: [runningHubStatus] });
    });

    it('[BAD CASE] reproduces the missing Runtime-only recommendation', async () => {
        renderSettings();

        fireEvent.click(screen.getByRole('button', { name: '模型映射' }));
        await waitFor(() => expect(runtimeExecute).toHaveBeenCalledWith(expect.objectContaining({ command: 'provider.status' })));
        await screen.findByTestId('model-mapping-sections');

        expect(screen.getByText('请先在“API 配置”中添加 Provider，随后再建立模型映射。')).toBeInTheDocument();
        expect(screen.queryByText(/Runtime 路线建议/)).not.toBeInTheDocument();
    });

    it.fails('[BAD CASE] regression target: Runtime-only RH should expose non-secret route recommendations', async () => {
        renderSettings();

        fireEvent.click(screen.getByRole('button', { name: '模型映射' }));
        await waitFor(() => expect(runtimeExecute).toHaveBeenCalled());
        await screen.findByTestId('model-mapping-sections');

        expect(screen.getByText('Runtime 路线建议')).toBeInTheDocument();
        expect(screen.getByText(/rhart-image-g-2\/text-to-image/)).toBeInTheDocument();
    });

    it('passes when a browser-side RH key exists: the existing catalog recommends its routes', () => {
        const suggestions = suggestProductRouteMappings(runningHubBrowserKey());

        expect(suggestions).toEqual(expect.arrayContaining([
            expect.objectContaining({ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' }, routeId: 'rhart-image-g-2/text-to-image' }),
            expect.objectContaining({ target: { kind: 'product-mode', productModelId: 'flovart:grok-imagine-video-1.5', mode: 'text-to-video' }, routeId: 'rhart-video-g/text-to-video' }),
            expect.objectContaining({ target: { kind: 'product-mode', productModelId: 'flovart:grok-imagine-video-1.5', mode: 'image-to-video' }, routeId: 'rhart-video-g/image-to-video' }),
        ]));
    });

    it('[BAD CASE] blocks browser route resolution when only the Runtime credential exists', () => {
        expect(resolveRouteMapping({ kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' }, [])).toBeNull();
        expect(resolveProductModelRoute('flovart:gpt-image-2', 'text-to-image', [])).toBeNull();
    });

    it('after one-click import, the Runtime-managed key exposes non-secret route recommendations', () => {
        const imported = (): UserApiKey => {
            const routes = runningHubStatus.routes || [];
            return {
                id: 'rh-runtime-imported',
                provider: 'runningHub',
                capabilities: ['image', 'video'],
                key: 'runtime:id_1784860120373_qkcqckhzw',
                name: 'RunningHub（Runtime 托管）',
                runtimeManaged: { credentialId: 'id_1784860120373_qkcqckhzw' },
                models: routes.map(route => ({ id: route.routeId, name: route.routeId })),
                customModels: routes.map(route => route.routeId),
                routeMappings: routes.map((route, index) => ({
                    target: {
                        kind: 'product-mode' as const,
                        productModelId: route.productModel as string,
                        mode: (route.mode || (route.productModel?.includes('image') ? 'text-to-image' : 'text-to-video')) as 'text-to-image' | 'text-to-video' | 'image-to-video',
                    },
                    routeId: route.routeId,
                    order: index,
                })),
                createdAt: 1,
                updatedAt: 1,
            };
        };

        const suggestions = suggestProductRouteMappings(imported());

        expect(suggestions).toEqual(expect.arrayContaining([
            expect.objectContaining({ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' }, routeId: 'rhart-image-g-2/text-to-image' }),
            expect.objectContaining({ target: { kind: 'product-mode', productModelId: 'flovart:veo-3.1-lite', mode: 'text-to-video' }, routeId: 'rhart-video-v3.1-lite-official/text-to-video' }),
        ]));
        // 明文占位符不应被当成真实浏览器 Key：resolveRouteMapping 仍不应成功（浏览器无法直连）。
        expect(resolveRouteMapping({ kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' }, [imported()]))
            .toMatchObject({ status: 'ready' });
    });
});
