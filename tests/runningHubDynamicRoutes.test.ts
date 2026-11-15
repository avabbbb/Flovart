import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserApiKey } from '../types';
import {
    clearRunningHubDynamicRoutes,
    familyDisplayName,
    getInferredRouteSchema,
    getRunningHubRoutesVersion,
    inferRouteSchema,
    isCandidateGenerationDoc,
    modeFromEndpoint,
    parseRunningHubApiDoc,
    parseRunningHubLlmsTxt,
    refreshRunningHubDocRoutes,
    registerInferredRunningHubRoutes,
    registerRunningHubRouteSchemas,
    routeFamilyOf,
    runningHubDocProxyUrl,
    runningHubDocSite,
    subscribeRunningHubRoutes,
    type DynamicRouteSchema,
} from '../services/runningHubDynamicRoutes';
import { getRouteCatalog, getRouteSchema, isVerifiedRoute } from '../services/runningHubRouteCatalog';
import {
    getDynamicProductModels,
    getEffectiveProductModelCapabilities,
    getEffectiveReferenceLimits,
    getProductModel,
    getProductModels,
    getResolvableImageModes,
    getResolvableVideoModes,
    resolveProductModelRoute,
    suggestProductRouteMappings,
} from '../services/productModelCatalog';
import { mergeSuggestedProductRouteMappings } from '../services/aiServiceSetup';

const FIXTURES = join(__dirname, 'fixtures', 'runningHubDocs');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const DOC_BASE = 'https://www.runninghub.cn/runninghub-api-doc-cn/';

function parseFixture(docId: string): DynamicRouteSchema {
    const entry = parseRunningHubLlmsTxt(fixture('llms.txt')).find(item => item.docId === docId)!;
    const schema = parseRunningHubApiDoc(fixture(`${docId}.md`), { docId, title: entry.title, category: entry.category, site: 'cn', url: entry.url });
    if (!schema) throw new Error(`${docId} did not parse`);
    return schema;
}

const ALL_DOCS = ['api-519905082', 'api-519905081', 'api-448183060', 'api-448183061', 'api-448183127'];

const rhKey = (overrides: Partial<UserApiKey> = {}): UserApiKey => ({
    id: 'rh-key',
    provider: 'runningHub',
    key: 'secret',
    capabilities: ['image', 'video'],
    baseUrl: 'https://www.runninghub.cn/openapi/v2',
    models: [{ id: 'seedream-v5-flash/text-to-image', name: 'seedream-v5-flash-文生图' }],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
} as UserApiKey);

beforeEach(() => clearRunningHubDynamicRoutes());
afterEach(() => clearRunningHubDynamicRoutes());

describe('llms.txt parsing', () => {
    it('lists API docs (not guide pages) and keeps only generation candidates', () => {
        const entries = parseRunningHubLlmsTxt(fixture('llms.txt'));
        expect(entries.map(entry => entry.docId)).toEqual([
            'api-425749010', 'api-448183060', 'api-448183061', 'api-448183127', 'api-519905080', 'api-519905082', 'api-519905081', 'api-400000001',
        ]);
        expect(entries[1]).toMatchObject({ title: 'Vidu-首尾帧生视频-q2-pro', category: '模型API > 视频生成与处理 > image-to-video > Vidu', url: `${DOC_BASE}api-448183060.md` });
        // AI 应用、音频、图层拆分被排除；「其他」分类里的 Seedream 5 Flash 生成接口保留，交给文档 YAML 判定。
        expect(entries.filter(isCandidateGenerationDoc).map(entry => entry.docId)).toEqual([
            'api-448183060', 'api-448183061', 'api-448183127', 'api-519905082', 'api-519905081',
        ]);
    });

    it('picks the doc site from the RunningHub base URL and proxies through same origin', () => {
        expect(runningHubDocSite('https://www.runninghub.cn/openapi/v2')).toBe('cn');
        expect(runningHubDocSite('https://www.runninghub.ai/openapi/v2')).toBe('ai');
        expect(runningHubDocSite(undefined)).toBe('cn');
        expect(runningHubDocProxyUrl(`${DOC_BASE}api-519905081.md`)).toBe('/api/llm-proxy/www.runninghub.cn/runninghub-api-doc-cn/api-519905081.md');
    });
});

