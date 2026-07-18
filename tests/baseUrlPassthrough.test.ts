/**
 * baseUrl 透传 + 图片验证 + 图片返回解析 集成测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Block 1: baseUrl 透传 ──────────────────────────────────

describe('Block1: baseUrl passthrough', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('setGeminiRuntimeConfig 接受 baseUrl 参数', async () => {
        const { setGeminiRuntimeConfig } = await import('../services/geminiService');
        expect(() =>
            setGeminiRuntimeConfig({
                textApiKey: 'test-key',
                baseUrl: 'https://my-proxy.example.com/v1beta',
            })
        ).not.toThrow();
    });

    it('getGeminiRestBaseUrl 返回配置的 baseUrl', async () => {
        const { setGeminiRuntimeConfig, getGeminiRestBaseUrl } = await import('../services/geminiService');
        // 默认值
        expect(getGeminiRestBaseUrl()).toBe('https://generativelanguage.googleapis.com/v1beta');

        // 设置自定义 baseUrl
        setGeminiRuntimeConfig({ baseUrl: 'https://proxy.example.com/v1beta/' });
        expect(getGeminiRestBaseUrl()).toBe('https://proxy.example.com/v1beta');
    });

    it('getGeminiRestBaseUrl 去除尾部斜杠', async () => {
        const { setGeminiRuntimeConfig, getGeminiRestBaseUrl } = await import('../services/geminiService');
        setGeminiRuntimeConfig({ baseUrl: 'https://proxy.example.com/gemini///' });
        expect(getGeminiRestBaseUrl()).toBe('https://proxy.example.com/gemini');
    });

    it('resolves a capability-specific Gemini baseUrl before the shared fallback', async () => {
        const { setGeminiRuntimeConfig, resolveGeminiBaseUrl } = await import('../services/geminiService');
        setGeminiRuntimeConfig({
            baseUrl: 'https://text.example.com/v1beta',
            imageBaseUrl: 'https://image.example.com/v1beta/',
            videoBaseUrl: 'https://video.example.com/v1beta/',
        });

        expect(resolveGeminiBaseUrl('image')).toBe('https://image.example.com/v1beta');
        expect(resolveGeminiBaseUrl('video')).toBe('https://video.example.com/v1beta');
        expect(resolveGeminiBaseUrl('image', 'https://request.example.com/v1beta/')).toBe('https://request.example.com/v1beta');
    });

    it('validateGeminiApiKey 使用自定义 baseUrl 构造请求', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ models: [] }),
        });
        vi.stubGlobal('fetch', mockFetch);

        const { validateGeminiApiKey } = await import('../services/geminiService');
        await validateGeminiApiKey('test-api-key', 'https://custom-proxy.com/v1beta');

        expect(mockFetch).toHaveBeenCalledOnce();
        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain('https://custom-proxy.com/v1beta/models');
        expect(calledUrl).toContain('key=test-api-key');
        expect(calledUrl).not.toContain('generativelanguage.googleapis.com');

        vi.unstubAllGlobals();
    });

    it('validateGeminiApiKey 无 baseUrl 时使用默认 Google 地址', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ models: [] }),
        });
        vi.stubGlobal('fetch', mockFetch);

        // Reset modules to clear any previous runtimeConfig
        vi.resetModules();
        const { validateGeminiApiKey } = await import('../services/geminiService');
        await validateGeminiApiKey('test-api-key');

        const calledUrl = mockFetch.mock.calls[0][0] as string;
        expect(calledUrl).toContain('generativelanguage.googleapis.com');

        vi.unstubAllGlobals();
    });
});

// ── Block 5: 图片返回兼容（验证已有功能） ─────────────────

describe('Block5: parseOpenAIImageResponse (已有)', () => {
    it('aiGateway 导出 fetchImageUrlToBase64 / parseOpenAIImageResponse 辅助函数存在', async () => {
        // 这些是 module-private 函数，不直接导出
        // 但 generateImageWithProvider 和 editImageWithProvider 间接使用它们
        // 我们测试公开的 generateImageWithProvider 路由逻辑
        const mod = await import('../services/aiGateway');
        expect(typeof mod.generateImageWithProvider).toBe('function');
        expect(typeof mod.editImageWithProvider).toBe('function');
    });
});

// ── Block 2: Provider 路由（验证已有功能） ──────────────────

describe('Block2: Provider routing (已有)', () => {
    it('inferProviderFromModel 正确识别各 provider', async () => {
        const { inferProviderFromModel } = await import('../services/aiGateway');
        expect(inferProviderFromModel('gemini-3-flash-preview')).toBe('google');
        expect(inferProviderFromModel('gpt-image-1')).toBe('openai');
        expect(inferProviderFromModel('claude-opus-4-6')).toBe('anthropic');
        expect(inferProviderFromModel('dall-e-3')).toBe('openai');
        expect(inferProviderFromModel('veo-3.1-generate-preview')).toBe('google');
        expect(inferProviderFromModel('deepseek-chat')).toBe('deepseek');
        expect(inferProviderFromModel('openrouter/auto')).toBe('openrouter');
        expect(inferProviderFromModel('unknown-model-xyz')).toBe('custom');
    });

    it('inferCapabilityFromModel 正确识别能力', async () => {
        const { inferCapabilityFromModel } = await import('../services/aiGateway');
        expect(inferCapabilityFromModel('gemini-3.1-flash-image-preview')).toBe('image');
        expect(inferCapabilityFromModel('gemini-3-flash-preview')).toBe('text');
        expect(inferCapabilityFromModel('veo-3.1-generate-preview')).toBe('video');
        expect(inferCapabilityFromModel('gpt-image-1')).toBe('image');
        expect(inferCapabilityFromModel('dall-e-3')).toBe('image');
        expect(inferCapabilityFromModel('unknown-tool-model')).toBeUndefined();
    });
});

// ── Bug fix: 图片验证 ──────────────────────────────────────

describe('Bug fix: validateAndResizeImage', () => {
    it('fileUtils 导出 validateAndResizeImage 函数', async () => {
        const fileUtils = await import('../utils/fileUtils');
        expect(typeof fileUtils.validateAndResizeImage).toBe('function');
    });

    it('拒绝超过 20MB 的文件', async () => {
        const { validateAndResizeImage } = await import('../utils/fileUtils');
        // 创建一个 >20MB 的 mock File
        const bigArray = new Uint8Array(21 * 1024 * 1024);
        const bigFile = new File([bigArray], 'huge.png', { type: 'image/png' });
        await expect(validateAndResizeImage(bigFile)).rejects.toThrow();
    });

    it.skip('接受正常大小的图片文件 (需要浏览器环境: FileReader/Image/Canvas)', async () => {
        const { validateAndResizeImage } = await import('../utils/fileUtils');
        // 生成一个小型有效 PNG（1x1 红色像素, ~68 bytes）
        const pngBytes = Uint8Array.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
            0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33,
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82, // IEND chunk
        ]);
        const file = new File([pngBytes], 'small.png', { type: 'image/png' });

        const result = await validateAndResizeImage(file);
        expect(result).toBeTruthy();
        expect(result.dataUrl.startsWith('data:')).toBe(true);
    });
});
