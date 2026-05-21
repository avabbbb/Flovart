/**
 * aiGateway 单元测试 — 验证 inferProviderFromModel 模型名称→Provider 推断逻辑
 * 覆盖 providers：google, openai, anthropic, qwen, deepseek, custom
 * 2026 模型名更新：Gemini 3, GPT-5.4, Claude Opus 4.6, Veo 3.1
 */
import { describe, it, expect } from 'vitest';
import { diagnoseKeyCapabilities, explainKeyCapabilities, getDynamicParamSchema, inferCapabilityFromModel, inferCapabilityFromModelName, inferProviderFromModel, isGoogleImageEditModel, isGoogleTextToImageModel, supportsMaskImageEditing, supportsReferenceImageEditing } from '../services/aiGateway';
import type { UserApiKey } from '../types';

describe('inferProviderFromModel', () => {
    it('识别 Google 模型（含 Gemini 3 / Veo 3.1）', () => {
        expect(inferProviderFromModel('gemini-2.5-pro')).toBe('google');
        expect(inferProviderFromModel('gemini-3-flash-preview')).toBe('google');
        expect(inferProviderFromModel('gemini-3.1-pro-preview')).toBe('google');
        expect(inferProviderFromModel('gemini-3.1-flash-lite-preview')).toBe('google');
        expect(inferProviderFromModel('imagen-4.0-generate-001')).toBe('google');
        expect(inferProviderFromModel('veo-2.0-generate-001')).toBe('google');
        expect(inferProviderFromModel('veo-3.1-generate-preview')).toBe('google');
        expect(inferProviderFromModel('veo-3.1-lite-generate-preview')).toBe('google');
    });

    it('识别 OpenAI 模型（含 GPT-5.4）', () => {
        expect(inferProviderFromModel('dall-e-3')).toBe('openai');
        expect(inferProviderFromModel('gpt-image-1')).toBe('openai');
        expect(inferProviderFromModel('gpt-4o')).toBe('openai');
        expect(inferProviderFromModel('gpt-5.4')).toBe('openai');
        expect(inferProviderFromModel('gpt-5.4-mini')).toBe('openai');
        expect(inferProviderFromModel('gpt-5.4-nano')).toBe('openai');
    });

    it('识别 Anthropic 模型（含 Claude 4.x）', () => {
        expect(inferProviderFromModel('claude-3-haiku-20240307')).toBe('anthropic');
        expect(inferProviderFromModel('claude-3.5-sonnet')).toBe('anthropic');
        expect(inferProviderFromModel('claude-opus-4-6')).toBe('anthropic');
        expect(inferProviderFromModel('claude-sonnet-4-6')).toBe('anthropic');
        expect(inferProviderFromModel('claude-haiku-4-5')).toBe('anthropic');
    });

    it('识别 Qwen 模型', () => {
        expect(inferProviderFromModel('qwen-vl-plus')).toBe('qwen');
    });

    it('识别 DeepSeek 模型', () => {
        expect(inferProviderFromModel('deepseek-chat')).toBe('deepseek');
        expect(inferProviderFromModel('deepseek-reasoner')).toBe('deepseek');
    });

    it('推断模型能力（含新模型）', () => {
        expect(inferCapabilityFromModel('gemini-2.5-pro')).toBe('text');
        expect(inferCapabilityFromModel('gemini-3-flash-preview')).toBe('text');
        expect(inferCapabilityFromModel('gemini-3.1-flash-image-preview')).toBe('image');
        expect(inferCapabilityFromModel('gemini-3-pro-image-preview')).toBe('image');
        expect(inferCapabilityFromModel('imagen-4.0-generate-001')).toBe('image');
        expect(inferCapabilityFromModel('veo-3.1-generate-preview')).toBe('video');
        expect(inferCapabilityFromModel('gpt-5.4')).toBe('text');
        expect(inferCapabilityFromModel('gpt-image-1.5')).toBe('image');
    });

    it('识别 Google 图片模型类型', () => {
        expect(isGoogleImageEditModel('gemini-2.5-flash-image')).toBe(true);
        expect(isGoogleImageEditModel('gemini-3.1-flash-image-preview')).toBe(true);
        expect(isGoogleImageEditModel('imagen-4.0-generate-001')).toBe(false);
        expect(isGoogleTextToImageModel('imagen-4.0-generate-001')).toBe(true);
        expect(isGoogleTextToImageModel('gemini-2.5-flash-image')).toBe(false);
    });

    it('识别 OpenRouter 和图像编辑能力矩阵', () => {
        expect(inferProviderFromModel('openai/gpt-image-1')).toBe('openrouter');
        expect(inferCapabilityFromModel('openai/gpt-image-1')).toBe('image');
        expect(inferCapabilityFromModel('google/gemini-3-flash-preview')).toBe('text');
        expect(inferCapabilityFromModel('google/imagen-4.0-generate-001')).toBe('image');
        expect(supportsReferenceImageEditing('gemini-3.1-flash-image-preview')).toBe(true);
        expect(supportsReferenceImageEditing('gpt-image-1')).toBe(true);
        expect(supportsReferenceImageEditing('openai/gpt-image-1')).toBe(true);
        expect(supportsReferenceImageEditing('dall-e-3')).toBe(false);
        expect(supportsMaskImageEditing('gpt-image-1')).toBe(true);
        expect(supportsMaskImageEditing('openai/gpt-image-1')).toBe(false);
    });

    it('未知模型回退到 custom', () => {
        expect(inferProviderFromModel('some-unknown-model')).toBe('custom');
        expect(inferProviderFromModel('')).toBe('custom');
    });

    it('为内联控制台动态推断媒体能力和参数 Schema', () => {
        expect(inferCapabilityFromModelName('openrouter/google/veo-3.1-generate-preview')).toBe('video');
        expect(inferCapabilityFromModelName('kling-v2-hq-movie')).toBe('video');
        expect(inferCapabilityFromModelName('runway-gen4-video')).toBe('video');
        expect(inferCapabilityFromModelName('luma-ray2')).toBe('video');
        expect(inferCapabilityFromModelName('flux-schnell-dev')).toBe('image');
        expect(inferCapabilityFromModelName('midjourney-v6-alpha')).toBe('image');
        expect(inferCapabilityFromModelName('flux-kontext-pro')).toBe('image');
        expect(getDynamicParamSchema('veo-3.1-generate-preview')).toEqual({
            hasSeed: true,
            hasCfgScale: false,
            hasAspectRatio: true,
            defaultAspectRatio: '16:9',
        });
        expect(getDynamicParamSchema('flux-schnell')).toEqual({
            hasSeed: true,
            hasCfgScale: false,
            hasAspectRatio: false,
        });
        expect(getDynamicParamSchema('kling-v2').hasAspectRatio).toBe(true);
        expect(getDynamicParamSchema('gpt-image-1')).toEqual({
            hasSeed: true,
            hasCfgScale: true,
            hasAspectRatio: false,
        });
    });

    it('Stability 模型已移除 — 回退到 custom', () => {
        expect(inferProviderFromModel('sdxl-turbo')).toBe('custom');
        expect(inferProviderFromModel('stable-diffusion-xl-1024')).toBe('custom');
    });
});