describe('endpoint mode inference + family grouping', () => {
    it.each([
        ['seedream-v5-flash/text-to-image', 'text-to-image', 'seedream-v5-flash'],
        ['seedream-v5-flash/image-to-image', 'image-to-image', 'seedream-v5-flash'],
        ['rhart-image-n-pro/edit', 'image-to-image', 'rhart-image-n-pro'],
        ['alibaba/qwen-image-3.0/image-edit', 'image-to-image', 'alibaba/qwen-image-3.0'],
        ['vidu/start-end-to-video-q2-pro', 'first-last-frame', 'vidu/q2-pro'],
        ['vidu/image-to-video-q2-pro', 'image-to-video', 'vidu/q2-pro'],
        ['kling-video-o1/start-to-end', 'first-last-frame', 'kling-video-o1'],
        ['rhart-video/sparkvideo-2.0/multimodal-video', 'reference-to-video', 'rhart-video/sparkvideo-2.0'],
        ['kling-video-o1-std/refrence-to-video', 'reference-to-video', 'kling-video-o1-std'],
        ['minimax/hailuo-2.3/t2v-pro', 'text-to-video', 'minimax/hailuo-2.3/pro'],
    ])('%s → %s in family %s', (routeId, mode, family) => {
        expect(modeFromEndpoint(routeId)).toBe(mode);
        expect(routeFamilyOf(routeId)).toBe(family);
    });

    it('keeps tool routes and mode-less endpoints out of shared families', () => {
        expect(modeFromEndpoint('seedream-v5-flash/layer-decomposition')).toBeNull();
        expect(modeFromEndpoint('kling-video-o3-pro/video-edit')).toBeNull();
        expect(modeFromEndpoint('rhart-image/f-2-dev/text-to-image-lora')).toBeNull();
        expect(routeFamilyOf('minimax/hailuo-02/fast')).toBe('minimax/hailuo-02/fast');
    });

    it('derives a family display name from doc titles', () => {
        expect(familyDisplayName(['seedream-v5-flash-文生图', 'seedream-v5-flash-图生图'], 'seedream-v5-flash')).toBe('seedream-v5-flash');
        expect(familyDisplayName(['Vidu-首尾帧生视频-q2-pro', 'Vidu-图生视频-q2-pro'], 'vidu/q2-pro')).toBe('Vidu q2-pro');
        expect(familyDisplayName(['seedance2.0/多模态视频'], 'rhart-video/sparkvideo-2.0')).toBe('seedance2.0');
    });
});

