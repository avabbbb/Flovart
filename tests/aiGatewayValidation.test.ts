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
    return {
        ok: status >= 200 && status < 300,
        status,
        blob: () => Promise.resolve(new Blob([body], { type: mimeType })),
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
            .mockResolvedValueOnce(mockJsonResponse({ status: 'succeeded', content: { video_url: 'https://cdn.example.com/seedance.mp4' } }))
            .mockResolvedValueOnce(mockBinaryResponse('seedance-video'));

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
});