describe('diagnoseKeyCapabilities', () => {
    it('无 Key 时报告全部缺失', () => {
        const result = diagnoseKeyCapabilities([]);
        expect(result.covered).toEqual([]);
        expect(result.missing).toEqual(['text', 'image', 'video']);
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('有 Google Key 时覆盖 text/image/video', () => {
        const keys: UserApiKey[] = [{
            id: '1', provider: 'google', key: 'AIzaSyFakeKey123456',
            capabilities: ['text', 'image', 'video'],
            createdAt: Date.now(), updatedAt: Date.now(),
        }];
        const result = diagnoseKeyCapabilities(keys);
        expect(result.covered).toContain('text');
        expect(result.covered).toContain('image');
        expect(result.covered).toContain('video');
        expect(result.missing).toEqual([]);
    });

    it('缺少 Google Key 时给出建议', () => {
        const keys: UserApiKey[] = [{
            id: '1', provider: 'openai', key: 'sk-proj-FakeKey123',
            capabilities: ['text'],
            createdAt: Date.now(), updatedAt: Date.now(),
        }];
        const result = diagnoseKeyCapabilities(keys);
        expect(result.warnings.some(w => w.includes('Google'))).toBe(true);
    });
});

describe('explainKeyCapabilities', () => {
    it('only reports creative key capabilities', () => {
        const keys: UserApiKey[] = [{
            id: '1', provider: 'custom', key: 'sk-test',
            capabilities: ['text', 'image', 'video'],
            createdAt: Date.now(), updatedAt: Date.now(),
        }];

        const result = explainKeyCapabilities(keys);
        expect(result.map(r => r.capability)).toEqual(['text', 'image', 'video']);
        expect(result.every(r => r.supported)).toBe(true);
    });

    it('reports all supported with full keyset', () => {
        const keys: UserApiKey[] = [
            { id: '1', provider: 'google', key: 'k1', capabilities: ['text', 'image', 'video'], createdAt: 0, updatedAt: 0 },
            { id: '2', provider: 'custom', key: 'tool-key', capabilities: ['agent'], baseUrl: 'https://tools.example.com/v1', defaultModel: 'layer-tool-v1', createdAt: 0, updatedAt: 0 },
        ];
        const result = explainKeyCapabilities(keys);
        expect(result.every(r => r.supported)).toBe(true);
    });

    it('returns per-capability reasons', () => {
        const result = explainKeyCapabilities([]);
        expect(result).toHaveLength(3);
        result.forEach(r => {
            expect(r.supported).toBe(false);
            expect(r.reason.length).toBeGreaterThan(0);
        });
    });
});