describe('OpenAPI doc parsing', () => {
    it('parses Seedream 5 Flash image-to-image exactly from the official schema', () => {
        const schema = parseFixture('api-519905081');
        expect(schema).toMatchObject({
            routeId: 'seedream-v5-flash/image-to-image',
            modes: ['image-to-image'],
            family: 'seedream-v5-flash',
            capability: 'image',
            source: 'docs',
            site: 'cn',
            promptField: 'prompt',
            aspectRatioField: null,
            durationType: null,
            resolutionDefault: '2k',
            resolutionValues: ['1k', '1.5k', '2k'],
            officialEvidence: `${DOC_BASE}api-519905081`,
            vendor: 'seedream',
        });
        expect(schema.media).toEqual([
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 10, min: 1, required: true, mapping: 'all_references' },
        ]);
        expect(schema.params).toEqual([
            { field: 'width', type: 'number', default: 1024, minimum: 240, maximum: 8192, multipleOf: 1 },
            { field: 'height', type: 'number', default: 1024, minimum: 240, maximum: 8192, multipleOf: 1 },
            { field: 'outputFormat', type: 'string' },
        ]);
    });

    it('parses Seedream 5 Flash text-to-image with no media', () => {
        const schema = parseFixture('api-519905082');
        expect(schema).toMatchObject({ routeId: 'seedream-v5-flash/text-to-image', modes: ['text-to-image'], family: 'seedream-v5-flash', media: [] });
    });

    it('maps first/last frame fields by role for a start-end video route', () => {
        const schema = parseFixture('api-448183060');
        expect(schema.routeId).toBe('vidu/start-end-to-video-q2-pro');
        expect(schema.modes).toEqual(['first-last-frame']);
        expect(schema.media).toEqual([
            { field: 'firstImageUrl', kind: 'image', serialization: 'single', max: 1, min: 1, required: true, mapping: 'first_last_frame', role: 'first' },
            { field: 'lastImageUrl', kind: 'image', serialization: 'single', max: 1, min: 1, required: true, mapping: 'first_last_frame', role: 'last' },
        ]);
        expect(schema.durationType).toBe('string');
        expect(schema.durationValues?.length).toBeGreaterThan(0);
        expect(schema.durationValues?.every(value => typeof value === 'string')).toBe(true);
        expect(parseFixture('api-448183061')).toMatchObject({
            routeId: 'vidu/image-to-video-q2-pro',
            modes: ['image-to-video'],
            family: 'vidu/q2-pro',
            media: [{ field: 'imageUrl', kind: 'image', serialization: 'single', mapping: 'first_frame_only' }],
        });
    });

    it('maps a multimodal reference video (images + videos + audios)', () => {
        const schema = parseFixture('api-448183127');
        expect(schema.routeId).toBe('rhart-video/sparkvideo-2.0/multimodal-video');
        expect(schema.modes).toEqual(['reference-to-video']);
        expect(schema.media.map(({ field, kind, max, mapping }) => ({ field, kind, max, mapping }))).toEqual([
            { field: 'imageUrls', kind: 'image', max: 9, mapping: 'multimodal' },
            { field: 'videoUrls', kind: 'video', max: 3, mapping: 'multimodal' },
            { field: 'audioUrls', kind: 'audio', max: 3, mapping: 'multimodal' },
        ]);
        expect(schema.aspectRatioField).toBe('ratio');
        expect(schema.aspectRatioValues?.[0]).toBe('adaptive');
        expect(schema.params.map(param => param.field)).toEqual(expect.arrayContaining(['generateAudio', 'realPersonMode', 'seed']));
    });

    it('rejects docs without an executable generation path', () => {
        expect(parseRunningHubApiDoc('# no yaml here')).toBeNull();
        const layer = fixture('api-519905081.md').replace('/openapi/v2/seedream-v5-flash/image-to-image', '/openapi/v2/seedream-v5-flash/layer-decomposition');
        expect(parseRunningHubApiDoc(layer)).toBeNull();
    });

    it('marks suffix-only inference as unverified', () => {
        const schema = inferRouteSchema('some-vendor/new-model/image-to-video');
        expect(schema).toMatchObject({ source: 'inferred', modes: ['image-to-video'], family: 'some-vendor/new-model' });
        registerInferredRunningHubRoutes([{ id: 'some-vendor/new-model/image-to-video' }]);
        expect(getInferredRouteSchema('some-vendor/new-model/image-to-video')?.source).toBe('inferred');
        expect(isVerifiedRoute('some-vendor/new-model/image-to-video')).toBe(false);
        expect(getRouteSchema('some-vendor/new-model/image-to-video')).toBeUndefined();
    });
});

