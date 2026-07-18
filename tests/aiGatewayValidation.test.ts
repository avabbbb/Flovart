/**
 * aiGateway 验证测试 — 测试 validateApiKey 对各 provider 的验证逻辑
 * 包括 Google (models.list)、OpenAI (/models)、Anthropic (/messages) 等格式校验
 * 以及 generateImageWithProvider 对不支持 provider 的报错行为
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    validateApiKey,
    getCapabilityDictionary,
    inferProviderFromModel,
    generateImageWithProvider,
    generateVideoWithProvider,
    pollSeedanceVideoTask,
    reversePromptWithProvider,
    submitSeedanceVideoTask,
    splitImageLayersWithProvider,
    runImageAgentWithProvider,
    executeUnifiedIgnition,
} from '../services/aiGateway';
import { BUILTIN_RUNNINGHUB_MODELS, normalizeRunningHubModelEndpoint } from '../services/runningHubService';

function mockJsonResponse(body: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
        headers: {
            get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
    } as Response;
}

function mockBinaryResponse(body: BlobPart, mimeType = 'video/mp4', status = 200) {
    const bytes = typeof body === 'string'
        ? new TextEncoder().encode(body)
        : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : ArrayBuffer.isView(body)
                ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
                : new Uint8Array();
    const blob = Object.assign(new Blob([bytes], { type: mimeType }), {
        arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    });
    return {
        ok: status >= 200 && status < 300,
        status,
        blob: () => Promise.resolve(blob),
        headers: {
            get: (name: string) => (name.toLowerCase() === 'content-type' ? mimeType : null),
        },
    } as unknown as Response;
}

describe('aiGateway - validateApiKey', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('Google provider 调用 models.list 接口验证', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            models: [{
                name: 'models/gemini-3.1-flash-image-preview',
                displayName: 'Gemini 3.1 Flash Image Preview',
                supportedGenerationMethods: ['generateImages'],
            }],
        }));
        const result = await validateApiKey('google', 'test-google-key');
        expect(result.ok).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.stringContaining('generativelanguage.googleapis.com')
        );
    });

    it('OpenAI provider 调用 /models 接口验证', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            data: [{ id: 'gpt-4o' }],
        }));
        const result = await validateApiKey('openai', 'sk-test-key');
        expect(result.ok).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.stringContaining('api.openai.com/v1/models'),
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer sk-test-key' }),
            })
        );
    });

    it('RunningHub provider 使用标准模型查询端点验证', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'missing-task',
                status: 'FAILED',
                errorCode: '404',
                errorMessage: 'task not found',
                results: null,
                clientId: '',
            }))
            .mockResolvedValueOnce({
                ok: true,
                text: () => Promise.resolve(
                    `<script id="__NUXT_DATA__">${JSON.stringify([
                        {
                            name: 'nano-banana2-gemini31flash/image-to-image-channel-low-price',
                            categoryName: 'image-to-image',
                            sourceTypeName: 'standard-model',
                            description: 'image model',
                        },
                        {
                            name: 'nano-banana-pro/edit-channel-low-price',
                            categoryName: 'image-to-image',
                            sourceTypeName: 'standard-model',
                            description: 'image pro model',
                        },
                        {
                            name: 'google/veo3.1-fast/start-end-to-video-channel-low-price',
                            categoryName: 'start-end-to-video',
                            sourceTypeName: 'standard-model',
                            description: 'video model',
                        },
                    ])}</script>`,
                ),
            } as Response);

        const result = await validateApiKey('runningHub', '0123456789abcdef0123456789abcdef', 'https://www.runninghub.cn');

        expect(result.ok).toBe(true);
        expect(result.capabilitySummary).toEqual(['image', 'video']);
        expect(result.models?.map(model => model.id)).toEqual(expect.arrayContaining([
            'rhart-image-g-2/image-to-image',
            'rhart-image-n-g31-flash/image-to-image',
            'rhart-image-n-pro/edit',
            'rhart-video-v3.1-fast/start-end-to-video',
            'rhart-video/sparkvideo-2.0/multimodal-video',
        ]));
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://www.runninghub.cn/openapi/v2/query',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer 0123456789abcdef0123456789abcdef' }),
            }),
        );
        expect(globalThis.fetch).toHaveBeenNthCalledWith(2, 'https://www.runninghub.ai/page-api');
    });

    it('RunningHub provider 不把 HTTP 200 的业务认证错误误判为已验证', async () => {
        globalThis.fetch = vi.fn().mockResolvedValueOnce(mockJsonResponse({
            taskId: '1234567890123456789',
            status: '',
            errorCode: '806',
            errorMessage: 'APIKEY_USER_NOT_FOUND',
            results: null,
            clientId: '',
        }));

        const result = await validateApiKey('runningHub', '00000000000000000000000000000000', 'https://www.runninghub.cn');

        expect(result.ok).toBe(false);
        expect(result.message).toContain('RunningHub API Key 无效');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('RunningHub 内置全能视频 V3.1 低价渠道模型', () => {
        const ids = BUILTIN_RUNNINGHUB_MODELS.map(model => model.id);
        expect(ids).toEqual(expect.arrayContaining([
            'rhart-video/sparkvideo-2.0/text-to-video',
            'rhart-video/sparkvideo-2.0/image-to-video',
            'rhart-video/sparkvideo-2.0/multimodal-video',
            'rhart-video/sparkvideo-2.0-fast/text-to-video',
            'rhart-video/sparkvideo-2.0-fast/image-to-video',
            'rhart-video/sparkvideo-2.0-fast/multimodal-video',
            'rhart-video-v3.1-fast/text-to-video',
            'rhart-video-v3.1-fast/image-to-video',
            'rhart-video-v3.1-fast/start-end-to-video',
            'rhart-video-v3.1-pro/text-to-video',
            'rhart-video-v3.1-pro/image-to-video',
            'rhart-video-v3.1-pro/start-end-to-video',
            'rhart-video-s/text-to-video',
        ]));
    });

    it('RunningHub 全能视频 V3.1 低价渠道展示名会归一到官方 endpoint', () => {
        expect(normalizeRunningHubModelEndpoint('google/veo3.1-fast/text-to-video-channel-low-price')).toBe('rhart-video-v3.1-fast/text-to-video');
        expect(normalizeRunningHubModelEndpoint('google/veo3.1-fast/image-to-video-channel-low-price')).toBe('rhart-video-v3.1-fast/image-to-video');
        expect(normalizeRunningHubModelEndpoint('google/veo3.1-fast/start-end-to-video-channel-low-price')).toBe('rhart-video-v3.1-fast/start-end-to-video');
        expect(normalizeRunningHubModelEndpoint('google/veo3.1-pro/text-to-video-channel-low-price')).toBe('rhart-video-v3.1-pro/text-to-video');
        expect(normalizeRunningHubModelEndpoint('google/veo3.1-pro/image-to-video-channel-low-price')).toBe('rhart-video-v3.1-pro/image-to-video');
        expect(normalizeRunningHubModelEndpoint('google/veo3.1-pro/start-end-to-video-channel-low-price')).toBe('rhart-video-v3.1-pro/start-end-to-video');
    });

    it('RunningHub API 文档页 URL 会归一到真实 endpoint', () => {
        const cases: Array<[string, string]> = [
            ['https://www.runninghub.cn/runninghub-api-doc-cn/api-448183144', 'rhart-video-v3.1-fast/text-to-video'],
            ['https://www.runninghub.cn/runninghub-api-doc-cn/api-448183087', 'rhart-video-v3.1-fast/image-to-video'],
            ['https://www.runninghub.cn/runninghub-api-doc-cn/api-448183086', 'rhart-video-v3.1-fast/start-end-to-video'],
            ['https://www.runninghub.cn/runninghub-api-doc-cn/api-448183167.md?from=settings', 'rhart-video/sparkvideo-2.0/text-to-video'],
            ['runninghub-api-doc-cn/api-448183127', 'rhart-video/sparkvideo-2.0/multimodal-video'],
            ['https://www.runninghub.cn/runninghub-api-doc-cn/api-448183116', 'rhart-video/sparkvideo-2.0/image-to-video'],
            ['https://www.runninghub.cn/runninghub-api-doc-cn/api-448183115', 'rhart-video/sparkvideo-2.0-fast/image-to-video'],
        ];
        for (const [input, endpoint] of cases) {
            expect(normalizeRunningHubModelEndpoint(input)).toBe(endpoint);
        }
    });

    it('RunningHub Seedance 2.0 展示名会归一到官方 sparkvideo endpoint', () => {
        expect(normalizeRunningHubModelEndpoint('seedance-2.0-global/text-to-video')).toBe('rhart-video/sparkvideo-2.0/text-to-video');
        expect(normalizeRunningHubModelEndpoint('seedance-2.0-global/image-to-video')).toBe('rhart-video/sparkvideo-2.0/image-to-video');
        expect(normalizeRunningHubModelEndpoint('seedance-2.0-global/multimodal-video')).toBe('rhart-video/sparkvideo-2.0/multimodal-video');
        expect(normalizeRunningHubModelEndpoint('bytedance/seedance-2.0-global-fast/text-to-video')).toBe('rhart-video/sparkvideo-2.0-fast/text-to-video');
        expect(normalizeRunningHubModelEndpoint('bytedance/seedance-2.0-global-fast/image-to-video')).toBe('rhart-video/sparkvideo-2.0-fast/image-to-video');
        expect(normalizeRunningHubModelEndpoint('bytedance/seedance-2.0-global-fast/multimodal-video')).toBe('rhart-video/sparkvideo-2.0-fast/multimodal-video');
        expect(normalizeRunningHubModelEndpoint('seedance2.0-fast/图生视频')).toBe('rhart-video/sparkvideo-2.0-fast/image-to-video');
        expect(normalizeRunningHubModelEndpoint('seedance2.0/多模态视频')).toBe('rhart-video/sparkvideo-2.0/multimodal-video');
    });

    it('Anthropic provider 验证逻辑', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
        });
        const result = await validateApiKey('anthropic', 'sk-ant-test-key');
        expect(result.ok).toBe(true);
    });

    it('custom 裸域名会自动补全到 /v1 并返回 effectiveBaseUrl', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            data: [{ id: 'gemini-3.1-flash-image-preview-512px' }],
        }));

        const result = await validateApiKey('custom', 'sk-test-key', 'https://ai.t8star.cn');

        expect(result.ok).toBe(true);
        expect(result.effectiveBaseUrl).toBe('https://ai.t8star.cn/v1');
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://ai.t8star.cn/v1/models',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer sk-test-key' }),
            })
        );
    });

    it('custom provider validation honors Anthropic requestFormat and auth header config', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
        });

        const result = await validateApiKey(
            'custom',
            'secret-key',
            'https://anthropic-proxy.example.com/v1',
            { requestFormat: 'anthropic', authHeaderName: 'x-api-key', authScheme: '' },
        );

        expect(result.ok).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://anthropic-proxy.example.com/v1/messages',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'x-api-key': 'secret-key',
                    'anthropic-version': '2023-06-01',
                }),
            }),
        );
    });
});

describe('aiGateway - Seedance multimodal slots', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('builds multimodal content slots and filters provider params by capability', async () => {
        vi.useFakeTimers();
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({ id: 'seedance-task-1' }))
            .mockResolvedValueOnce(mockJsonResponse({ status: 'succeeded', content: { video_url: 'https://cdn.example.com/seedance.mp4' }, usage: { total_tokens: 640000 } }))
            .mockResolvedValueOnce(mockBinaryResponse('seedance-video'));
        const onProviderTaskLifecycle = vi.fn();

        const promise = generateVideoWithProvider('two characters cross the room', 'seedance-2-0-260128', {
            id: 'seedance-key',
            provider: 'volcengine',
            capabilities: ['video'],
            key: 'ark-test-key',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 8,
            resolution: '1080p',
            seed: 42,
            cameraFixed: true,
            watermark: false,
            returnLastFrame: true,
            onProviderTaskLifecycle,
            slots: [
                { kind: 'image', href: 'data:image/png;base64,aW1hZ2Ux', mimeType: 'image/png', role: 'reference_image', label: 'role-a' },
                { kind: 'image', href: 'data:image/png;base64,aW1hZ2Uy', mimeType: 'image/png', role: 'first_frame', label: 'role-b' },
                { kind: 'image', href: 'data:image/png;base64,aW1hZ2Uz', mimeType: 'image/png', role: 'last_frame', label: 'role-c' },
                { kind: 'video', href: 'https://cdn.example.com/ref.mp4', mimeType: 'video/mp4', role: 'reference_video' },
                { kind: 'audio', href: 'https://cdn.example.com/ref.mp3', mimeType: 'audio/mpeg', role: 'reference_audio' },
            ],
        });

        await vi.advanceTimersByTimeAsync(10_000);
        const result = await promise;

        expect(result.mimeType).toBe('video/mp4');
        expect(onProviderTaskLifecycle).toHaveBeenCalledWith(expect.objectContaining({ phase: 'submitted', providerTaskId: 'seedance-task-1' }));
        expect(onProviderTaskLifecycle).toHaveBeenCalledWith(expect.objectContaining({ phase: 'usage', status: 'succeeded', totalTokens: 640000 }));
        const [createUrl, createInit] = vi.mocked(globalThis.fetch).mock.calls[0];
        expect(createUrl).toBe('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
        const body = JSON.parse(String(createInit?.body));
        expect(body).toMatchObject({
            model: 'seedance-2-0-260128',
            ratio: '16:9',
            duration: 8,
            resolution: '1080p',
            seed: 42,
            camera_fixed: true,
            watermark: false,
            return_last_frame: true,
        });
        expect(body.content).toEqual([
            { type: 'text', text: '参考素材编号：图片1=@role-a、图片2=@role-b、图片3=@role-c、视频1、音频1。请按这些编号理解提示词中的图片、视频和音频引用，角色和主体不要混淆。\n\ntwo characters cross the room' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2Ux' }, role: 'reference_image' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2Uy' }, role: 'first_frame' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2Uz' }, role: 'last_frame' },
            { type: 'video_url', video_url: { url: 'https://cdn.example.com/ref.mp4' }, role: 'reference_video' },
            { type: 'audio_url', audio_url: { url: 'https://cdn.example.com/ref.mp3' }, role: 'reference_audio' },
        ]);
        vi.useRealTimers();
    });

    it.each([
        ['text-to-video', [], []],
        ['image-to-video', ['first_frame'], ['image_url']],
        ['reference-to-video', ['reference_image', 'reference_image', 'reference_video', 'reference_audio'], ['image_url', 'image_url', 'video_url', 'audio_url']],
        ['first-last-frame', ['first_frame', 'last_frame'], ['image_url', 'image_url']],
    ] as const)('maps PromptBar %s to the exact Seedance content slots', async (generationSubmode, expectedRoles, expectedTypes) => {
        globalThis.fetch = vi.fn().mockResolvedValueOnce(mockJsonResponse({ id: `task-${generationSubmode}` }));
        await submitSeedanceVideoTask('生成视频', 'doubao-seedance-2-0-260128', {
            id: 'seedance-key', provider: 'volcengine', capabilities: ['video'], key: 'ark-test-key',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', createdAt: 0, updatedAt: 0,
        }, {
            generationSubmode,
            slots: [
                { kind: 'image', href: 'data:image/png;base64,aW1hZ2Ux', mimeType: 'image/png', role: 'reference_image' },
                { kind: 'image', href: 'data:image/png;base64,aW1hZ2Uy', mimeType: 'image/png', role: 'reference_image' },
                { kind: 'video', href: 'https://cdn.example.com/ref.mp4', mimeType: 'video/mp4', role: 'reference_video' },
                { kind: 'audio', href: 'https://cdn.example.com/ref.mp3', mimeType: 'audio/mpeg', role: 'reference_audio' },
            ],
        });
        const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body));
        expect(body.content.slice(1).map((item: any) => item.role)).toEqual(expectedRoles);
        expect(body.content.slice(1).map((item: any) => item.type)).toEqual(expectedTypes);
    });

    it('rejects missing PromptBar mode inputs before creating a Seedance task', async () => {
        globalThis.fetch = vi.fn();
        await expect(submitSeedanceVideoTask('首尾转场', 'doubao-seedance-2-0-260128', {
            id: 'seedance-key', provider: 'volcengine', capabilities: ['video'], key: 'ark-test-key', createdAt: 0, updatedAt: 0,
        }, {
            generationSubmode: 'first-last-frame',
            slots: [{ kind: 'image', href: 'data:image/png;base64,aW1hZ2Ux', mimeType: 'image/png' }],
        })).rejects.toThrow('首尾帧模式需要 2 张图片');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('matches the Tokenhub Seedance 2.0 task API shape and prefers the query id', async () => {
        globalThis.fetch = vi.fn().mockResolvedValueOnce(mockJsonResponse({
            id: 'task_DKMeQXBNP0rrYJeiy1fg599NCBNXdfzD',
            status: 'submitted',
            task_id: 'cgt-20260610160326-929cb',
        }));

        const handle = await submitSeedanceVideoTask('first-person tea commercial', 'seedance-2.0', {
            id: 'seedance-tokenhub-key',
            provider: 'volcengine',
            capabilities: ['video'],
            key: 'tokenhub-test-key',
            baseUrl: 'https://tokenhub.linkstor.com',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 11,
            watermark: false,
            generateAudio: true,
            slots: [
                { kind: 'image', href: 'https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic1.jpg', mimeType: 'image/jpeg', role: 'reference_image' },
                { kind: 'video', href: 'https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_tea_video1.mp4', mimeType: 'video/mp4', role: 'reference_video' },
                { kind: 'audio', href: 'https://ark-project.tos-cn-beijing.volces.com/doc_audio/r2v_tea_audio1.mp3', mimeType: 'audio/mpeg', role: 'reference_audio' },
            ],
        });

        expect(handle.taskId).toBe('task_DKMeQXBNP0rrYJeiy1fg599NCBNXdfzD');
        expect(handle.metadata?.upstreamTaskId).toBe('cgt-20260610160326-929cb');
        const [createUrl, createInit] = vi.mocked(globalThis.fetch).mock.calls[0];
        expect(createUrl).toBe('https://tokenhub.linkstor.com/api/v3/contents/generations/tasks');
        const body = JSON.parse(String(createInit?.body));
        expect(body).toMatchObject({
            model: 'doubao-seedance-2.0',
            generate_audio: true,
            ratio: '16:9',
            duration: 11,
            watermark: false,
        });
        expect(body.content).toEqual([
            { type: 'text', text: '参考素材编号：图片1、视频1、音频1。请按这些编号理解提示词中的图片、视频和音频引用，角色和主体不要混淆。\n\nfirst-person tea commercial' },
            { type: 'image_url', image_url: { url: 'https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic1.jpg' }, role: 'reference_image' },
            { type: 'video_url', video_url: { url: 'https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_tea_video1.mp4' }, role: 'reference_video' },
            { type: 'audio_url', audio_url: { url: 'https://ark-project.tos-cn-beijing.volces.com/doc_audio/r2v_tea_audio1.mp3' }, role: 'reference_audio' },
        ]);
    });

    it('normalizes Seedance ratios, duration, and fast-model resolution before submit', async () => {
        globalThis.fetch = vi.fn().mockResolvedValueOnce(mockJsonResponse({
            id: 'seedance-task-normalized',
            status: 'submitted',
        }));

        await submitSeedanceVideoTask('wide product scene', 'doubao-seedance-fast-2.0', {
            id: 'seedance-key',
            provider: 'volcengine',
            capabilities: ['video'],
            key: 'ark-test-key',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '1280x720' as any,
            durationSec: 20,
            resolution: '1080p',
            slots: [
                { kind: 'image', href: 'data:image/png;base64,aW1hZ2U=', mimeType: 'image/png', role: 'reference_image' },
            ],
        });

        const [, createInit] = vi.mocked(globalThis.fetch).mock.calls[0];
        const body = JSON.parse(String(createInit?.body));
        expect(body).toMatchObject({
            ratio: '16:9',
            duration: 15,
            resolution: '720p',
        });
    });

    it('rejects Seedance audio-only references before calling the provider', async () => {
        globalThis.fetch = vi.fn();

        await expect(submitSeedanceVideoTask('voice driven scene', 'seedance-2.0', {
            id: 'seedance-key',
            provider: 'volcengine',
            capabilities: ['video'],
            key: 'ark-test-key',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            createdAt: 0,
            updatedAt: 0,
        }, {
            slots: [
                { kind: 'audio', href: 'https://cdn.example.com/ref.mp3', mimeType: 'audio/mpeg', role: 'reference_audio' },
            ],
        })).rejects.toThrow('Seedance 参考音频不能单独使用');

        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects local Seedance video and audio references before calling the provider', async () => {
        globalThis.fetch = vi.fn();
        const key = {
            id: 'seedance-key',
            provider: 'volcengine' as const,
            capabilities: ['video' as const],
            key: 'ark-test-key',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            createdAt: 0,
            updatedAt: 0,
        };

        await expect(submitSeedanceVideoTask('video ref scene', 'seedance-2.0', key, {
            slots: [
                { kind: 'image', href: 'https://cdn.example.com/ref.png', mimeType: 'image/png', role: 'reference_image' },
                { kind: 'video', href: 'data:video/mp4;base64,AA==', mimeType: 'video/mp4', role: 'reference_video' },
            ],
        })).rejects.toThrow('Seedance 参考视频必须使用公网 URL 或 asset:// 素材 ID');

        await expect(submitSeedanceVideoTask('audio ref scene', 'seedance-2.0', key, {
            slots: [
                { kind: 'image', href: 'https://cdn.example.com/ref.png', mimeType: 'image/png', role: 'reference_image' },
                { kind: 'audio', href: 'blob:audio-ref', mimeType: 'audio/mpeg', role: 'reference_audio' },
            ],
        })).rejects.toThrow('Seedance 参考音频必须使用公网 URL 或 asset:// 素材 ID');

        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it('does not call Seedance provider when the request is already aborted', async () => {
        globalThis.fetch = vi.fn();
        const controller = new AbortController();
        controller.abort(new DOMException('用户停止', 'AbortError'));

        await expect(submitSeedanceVideoTask('aborted scene', 'doubao-seedance-2.0', {
            id: 'seedance-key',
            provider: 'volcengine',
            capabilities: ['video'],
            key: 'ark-test-key',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            createdAt: 0,
            updatedAt: 0,
        }, {
            signal: controller.signal,
            slots: [
                { kind: 'image', href: 'https://cdn.example.com/ref.png', mimeType: 'image/png', role: 'reference_image' },
            ],
        })).rejects.toMatchObject({ name: 'AbortError' });

        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('attempts upstream Seedance cancellation after submit when local polling is stopped', async () => {
        const controller = new AbortController();
        globalThis.fetch = vi.fn(async (input, init) => {
            const url = String(input);
            if (init?.method === 'POST' && url.endsWith('/contents/generations/tasks')) {
                return mockJsonResponse({ id: 'task-cancel-after-submit', status: 'queued' });
            }
            if (init?.method === 'DELETE' && url.endsWith('/contents/generations/tasks/task-cancel-after-submit')) {
                return mockJsonResponse({ cancelled: true });
            }
            return mockJsonResponse({ status: 'running' });
        });

        const pending = generateVideoWithProvider('stop this video', 'doubao-seedance-2-0-260128', {
            id: 'seedance-key', provider: 'volcengine', capabilities: ['video'], key: 'ark-test-key',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', createdAt: 0, updatedAt: 0,
        }, { signal: controller.signal, durationSec: 5, resolution: '720p' });

        await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
        controller.abort(new DOMException('用户停止', 'AbortError'));
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await vi.waitFor(() => expect(vi.mocked(globalThis.fetch).mock.calls.some(([url, init]) => String(url).endsWith('/contents/generations/tasks/task-cancel-after-submit') && init?.method === 'DELETE')).toBe(true));
    });

    it('parses the Tokenhub Seedance 2.0 status response video URL', async () => {
        globalThis.fetch = vi.fn().mockResolvedValueOnce(mockJsonResponse({
            id: 'task_2YCpPYe6kWzNxQAJOhwOnVvtpBtNfMiK',
            model: 'doubao-seedance-2.0',
            status: 'succeeded',
            content: {
                video_url: 'https://maas-task.example.com/prod-upload/result.mp4',
            },
            created_at: 1781070515,
            updated_at: 1781070907,
            usage: {
                total_tokens: 1000000,
                completion_tokens: 1000000,
            },
        }));

        const result = await pollSeedanceVideoTask({
            providerId: 'volcengine',
            modelId: 'doubao-seedance-2.0',
            taskId: 'task_2YCpPYe6kWzNxQAJOhwOnVvtpBtNfMiK',
            baseUrl: 'https://tokenhub.linkstor.com/api/v3',
            createdAt: 1781070515,
        }, {
            id: 'seedance-tokenhub-key',
            provider: 'volcengine',
            capabilities: ['video'],
            key: 'tokenhub-test-key',
            baseUrl: 'https://tokenhub.linkstor.com',
            createdAt: 0,
            updatedAt: 0,
        });

        expect(result).toMatchObject({
            status: 'succeeded',
            videoUrl: 'https://maas-task.example.com/prod-upload/result.mp4',
        });
        expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
            'https://tokenhub.linkstor.com/api/v3/contents/generations/tasks/task_2YCpPYe6kWzNxQAJOhwOnVvtpBtNfMiK',
        );
    });

    it('exposes Seedance video slot capability dictionary', () => {
        expect(inferProviderFromModel('dreamina-seedance-2-0-260128')).toBe('volcengine');
        expect(inferProviderFromModel('doubao-seedance-2.0')).toBe('volcengine');
        const capability = getCapabilityDictionary('doubao-seedance-2.0', 'volcengine');
        expect(capability.multimodalSlots.image?.max).toBe(9);
        expect(capability.multimodalSlots.video?.max).toBe(3);
        expect(capability.requestParams).toContain('duration');
    });
});

describe('aiGateway - generateImageWithProvider', () => {
    it('rejects an unresolved product model id before any provider request is sent', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            data: [{ b64_json: 'ZmFrZQ==' }],
        }));

        await expect(generateImageWithProvider('test', 'flovart:gpt-image-2', {
            id: 'openai-key',
            provider: 'openai',
            capabilities: ['image'],
            key: 'sk-test',
            routeBindings: [{
                productModelId: 'flovart:gpt-image-2',
                mode: 'text-to-image' as const,
                routeId: 'gpt-image-2',
                priority: 0,
                enabled: true,
                confirmed: true,
            }],
            createdAt: 0,
            updatedAt: 0,
        })).rejects.toThrow(/产品模型.*上游模型/);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('forwards cancellation to the provider request and returns a readable stop message', async () => {
        const controller = new AbortController();
        globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('生成已停止', 'AbortError')), { once: true });
        }));

        const pending = executeUnifiedIgnition({
            elementId: 'target',
            prompt: '生成一张图片',
            modelId: 'openai/gpt-image-1',
            apiKeyPayload: {
                id: 'or-key', provider: 'openrouter', capabilities: ['image'], key: 'sk-test', createdAt: 0, updatedAt: 0,
            },
            signal: controller.signal,
        });
        controller.abort();
        const result = await pending;

        expect(vi.mocked(globalThis.fetch).mock.calls[0][1]?.signal).toBe(controller.signal);
        expect(result).toMatchObject({ ok: false, errorMessage: '生成已停止，可重新发起。' });
    });

    it('executeUnifiedIgnition sends precise @ role bindings with image and text references', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            choices: [{
                message: {
                    images: [{ image_url: { url: 'data:image/png;base64,ZmFrZQ==' } }],
                },
            }],
        }));

        const result = await executeUnifiedIgnition({
            elementId: 'target',
            prompt: '让 @角色A 和 @角色B 对视，保持 @角色设定 的服装差异',
            modelId: 'openai/gpt-image-1',
            apiKeyPayload: {
                id: 'or-key',
                provider: 'openrouter',
                capabilities: ['image'],
                key: 'sk-or-test-key',
                createdAt: 0,
                updatedAt: 0,
            },
            references: [
                { type: 'image', href: 'data:image/png;base64,YS0=', mimeType: 'image/png', slotRole: 'reference_image', label: '角色A', sourceName: '角色A' },
                { type: 'image', href: 'data:image/png;base64,Yi0=', mimeType: 'image/png', slotRole: 'reference_image', label: '角色B', sourceName: '角色B' },
                { type: 'text', slotRole: 'unassigned', label: '角色设定', sourceName: '角色设定', text: '角色A红夹克。角色B蓝外套。' },
            ],
        });

        expect(result.ok).toBe(true);
        const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
        const body = JSON.parse(String(init?.body));
        const text = body.messages[0].content[0].text;
        expect(text).toContain('图片1 = @角色A，slot=reference_image');
        expect(text).toContain('图片2 = @角色B，slot=reference_image');
        expect(text).toContain('文本1 = @角色设定: 角色A红夹克。角色B蓝外套。');
        expect(text).toContain('用户提示词：');
        expect(body.messages[0].content.slice(1)).toEqual([
            { type: 'image_url', image_url: { url: 'data:image/png;base64,YS0=' } },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,Yi0=' } },
        ]);
    });

    it('routes RunningHub standard image models through the native standard-model API', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                code: 200,
                message: 'success',
                data: { download_url: 'https://cdn.example.com/input.png' },
            }))
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-task-1',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/rh.png', outputType: 'png', text: null }],
                clientId: 'client-1',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-image', 'image/png'));

        const result = await generateImageWithProvider('把杯子变成磨砂玻璃材质', 'rhart-image-n-g31-flash/image-to-image', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['image'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, [{ href: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' }]);

        expect(result.newImageMimeType).toBe('image/png');
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            1,
            'https://www.runninghub.cn/openapi/v2/media/upload/binary',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer 0123456789abcdef0123456789abcdef' }),
            }),
        );
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            2,
            'https://www.runninghub.cn/openapi/v2/rhart-image-n-g31-flash/image-to-image',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer 0123456789abcdef0123456789abcdef' }),
                body: expect.stringContaining('"prompt":"把杯子变成磨砂玻璃材质"'),
            }),
        );
        expect(JSON.parse((globalThis.fetch as any).mock.calls[1][1].body)).toMatchObject({
            imageUrls: ['https://cdn.example.com/input.png'],
            resolution: '1k',
        });
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            3,
            'https://cdn.example.com/rh.png',
            expect.anything(),
        );
    });

    it('passes user aspectRatio and resolution into RunningHub text-to-image route payload', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-t2i',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/t2i.png', outputType: 'png', text: null }],
                clientId: 'client-1',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-image', 'image/png'));

        await generateImageWithProvider('日落海滩', 'rhart-image-g-2/text-to-image', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['image'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, [], {
            aspectRatio: '16:9',
            resolution: '2k',
        });

        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body.aspectRatio).toBe('16:9');
        expect(body.resolution).toBe('2k');
        expect(body.prompt).toBe('日落海滩');
    });

    it('surfaces RunningHub submit error details instead of a generic missing taskId', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                data: { download_url: 'https://cdn.example.com/input.png' },
            }))
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: '',
                status: '',
                errorCode: '1001',
                errorMessage: 'Invalid URL, please check your link | 请求链接无效，请检查您的调用链接',
                results: null,
                clientId: '',
                promptTips: '',
                failedReason: {},
            }));

        await expect(generateImageWithProvider('生成毛玻璃节点', 'nano-banana2-gemini31flash/image-to-image-channel-low-price', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['image'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, [{ href: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' }]))
            .rejects.toThrow('Invalid URL, please check your link');
    });

    it('maps packaged RunningHub detail URLs before submit', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                data: { download_url: 'https://cdn.example.com/input.png' },
            }))
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-task-detail',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/rh-detail.png', outputType: 'png', text: null }],
                clientId: 'client-detail',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-image', 'image/png'));

        await generateImageWithProvider(
            '保留主体，增强质感',
            'https://www.runninghub.cn/call-api/api-detail/2046503667076751361',
            {
                id: 'rh-key',
                provider: 'runningHub',
                capabilities: ['image'],
                key: '0123456789abcdef0123456789abcdef',
                baseUrl: 'https://www.runninghub.cn/openapi/v2',
                createdAt: 0,
                updatedAt: 0,
            },
            [{ href: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' }],
        );

        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            2,
            'https://www.runninghub.cn/openapi/v2/rhart-image-g-2/image-to-image',
            expect.objectContaining({ method: 'POST' }),
        );
        expect(JSON.parse((globalThis.fetch as any).mock.calls[1][1].body)).toMatchObject({
            imageUrls: ['https://cdn.example.com/input.png'],
            resolution: '1k',
        });
    });

    it('normalizes RunningHub absolute model URLs before submit', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                data: { download_url: 'https://cdn.example.com/input.png' },
            }))
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-task-2',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/rh-2.png', outputType: 'png', text: null }],
                clientId: 'client-2',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-image', 'image/png'));

        await generateImageWithProvider(
            '做成磨砂玻璃海报',
            'https://www.runninghub.cn/openapi/v2/nano-banana-pro/edit-channel-low-price?foo=bar',
            {
                id: 'rh-key',
                provider: 'runningHub',
                capabilities: ['image'],
                key: '0123456789abcdef0123456789abcdef',
                baseUrl: 'https://www.runninghub.cn/openapi/v2',
                createdAt: 0,
                updatedAt: 0,
            },
            [{ href: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' }],
        );

        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            2,
            'https://www.runninghub.cn/openapi/v2/rhart-image-n-pro/edit',
            expect.objectContaining({ method: 'POST' }),
        );
        expect(JSON.parse((globalThis.fetch as any).mock.calls[1][1].body)).toMatchObject({
            imageUrls: ['https://cdn.example.com/input.png'],
            resolution: '1k',
        });
    });

    it('rejects RunningHub docs/search URLs before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateImageWithProvider(
            '生成毛玻璃节点',
            'https://www.runninghub.cn/call-api/search-api/standard-model?search=',
            {
                id: 'rh-key',
                provider: 'runningHub',
                capabilities: ['image'],
                key: '0123456789abcdef0123456789abcdef',
                baseUrl: 'https://www.runninghub.cn/openapi/v2',
                createdAt: 0,
                updatedAt: 0,
            },
            [{ href: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' }],
        )).rejects.toThrow('获取模型');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('stops before submit when RunningHub upload returns no usable media URL', async () => {
        globalThis.fetch = vi.fn().mockResolvedValueOnce(mockJsonResponse({
            data: { download_url: '' },
        }));

        await expect(generateImageWithProvider('生成毛玻璃节点', 'nano-banana2-gemini31flash/image-to-image-channel-low-price', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['image'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, [{ href: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' }]))
            .rejects.toThrow('未返回可用媒体 URL');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('does not submit RunningHub image-to-image without a reference image', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateImageWithProvider('生成毛玻璃节点', 'nano-banana2-gemini31flash/image-to-image-channel-low-price', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['image'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, []))
            .rejects.toThrow('需要至少一张参考图');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('routes RunningHub standard video models through the native standard-model API', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-video-1',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/rh.mp4', outputType: 'mp4', text: null }],
                clientId: 'client-1',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-video', 'video/mp4'));

        const result = await generateVideoWithProvider('镜头缓慢推进', 'google/veo3.1-fast/start-end-to-video-channel-low-price', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 6,
            resolution: '720p',
            references: [
                { href: 'https://cdn.example.com/first.png', mimeType: 'image/png', slotRole: 'first_frame' },
                { href: 'https://cdn.example.com/last.png', mimeType: 'image/png', slotRole: 'last_frame' },
            ],
        });

        expect(result.mimeType).toBe('video/mp4');
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            1,
            'https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/start-end-to-video',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer 0123456789abcdef0123456789abcdef' }),
                body: expect.stringContaining('"prompt":"镜头缓慢推进"'),
            }),
        );
        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body).toMatchObject({
            duration: '8',
            resolution: '720p',
            aspectRatio: '16:9',
            firstFrameUrl: 'https://cdn.example.com/first.png',
            lastFrameUrl: 'https://cdn.example.com/last.png',
        });
        expect(body.generateAudio).toBeUndefined();
    });

    it('routes RunningHub V3.1 fast image-to-video with imageUrls field', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-video-fast-image',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/rh-fast-image.mp4', outputType: 'mp4', text: null }],
                clientId: 'client-fast-image',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-video', 'video/mp4'));

        await generateVideoWithProvider('照片变成电影镜头', 'google/veo3.1-fast/image-to-video-channel-low-price', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 8,
            resolution: '720p',
            references: [
                { href: 'https://cdn.example.com/input-1.png', mimeType: 'image/png', slotRole: 'first_frame' },
                { href: 'https://cdn.example.com/input-2.png', mimeType: 'image/png' },
                { href: 'https://cdn.example.com/input-3.png', mimeType: 'image/png' },
                { href: 'https://cdn.example.com/input-4.png', mimeType: 'image/png' },
            ],
        });

        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            1,
            'https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/image-to-video',
            expect.objectContaining({ method: 'POST' }),
        );
        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body).toMatchObject({
            prompt: '照片变成电影镜头',
            duration: '8',
            resolution: '720p',
            aspectRatio: '16:9',
            imageUrls: [
                'https://cdn.example.com/input-1.png',
                'https://cdn.example.com/input-2.png',
                'https://cdn.example.com/input-3.png',
            ],
        });
        expect(body.imageUrl).toBeUndefined();
        expect(body.generateAudio).toBeUndefined();
    });

    it('blocks unverified RunningHub V3.1 pro image-to-video (not in Route Catalog) before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateVideoWithProvider('主体保持一致并推进镜头', 'google/veo3.1-pro/image-to-video-channel-low-price', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 7,
            resolution: '720p',
            references: [
                { href: 'https://cdn.example.com/input.png', mimeType: 'image/png', slotRole: 'first_frame' },
            ],
        })).rejects.toThrow('未通过验证');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('routes RunningHub V3.1 Pro start-end API doc URL with official field names', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-doc-pro-start-end',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/rh-doc-pro.mp4', outputType: 'mp4', text: null }],
                clientId: 'client-doc-pro',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-video', 'video/mp4'));

        await generateVideoWithProvider('首尾帧之间自然过渡', 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183086', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '9:16',
            durationSec: 8,
            resolution: '720p',
            references: [
                { href: 'https://cdn.example.com/first.png', mimeType: 'image/png', slotRole: 'first_frame' },
                { href: 'https://cdn.example.com/last.png', mimeType: 'image/png', slotRole: 'last_frame' },
            ],
        });

        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            1,
            'https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/start-end-to-video',
            expect.objectContaining({ method: 'POST' }),
        );
        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body).toMatchObject({
            prompt: '首尾帧之间自然过渡',
            duration: '8',
            resolution: '720p',
            aspectRatio: '9:16',
            firstFrameUrl: 'https://cdn.example.com/first.png',
            lastFrameUrl: 'https://cdn.example.com/last.png',
        });
        expect(body.generateAudio).toBeUndefined();
        expect(body.imageUrls).toBeUndefined();
    });

    it('routes RunningHub seedance-2.0-global-fast image-to-video with firstFrameUrl field', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-sd-fast-1',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/rh-sd-fast.mp4', outputType: 'mp4', text: null }],
                clientId: 'client-1',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-video', 'video/mp4'));

        const result = await generateVideoWithProvider('风吹过头发', 'bytedance/seedance-2.0-global-fast/image-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 5,
            resolution: '720p',
            references: [
                { href: 'https://cdn.example.com/first.png', mimeType: 'image/png', slotRole: 'first_frame' },
            ],
        });

        expect(result.mimeType).toBe('video/mp4');
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            1,
            'https://www.runninghub.cn/openapi/v2/rhart-video/sparkvideo-2.0-fast/image-to-video',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer 0123456789abcdef0123456789abcdef' }),
            }),
        );
        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body).toMatchObject({
            prompt: '风吹过头发',
            duration: '5',
            resolution: '720p',
            ratio: '16:9',
            firstFrameUrl: 'https://cdn.example.com/first.png',
            generateAudio: true,
            realPersonMode: true,
            conversionSlots: ['all'],
            returnLastFrame: false,
            seed: -1,
        });
        expect(body.imageUrls).toBeUndefined();
    });

    it('blocks unverified Veo 3.1 fast-official image-to-video (not in Route Catalog) before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateVideoWithProvider('镜头缓慢推进', 'rhart-video-v3.1-fast-official/image-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 5,
            resolution: '720p',
            references: [
                { href: 'https://cdn.example.com/ref.png', mimeType: 'image/png' },
            ],
        })).rejects.toThrow('未通过验证');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('blocks unverified Veo 3.1 pro-official reference-to-video (not in Route Catalog) before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateVideoWithProvider('角色在场景中相遇', 'rhart-video-v3.1-pro-official/reference-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 8,
            resolution: '1080p',
            references: [
                { href: 'https://cdn.example.com/a.png', mimeType: 'image/png' },
                { href: 'https://cdn.example.com/b.png', mimeType: 'image/png' },
                { href: 'https://cdn.example.com/c.png', mimeType: 'image/png' },
                { href: 'https://cdn.example.com/d.png', mimeType: 'image/png' },
            ],
        })).rejects.toThrow('未通过验证');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('routes Veo 3.1 fast text-to-video with duration snap to 4/6/8', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-veo31-t2v',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/veo31-t2v.mp4', outputType: 'mp4', text: null }],
                clientId: 'client-1',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-video', 'video/mp4'));

        await generateVideoWithProvider('夜景城市', 'rhart-video-v3.1-fast/text-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '9:16',
            durationSec: 10,
            resolution: '4k',
        });

        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body.duration).toBe('8');
        expect(body.resolution).toBe('4k');
        expect(body.aspectRatio).toBe('9:16');
        expect(body.generateAudio).toBeUndefined();
        expect(body.imageUrls).toBeUndefined();
        expect(body.imageUrl).toBeUndefined();
    });

    it('blocks unverified SkyReels V4 Omni text-to-video (not in Route Catalog) before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateVideoWithProvider('视频续写 @video_1', 'skyreels-v4/omni-reference-fast', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 20,
            resolution: '1080p',
        })).rejects.toThrow('未通过验证');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('blocks unverified SkyReels V4 Omni with references (not in Route Catalog) before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateVideoWithProvider('续写', 'skyreels-v4/omni-reference-fast', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            references: [{ href: 'https://cdn.example.com/ref.png', mimeType: 'image/png' }],
        })).rejects.toThrow('未通过验证');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('blocks unverified 全能视频S text-to-video (not in Route Catalog) before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateVideoWithProvider('魔法森林', 'rhart-video-s/text-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '1:1',
            durationSec: 12,
            resolution: '1080p',
        })).rejects.toThrow('未通过验证');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('blocks unverified 全能视频S text-to-video durationSec 20 (not in Route Catalog) before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateVideoWithProvider('城市夜景', 'rhart-video-s/text-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '9:16',
            durationSec: 20,
        })).rejects.toThrow('未通过验证');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('blocks unverified Veo 3.1 lite-official start-end (not in Route Catalog) before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateVideoWithProvider('镜头推近', 'rhart-video-v3.1-lite-official/start-end-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 8,
            resolution: '720p',
            references: [
                { href: 'https://cdn.example.com/first.png', mimeType: 'image/png', slotRole: 'first_frame' },
                { href: 'https://cdn.example.com/last.png', mimeType: 'image/png', slotRole: 'last_frame' },
            ],
        })).rejects.toThrow('未通过验证');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('blocks unverified Veo 3.1 fast-official reference-to-video (not in Route Catalog) before submit', async () => {
        globalThis.fetch = vi.fn();

        await expect(generateVideoWithProvider('角色场景', 'rhart-video-v3.1-fast-official/reference-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '9:16',
            durationSec: 8,
            resolution: '1080p',
            references: [
                { href: 'https://cdn.example.com/a.png', mimeType: 'image/png' },
                { href: 'https://cdn.example.com/b.png', mimeType: 'image/png' },
                { href: 'https://cdn.example.com/c.png', mimeType: 'image/png' },
                { href: 'https://cdn.example.com/d.png', mimeType: 'image/png' },
            ],
        })).rejects.toThrow('未通过验证');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('routes youchuan text-to-image-v81 with hd:false default and imageUrl single for references', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-youchuan',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/yc.png', outputType: 'png', text: null }],
                clientId: 'client-1',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-image', 'image/png'));

        const result = await generateImageWithProvider('梦幻森林', 'youchuan/text-to-image-v81', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['image'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, [
            { href: 'https://cdn.example.com/ref.png', mimeType: 'image/png' },
        ]);

        expect(result.newImageMimeType).toBe('image/png');
        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body.prompt).toBe('梦幻森林');
        expect(body.hd).toBe(false);
        expect(body.imageUrl).toBe('https://cdn.example.com/ref.png');
        expect(body.imageUrls).toBeUndefined();
    });

    it('maps RunningHub seedance multimodal slots to imageUrls, videoUrls, and audioUrls', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-mm-1',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/rh-mm.mp4', outputType: 'mp4', text: null }],
                clientId: 'client-1',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-video', 'video/mp4'));

        const result = await generateVideoWithProvider('角色看向镜头，音乐渐强', 'rhart-video/sparkvideo-2.0/multimodal-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '9:16',
            durationSec: 5,
            resolution: '720p',
            slots: [
                ...Array.from({ length: 10 }, (_, index) => ({ kind: 'image' as const, href: `https://cdn.example.com/ref-${index}.png`, mimeType: 'image/png', role: 'reference_image' })),
                { kind: 'image', href: 'https://cdn.example.com/ref.png', mimeType: 'image/png', role: 'reference_image' },
                { kind: 'video', href: 'https://cdn.example.com/ref.mp4', mimeType: 'video/mp4', role: 'reference_video' },
                { kind: 'video', href: 'https://cdn.example.com/ref-2.mp4', mimeType: 'video/mp4', role: 'reference_video' },
                { kind: 'video', href: 'https://cdn.example.com/ref-3.mp4', mimeType: 'video/mp4', role: 'reference_video' },
                { kind: 'video', href: 'https://cdn.example.com/ref-4.mp4', mimeType: 'video/mp4', role: 'reference_video' },
                { kind: 'audio', href: 'https://cdn.example.com/ref.mp3', mimeType: 'audio/mpeg', role: 'reference_audio' },
                { kind: 'audio', href: 'https://cdn.example.com/ref-2.mp3', mimeType: 'audio/mpeg', role: 'reference_audio' },
                { kind: 'audio', href: 'https://cdn.example.com/ref-3.mp3', mimeType: 'audio/mpeg', role: 'reference_audio' },
                { kind: 'audio', href: 'https://cdn.example.com/ref-4.mp3', mimeType: 'audio/mpeg', role: 'reference_audio' },
            ],
        });

        expect(result.mimeType).toBe('video/mp4');
        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body).toMatchObject({
            prompt: '角色看向镜头，音乐渐强',
            duration: '5',
            resolution: '720p',
            ratio: '9:16',
            imageUrls: Array.from({ length: 9 }, (_, index) => `https://cdn.example.com/ref-${index}.png`),
            videoUrls: ['https://cdn.example.com/ref.mp4', 'https://cdn.example.com/ref-2.mp4', 'https://cdn.example.com/ref-3.mp4'],
            audioUrls: ['https://cdn.example.com/ref.mp3', 'https://cdn.example.com/ref-2.mp3', 'https://cdn.example.com/ref-3.mp3'],
            generateAudio: true,
            realPersonMode: true,
            conversionSlots: ['all'],
            returnLastFrame: false,
            seed: -1,
        });
    });

    it('limits GPT Image multipart reference inputs to the official 16-image cap', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            data: [{ b64_json: 'ZmFrZQ==' }],
        }));

        const refs = Array.from({ length: 18 }, (_, index) => ({
            href: `data:image/png;base64,${btoa(`image-${index}`)}`,
            mimeType: 'image/png',
        }));

        const result = await generateImageWithProvider('compose the references', 'gpt-image-2', {
            id: 'openai-image-key',
            provider: 'openai',
            capabilities: ['image'],
            key: 'sk-test-key',
            createdAt: 0,
            updatedAt: 0,
        }, refs);

        expect(result.newImageBase64).toBe('ZmFrZQ==');
        const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
        expect(init?.body).toBeInstanceOf(FormData);
        expect((init?.body as FormData).getAll('image')).toHaveLength(16);
        expect((init?.body as FormData).get('model')).toBe('gpt-image-2');
        expect((init?.body as FormData).get('response_format')).toBeNull();
        expect((init?.body as FormData).get('output_format')).toBe('png');
    });

    it('uses official GPT Image 2 generation params without legacy response_format', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            data: [{ b64_json: 'ZmFrZQ==' }],
        }));

        const result = await generateImageWithProvider('test prompt', 'gpt-image-2', {
            id: 'openai-image-key',
            provider: 'openai',
            capabilities: ['image'],
            key: 'sk-test-key',
            extraConfig: {
                imageQuality: 'high',
                outputFormat: 'webp',
                outputCompression: '80',
            },
            createdAt: 0,
            updatedAt: 0,
        });

        expect(result.newImageBase64).toBe('ZmFrZQ==');
        const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual(expect.objectContaining({
            model: 'gpt-image-2',
            prompt: 'test prompt',
            size: '1024x1024',
            quality: 'high',
            output_format: 'webp',
            output_compression: 80,
        }));
        expect(body.response_format).toBeUndefined();
    });

    it('keeps GPT Image 2 4K sizes inside the official edge and pixel limits', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({ data: [{ b64_json: 'ZmFrZQ==' }] }));
        const apiKey = { id: 'openai-image-key', provider: 'openai' as const, capabilities: ['image' as const], key: 'sk-test-key', createdAt: 0, updatedAt: 0 };

        await generateImageWithProvider('wide poster', 'gpt-image-2', apiKey, [], { aspectRatio: '16:9', resolution: '4K' });
        expect(JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body)).size).toBe('3840x2160');

        vi.mocked(globalThis.fetch).mockClear();
        await generateImageWithProvider('square poster', 'gpt-image-2', apiKey, [], { aspectRatio: '1:1', resolution: '4K' });
        const size = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body)).size;
        expect(size).toBe('2880x2880');
        const [width, height] = size.split('x').map(Number);
        expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
        expect(width * height).toBeLessThanOrEqual(8_294_400);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
    });

    it('OpenRouter 使用 chat completions 返回图片 data url', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            choices: [{
                message: {
                    images: [{ image_url: { url: 'data:image/png;base64,ZmFrZQ==' } }],
                },
            }],
        }));

        const result = await generateImageWithProvider('test prompt', 'openai/gpt-image-1', {
            id: '1',
            provider: 'openrouter',
            capabilities: ['image'],
            key: 'sk-or-test-key',
            createdAt: 0,
            updatedAt: 0,
        });

        expect(result.newImageBase64).toBe('ZmFrZQ==');
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.stringContaining('openrouter.ai/api/v1/chat/completions'),
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('custom OpenAI 兼容端点即使模型带前缀也走 images/generations', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            data: [{ b64_json: 'ZmFrZQ==' }],
        }));

        const result = await generateImageWithProvider('test prompt', 'openai/gpt-image-1', {
            id: '2',
            provider: 'custom',
            capabilities: ['image'],
            key: 'sk-test-key',
            baseUrl: 'https://example-proxy.test/v1',
            extraConfig: { endpointFlavor: 'openai-compatible' },
            createdAt: 0,
            updatedAt: 0,
        });

        expect(result.newImageBase64).toBe('ZmFrZQ==');
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.stringContaining('example-proxy.test/v1/images/generations'),
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('custom 裸域名在图片生成时自动补全到 /v1', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            data: [{ b64_json: 'ZmFrZQ==' }],
        }));

        const result = await generateImageWithProvider('test prompt', 'gemini-3.1-flash-image-preview-512px', {
            id: '3',
            provider: 'custom',
            capabilities: ['image'],
            key: 'sk-test-key',
            baseUrl: 'https://ai.t8star.cn',
            extraConfig: { endpointFlavor: 'openai-compatible' },
            createdAt: 0,
            updatedAt: 0,
        });

        expect(result.newImageBase64).toBe('ZmFrZQ==');
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://ai.t8star.cn/v1/images/generations',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('不支持的 provider 现在通过 generic chat/completions 支持', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                data: [{ b64_json: 'YWJjZA==' }],
            }));
        const result = await generateImageWithProvider('test prompt', 'claude-3-haiku', { id: '1', provider: 'anthropic', capabilities: ['text'], key: 'test', createdAt: 0, updatedAt: 0 });
        expect(result.newImageBase64).toBe('YWJjZA==');
        expect(result.newImageMimeType).toBe('image/png');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    it('custom provider applies model mapping and custom auth header', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            data: [{ b64_json: 'ZmFrZQ==' }],
        }));

        const result = await generateImageWithProvider('test prompt', 'openai/gpt-image-1', {
            id: '4',
            provider: 'custom',
            capabilities: ['image'],
            key: 'secret-key',
            baseUrl: 'https://gateway.example.com/v1',
            extraConfig: {
                endpointFlavor: 'openai-compatible',
                authHeaderName: 'x-api-key',
                authScheme: '',
                modelMappingsJson: '{"openai/gpt-image-1":"vendor-image-model"}',
            },
            createdAt: 0,
            updatedAt: 0,
        });

        expect(result.newImageBase64).toBe('ZmFrZQ==');
        const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
        expect(init).toEqual(expect.objectContaining({
            headers: expect.objectContaining({ 'x-api-key': 'secret-key' }),
        }));
        expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
            model: 'vendor-image-model',
        }));
    });
});

describe('aiGateway - custom request format routing', () => {
    it('custom provider with Anthropic requestFormat uses messages endpoint, mapped model, and configured auth header', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            content: [{ text: 'described prompt' }],
        }));

        const result = await reversePromptWithProvider(
            'data:image/png;base64,ZmFrZQ==',
            'image/png',
            'claude-sonnet-4-6',
            {
                id: 'anthropic-custom',
                provider: 'custom',
                capabilities: ['text'],
                key: 'secret-key',
                baseUrl: 'https://anthropic-proxy.example.com/v1',
                extraConfig: {
                    requestFormat: 'anthropic',
                    authHeaderName: 'x-api-key',
                    authScheme: '',
                    modelMappingsJson: '{"claude-sonnet-4-6":"vendor-claude"}',
                },
                createdAt: 0,
                updatedAt: 0,
            },
            'en',
        );

        expect(result).toBe('described prompt');
        const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
        expect(url).toBe('https://anthropic-proxy.example.com/v1/messages');
        expect(init).toEqual(expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
                'Content-Type': 'application/json',
                'x-api-key': 'secret-key',
                'anthropic-version': '2023-06-01',
            }),
        }));
        expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
            model: 'vendor-claude',
        }));
    });
});

describe('aiGateway - unified agent provider actions', () => {
    it('provider-bound image tools require an explicit Base URL', async () => {
        await expect(splitImageLayersWithProvider(
            { href: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' },
            'layer-tool-v1',
            {
                id: 'tool-key',
                provider: 'custom',
                capabilities: ['agent'],
                key: 'secret-key',
                defaultModel: 'layer-tool-v1',
                createdAt: 0,
                updatedAt: 0,
            },
        )).rejects.toThrow('Base URL');
    });

    it('splits image layers through the selected UserApiKey provider config', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            layers: [{
                name: 'subject',
                imageBase64: 'c3ViamVjdA==',
                width: 64,
                height: 48,
                bbox: { x: 7, y: 9 },
            }],
        }));

        const layers = await splitImageLayersWithProvider(
            { href: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' },
            'layer-tool-v1',
            {
                id: 'agent-custom',
                provider: 'custom',
                capabilities: ['agent'],
                key: 'secret-key',
                baseUrl: 'https://agent.example.com/v1/vision',
                models: [{ id: 'layer-tool-v1', name: 'Layer Tool' }],
                extraConfig: {
                    requestFormat: 'native',
                    authHeaderName: 'x-api-key',
                    authScheme: '',
                    modelMappingsJson: '{"layer-tool-v1":"vendor-layer-model"}',
                },
                createdAt: 0,
                updatedAt: 0,
            },
        );

        expect(layers).toEqual([expect.objectContaining({
            name: 'subject',
            dataUrl: 'data:image/png;base64,c3ViamVjdA==',
            width: 64,
            height: 48,
            offsetX: 7,
            offsetY: 9,
        })]);
        const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
        expect(url).toBe('https://agent.example.com/v1/vision/split-layers');
        expect(init).toEqual(expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'x-api-key': 'secret-key' }),
        }));
        expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
            model: 'vendor-layer-model',
            task: 'layer-segmentation',
        }));
    });

    it('runs image agent tasks through the selected UserApiKey provider config', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse({
            result: {
                imageBase64: 'dXBzY2FsZWQ=',
                mimeType: 'image/png',
                width: 128,
                height: 96,
            },
        }));

        const result = await runImageAgentWithProvider(
            { href: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' },
            'upscale',
            'image-tool-v1',
            {
                id: 'agent-custom',
                provider: 'custom',
                capabilities: ['agent'],
                key: 'secret-key',
                baseUrl: 'https://agent.example.com/v1/vision',
                models: [{ id: 'image-tool-v1', name: 'Image Tool' }],
                extraConfig: { requestFormat: 'native' },
                createdAt: 0,
                updatedAt: 0,
            },
            { scale: 2 },
        );

        expect(result).toEqual(expect.objectContaining({
            dataUrl: 'data:image/png;base64,dXBzY2FsZWQ=',
            width: 128,
            height: 96,
        }));
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://agent.example.com/v1/vision/agent',
            expect.objectContaining({ method: 'POST' }),
        );
    });
});

describe('aiGateway - generateVideoWithProvider', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    it('custom 聚合端点支持 v2 统一视频接口', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({ task_id: 'task-123' }))
            .mockResolvedValueOnce(mockJsonResponse({ status: 'SUCCESS', data: { output: 'https://cdn.example.com/video.mp4' } }))
            .mockResolvedValueOnce(mockBinaryResponse('video-binary'));

        const result = await generateVideoWithProvider('test video prompt', 'veo3-fast', {
            id: '4',
            provider: 'custom',
            capabilities: ['video'],
            key: 'sk-test-key',
            baseUrl: 'https://gateway.example.com/v1',
            extraConfig: { endpointFlavor: 'openai-compatible' },
            createdAt: 0,
            updatedAt: 0,
        });

        expect(result.mimeType).toBe('video/mp4');
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            1,
            'https://gateway.example.com/v2/videos/generations',
            expect.objectContaining({ method: 'POST' }),
        );
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            2,
            'https://gateway.example.com/v2/videos/generations/task-123',
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-test-key' }) }),
        );
    });

    it('passes user generateAudio/seed/returnLastFrame overrides into sparkvideo text-to-video payload', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-spark-t2v',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/spark-t2v.mp4', outputType: 'mp4', text: null }],
                clientId: 'client-1',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-video', 'video/mp4'));

        await generateVideoWithProvider('赛博朋克城市', 'rhart-video/sparkvideo-2.0/text-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 5,
            resolution: '1080p',
            generateAudio: false,
            seed: 42,
            returnLastFrame: true,
        });

        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body.generateAudio).toBe(false);
        expect(body.seed).toBe(42);
        expect(body.returnLastFrame).toBe(true);
    });

    it('applies schema defaults for generateAudio/seed/returnLastFrame when user does not override', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({
                taskId: 'rh-spark-t2v-2',
                status: 'SUCCESS',
                errorCode: '',
                errorMessage: '',
                results: [{ url: 'https://cdn.example.com/spark-t2v-2.mp4', outputType: 'mp4', text: null }],
                clientId: 'client-1',
            }))
            .mockResolvedValueOnce(mockBinaryResponse('fake-video', 'video/mp4'));

        await generateVideoWithProvider('宁静山水', 'rhart-video/sparkvideo-2.0/text-to-video', {
            id: 'rh-key',
            provider: 'runningHub',
            capabilities: ['video'],
            key: '0123456789abcdef0123456789abcdef',
            baseUrl: 'https://www.runninghub.cn/openapi/v2',
            createdAt: 0,
            updatedAt: 0,
        }, {
            aspectRatio: '16:9',
            durationSec: 5,
        });

        const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
        expect(body.generateAudio).toBe(true);
        expect(body.seed).toBe(-1);
        expect(body.returnLastFrame).toBe(false);
        expect(body.webSearch).toBe(false);
    });

    it('maps Kling PromptBar image mode, duration and clarity into the official request body', async () => {
        vi.useFakeTimers();
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(mockJsonResponse({ data: { task_id: 'kling-task-1' } }))
            .mockResolvedValueOnce(mockJsonResponse({ data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.example.com/kling.mp4' }] } } }))
            .mockResolvedValueOnce(mockBinaryResponse('kling-video'));
        const pending = generateVideoWithProvider('镜头推进', 'kling-video-3.0', {
            id: 'kling-key', provider: 'keling', capabilities: ['video'], key: 'secret', baseUrl: 'https://api.klingai.com/v1', createdAt: 0, updatedAt: 0,
        }, {
            generationSubmode: 'image-to-video', durationSec: 15, resolution: '1080p', aspectRatio: '9:16',
            slots: [
                { kind: 'image', href: 'data:image/png;base64,QUJD', mimeType: 'image/png' },
                { kind: 'image', href: 'data:image/png;base64,REVG', mimeType: 'image/png' },
            ],
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await pending;
        const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body));
        expect(body).toMatchObject({ type: 'img2video', image: 'data:image/png;base64,QUJD', duration: '15', mode: 'pro', aspect_ratio: '9:16' });
        vi.useRealTimers();
    });

    it('rejects unsupported Kling PromptBar modes before creating an upstream task', async () => {
        globalThis.fetch = vi.fn();
        await expect(generateVideoWithProvider('保持角色', 'kling-video-3.0', {
            id: 'kling-key', provider: 'keling', capabilities: ['video'], key: 'secret', createdAt: 0, updatedAt: 0,
        }, {
            generationSubmode: 'reference-to-video',
            slots: [{ kind: 'image', href: 'data:image/png;base64,QUJD', mimeType: 'image/png' }],
        })).rejects.toThrow('当前可灵 API 线路尚未适配全能参考');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});