describe('dynamic catalog → product models → route mapping', () => {
    beforeEach(() => registerRunningHubRouteSchemas(ALL_DOCS.map(parseFixture), 'cn'));

    it('makes docs routes verified and lets docs override the fallback seed', () => {
        expect(isVerifiedRoute('vidu/image-to-video-q2-pro')).toBe(true);
        const flash = getRouteSchema('seedream-v5-flash/image-to-image')!;
        expect(flash.source).toBe('docs');
        // 已绑定静态产品卡的家族保持原产品归属
        expect(flash.productModelId).toBe('flovart:seedream-5-flash');
        expect(getRouteSchema('rhart-video/sparkvideo-2.0/multimodal-video')?.productModelId).toBe('flovart:seedance-2');
        expect(getRouteSchema('vidu/start-end-to-video-q2-pro')?.productModelId).toBe('rh:vidu/q2-pro');
        expect(getRouteCatalog().some(route => route.routeId === 'vidu/image-to-video-q2-pro')).toBe(true);
    });

    it('turns a dynamic family into one product card whose modes come from its sibling routes', () => {
        const vidu = getProductModel('rh:vidu/q2-pro')!;
        expect(vidu).toMatchObject({ capability: 'video', provider: 'runningHub', name: 'Vidu q2-pro', company: 'Vidu', status: 'available' });
        expect(vidu.capabilities.modes).toEqual(['image-to-video', 'first-last-frame']);
        expect(getProductModels('video').map(model => model.id)).toContain('rh:vidu/q2-pro');
        expect(getDynamicProductModels('video').map(model => model.id)).toEqual(['rh:vidu/q2-pro']);
        expect(getProductModel('vidu/image-to-video-q2-pro')?.id).toBe('rh:vidu/q2-pro');
        // Seedream 5 Flash：静态卡只声明文生图，图生图与 10 张参考上限来自官方文档
        const flash = getProductModel('flovart:seedream-5-flash')!;
        expect(flash.capabilities.modes).toEqual(['text-to-image', 'image-to-image']);
        expect(flash.capabilities.maxImageReferences).toBe(10);
        expect(getEffectiveReferenceLimits('flovart:seedream-5-flash', 'image-to-image', { provider: 'runningHub', routeId: 'seedream-v5-flash/image-to-image' }).image).toBe(10);
        expect(getEffectiveProductModelCapabilities('flovart:seedream-5-flash', 'image-to-image', { provider: 'runningHub', routeId: 'seedream-v5-flash/image-to-image' })?.resolutions).toEqual(['1K', '2K']);
    });

    it('auto-maps every family + mode to its endpoint for a RunningHub key', () => {
        const suggestions = suggestProductRouteMappings(rhKey());
        const pairs = suggestions.map(mapping => mapping.target.kind === 'product-mode' ? `${mapping.target.productModelId}|${mapping.target.mode}|${mapping.routeId}` : '');
        expect(pairs).toEqual(expect.arrayContaining([
            'flovart:seedream-5-flash|text-to-image|seedream-v5-flash/text-to-image',
            'flovart:seedream-5-flash|image-to-image|seedream-v5-flash/image-to-image',
            'rh:vidu/q2-pro|image-to-video|vidu/image-to-video-q2-pro',
            'rh:vidu/q2-pro|first-last-frame|vidu/start-end-to-video-q2-pro',
            'flovart:seedance-2|reference-to-video|rhart-video/sparkvideo-2.0/multimodal-video',
        ]));
        // 每个 产品+模式 只映射一条
        expect(new Set(pairs.map(pair => pair.split('|').slice(0, 2).join('|'))).size).toBe(pairs.length);

        const key = mergeSuggestedProductRouteMappings(rhKey());
        // 有参考图 → 图生图线路；无参考图 → 文生图线路（同一产品卡按模式切换 endpoint）
        expect(resolveProductModelRoute('flovart:seedream-5-flash', 'image-to-image', [key])?.routeId).toBe('seedream-v5-flash/image-to-image');
        expect(resolveProductModelRoute('flovart:seedream-5-flash', 'text-to-image', [key])?.routeId).toBe('seedream-v5-flash/text-to-image');
        expect(getResolvableImageModes('flovart:seedream-5-flash', [key])).toEqual(['text-to-image', 'image-to-image']);
        expect(getResolvableVideoModes('rh:vidu/q2-pro', [key])).toEqual(['image-to-video', 'first-last-frame']);
    });

    it('does not map docs routes of the other site, nor keys that were never fetched', () => {
        const aiKey = rhKey({ baseUrl: 'https://www.runninghub.ai/openapi/v2' });
        expect(suggestProductRouteMappings(aiKey).some(mapping => mapping.routeId.startsWith('vidu/'))).toBe(false);
        expect(suggestProductRouteMappings(rhKey({ models: [] }))).toEqual([]);
    });
});

describe('refreshRunningHubDocRoutes', () => {
    const fakeFetch = (failing = new Set<string>()) => {
        const calls: string[] = [];
        const fetchText = async (url: string) => {
            calls.push(url);
            const name = url.slice(url.lastIndexOf('/') + 1);
            if (failing.has(name)) throw new Error('network');
            return fixture(name);
        };
        return { calls, fetchText };
    };

    it('fetches llms.txt + candidate docs, tolerates failures, caches, and notifies', async () => {
        const { calls, fetchText } = fakeFetch(new Set(['api-448183127.md']));
        let notified = 0;
        const unsubscribe = subscribeRunningHubRoutes(() => { notified += 1; });
        const before = getRunningHubRoutesVersion();
        const result = await refreshRunningHubDocRoutes({ baseUrl: 'https://www.runninghub.cn/openapi/v2', fetchText, concurrency: 2 });
        unsubscribe();
        expect(result).toMatchObject({ ok: true, site: 'cn', fromCache: false, parsed: 4, failed: 1 });
        expect(calls[0]).toBe(`${DOC_BASE}llms.txt`);
        // 只拉取生成类候选文档（不拉 AI 应用 / 音频 / 图层拆分）
        expect(calls.slice(1).sort()).toEqual(['api-448183060.md', 'api-448183061.md', 'api-448183127.md', 'api-519905081.md', 'api-519905082.md'].map(name => DOC_BASE + name));
        expect(result.routes.map(route => route.routeId).sort()).toEqual([
            'seedream-v5-flash/image-to-image', 'seedream-v5-flash/text-to-image', 'vidu/image-to-video-q2-pro', 'vidu/start-end-to-video-q2-pro',
        ]);
        expect(notified).toBeGreaterThan(0);
        expect(getRunningHubRoutesVersion()).toBeGreaterThan(before);
        expect(localStorage.getItem('flovart.runningHubDocRoutes.v1')).toContain('vidu/start-end-to-video-q2-pro');

        // TTL 内再次调用直接用缓存
        const second = fakeFetch();
        const cached = await refreshRunningHubDocRoutes({ baseUrl: 'https://www.runninghub.cn/openapi/v2', fetchText: second.fetchText });
        expect(cached.fromCache).toBe(true);
        expect(second.calls).toEqual([]);

        // force：重新拉 llms.txt，只补拉失败 / 过期的文档
        const third = fakeFetch();
        const forced = await refreshRunningHubDocRoutes({ baseUrl: 'https://www.runninghub.cn/openapi/v2', fetchText: third.fetchText, force: true });
        expect(third.calls).toEqual([`${DOC_BASE}llms.txt`, `${DOC_BASE}api-448183127.md`]);
        expect(forced.routes).toHaveLength(5);
    });

    it('keeps the previous cache when llms.txt is unreachable', async () => {
        registerRunningHubRouteSchemas([parseFixture('api-519905081')], 'cn', 0);
        const result = await refreshRunningHubDocRoutes({ site: 'cn', fetchText: async () => { throw new Error('offline'); } });
        expect(result.ok).toBe(false);
        expect(isVerifiedRoute('seedream-v5-flash/image-to-image')).toBe(true);
        expect(getRouteSchema('seedream-v5-flash/image-to-image')?.source).toBe('docs');
    });
});
