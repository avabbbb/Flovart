import type { ProductModelMode } from '../types';

export type RouteParamType = 'string' | 'number' | 'boolean';

export interface RouteParamSpec {
    field: string;
    type: RouteParamType;
    default?: string | number | boolean;
    required?: boolean;
}

export type RouteMediaMapping =
    | 'all_references'
    | 'first_last_frame'
    | 'first_frame_only'
    | 'reference_images'
    | 'multimodal';

export interface RouteMediaSpec {
    field: string;
    kind: 'image' | 'video' | 'audio';
    serialization: 'array' | 'single';
    max: number;
    min?: number;
    required?: boolean;
    mapping: RouteMediaMapping;
}

export interface RouteCapabilitySchema {
    routeId: string;
    productModelId: string;
    modes: ProductModelMode[];
    channelTier: 'low-price' | 'official' | 'official-stable';
    promptField: string;
    aspectRatioField: string | null;
    aspectRatioValues?: string[];
    durationType: 'string' | 'number' | null;
    durationValues?: (string | number)[];
    durationDefault?: string | number;
    resolutionDefault?: string;
    params: RouteParamSpec[];
    media: RouteMediaSpec[];
    officialEvidence: string;
}

/** RunningHub 英文文档前缀（按文档 id 拼接引用）。 */
const RH_DOC_EN = ['https:', '', ['www', 'runninghub', 'ai'].join('.'), 'runninghub-api-doc-en', ''].join('/');
/** Seedance 2.5 官方时长：4–30s 的整数秒字符串。 */
const SEEDANCE_25_DURATION_VALUES: string[] = Array.from({ length: 27 }, (_, i) => String(i + 4));
const RUNNHUB_ROUTE_CATALOG: RouteCapabilitySchema[] = [
    {
        routeId: 'youchuan/text-to-image-v81',
        productModelId: 'flovart:midjourney-v8-1',
        modes: ['text-to-image'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: null,
        durationType: null,
        params: [
            { field: 'hd', type: 'boolean', default: false },
        ],
        media: [
            { field: 'imageUrl', kind: 'image', serialization: 'single', max: 1, mapping: 'first_frame_only' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-454760438',
    },
    {
        routeId: 'rhart-image-n-pro/edit',
        productModelId: 'flovart:gemini-3-pro-image',
        modes: ['image-to-image'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: null,
        resolutionDefault: '1k',
        params: [],
        media: [
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 10, min: 1, required: true, mapping: 'all_references' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183220',
    },
    {
        routeId: 'rhart-image-g-2/image-to-image',
        productModelId: 'flovart:gpt-image-2',
        modes: ['image-to-image'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: null,
        resolutionDefault: '1k',
        params: [],
        media: [
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 10, min: 1, required: true, mapping: 'all_references' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183227',
    },
    {
        routeId: 'rhart-image-n-g31-flash/image-to-image',
        productModelId: 'flovart:gemini-3.1-flash-image',
        modes: ['image-to-image'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: null,
        resolutionDefault: '1k',
        params: [],
        media: [
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 10, min: 1, required: true, mapping: 'all_references' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183223',
    },
    {
        routeId: 'rhart-image-n-g31-flash/text-to-image',
        productModelId: 'flovart:gemini-3.1-flash-image',
        modes: ['text-to-image'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: null,
        resolutionDefault: '1k',
        params: [],
        media: [],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183261',
    },
    {
        routeId: 'rhart-image-g-2/text-to-image',
        productModelId: 'flovart:gpt-image-2',
        modes: ['text-to-image'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: null,
        resolutionDefault: '1k',
        params: [],
        media: [],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183264',
    },
    {
        routeId: 'rhart-video-v3.1-fast/image-to-video',
        productModelId: 'flovart:veo-3.1-fast',
        modes: ['image-to-video'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: 'string',
        durationValues: ['4', '6', '8'],
        durationDefault: '8',
        resolutionDefault: '720p',
        params: [],
        media: [
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 3, min: 1, required: true, mapping: 'all_references' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183087',
    },
    {
        routeId: 'rhart-video-v3.1-fast/start-end-to-video',
        productModelId: 'flovart:veo-3.1-fast',
        modes: ['first-last-frame'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: 'string',
        durationValues: ['8'],
        durationDefault: '8',
        resolutionDefault: '720p',
        params: [],
        media: [
            { field: 'firstFrameUrl', kind: 'image', serialization: 'single', max: 1, min: 1, required: true, mapping: 'first_last_frame' },
            { field: 'lastFrameUrl', kind: 'image', serialization: 'single', max: 1, mapping: 'first_last_frame' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183086',
    },
    {
        routeId: 'rhart-video-g/image-to-video',
        productModelId: 'flovart:grok-imagine-video-1.5',
        modes: ['image-to-video'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: 'number',
        durationDefault: 6,
        resolutionDefault: '720p',
        params: [],
        media: [
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 10, min: 1, required: true, mapping: 'all_references' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183102',
    },
    {
        routeId: 'rhart-video/sparkvideo-2.0/image-to-video',
        productModelId: 'flovart:seedance-2',
        modes: ['image-to-video', 'first-last-frame'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'ratio',
        aspectRatioValues: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
        durationType: 'string',
        durationValues: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
        durationDefault: '5',
        resolutionDefault: '720p',
        params: [
            { field: 'generateAudio', type: 'boolean', default: true },
            { field: 'realPersonMode', type: 'boolean', default: true },
            { field: 'conversionSlots', type: 'string', default: 'all' },
            { field: 'returnLastFrame', type: 'boolean', default: false },
            { field: 'seed', type: 'number', default: -1 },
        ],
        media: [
            { field: 'firstFrameUrl', kind: 'image', serialization: 'single', max: 1, min: 1, required: true, mapping: 'first_last_frame' },
            { field: 'lastFrameUrl', kind: 'image', serialization: 'single', max: 1, mapping: 'first_last_frame' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183116',
    },
    {
        routeId: 'rhart-video/sparkvideo-2.0-fast/image-to-video',
        productModelId: 'flovart:seedance-2-fast',
        modes: ['image-to-video', 'first-last-frame'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'ratio',
        aspectRatioValues: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
        durationType: 'string',
        durationValues: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
        durationDefault: '5',
        resolutionDefault: '720p',
        params: [
            { field: 'generateAudio', type: 'boolean', default: true },
            { field: 'realPersonMode', type: 'boolean', default: true },
            { field: 'conversionSlots', type: 'string', default: 'all' },
            { field: 'returnLastFrame', type: 'boolean', default: false },
            { field: 'seed', type: 'number', default: -1 },
        ],
        media: [
            { field: 'firstFrameUrl', kind: 'image', serialization: 'single', max: 1, min: 1, required: true, mapping: 'first_last_frame' },
            { field: 'lastFrameUrl', kind: 'image', serialization: 'single', max: 1, mapping: 'first_last_frame' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183115',
    },
    {
        routeId: 'rhart-video/sparkvideo-2.0/multimodal-video',
        productModelId: 'flovart:seedance-2',
        modes: ['reference-to-video'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'ratio',
        aspectRatioValues: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
        durationType: 'string',
        durationValues: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
        durationDefault: '5',
        resolutionDefault: '720p',
        params: [
            { field: 'generateAudio', type: 'boolean', default: true },
            { field: 'realPersonMode', type: 'boolean', default: true },
            { field: 'conversionSlots', type: 'string', default: 'all' },
            { field: 'returnLastFrame', type: 'boolean', default: false },
            { field: 'seed', type: 'number', default: -1 },
        ],
        media: [
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 9, mapping: 'multimodal' },
            { field: 'videoUrls', kind: 'video', serialization: 'array', max: 3, mapping: 'multimodal' },
            { field: 'audioUrls', kind: 'audio', serialization: 'array', max: 3, mapping: 'multimodal' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183127',
    },
    {
        routeId: 'rhart-video-g-official/reference-to-video',
        productModelId: 'flovart:grok-imagine-video',
        modes: ['reference-to-video'],
        channelTier: 'official-stable',
        promptField: 'prompt',
        aspectRatioField: null,
        durationType: 'number',
        durationDefault: 5,
        resolutionDefault: '720p',
        params: [],
        media: [
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 7, min: 1, required: true, mapping: 'reference_images' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183126',
    },
    {
        routeId: 'rhart-video-g/text-to-video',
        productModelId: 'flovart:grok-imagine-video-1.5',
        modes: ['text-to-video'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: 'number',
        durationDefault: 6,
        resolutionDefault: '720p',
        params: [],
        media: [],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183149',
    },
    {
        routeId: 'rhart-video-v3.1-fast/text-to-video',
        productModelId: 'flovart:veo-3.1-fast',
        modes: ['text-to-video'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        durationType: 'string',
        durationValues: ['4', '6', '8'],
        durationDefault: '8',
        resolutionDefault: '720p',
        params: [],
        media: [],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183144',
    },
    {
        routeId: 'rhart-video-v3.1-lite-official/text-to-video',
        productModelId: 'flovart:veo-3.1-lite',
        modes: ['text-to-video'],
        channelTier: 'official-stable',
        promptField: 'prompt',
        aspectRatioField: 'aspectRatio',
        aspectRatioValues: ['16:9', '9:16'],
        durationType: 'string',
        durationValues: ['4', '6', '8'],
        durationDefault: '8',
        resolutionDefault: '720p',
        params: [],
        media: [],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183147',
    },
    {
        routeId: 'rhart-video/sparkvideo-2.0/text-to-video',
        productModelId: 'flovart:seedance-2',
        modes: ['text-to-video'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: 'ratio',
        aspectRatioValues: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
        durationType: 'string',
        durationValues: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
        durationDefault: '5',
        resolutionDefault: '720p',
        params: [
            { field: 'generateAudio', type: 'boolean', default: true },
            { field: 'webSearch', type: 'boolean', default: false },
            { field: 'realPersonMode', type: 'boolean', default: true },
            { field: 'conversionSlots', type: 'string', default: 'all' },
            { field: 'returnLastFrame', type: 'boolean', default: false },
            { field: 'seed', type: 'number', default: -1 },
        ],
        media: [],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183167',
    },
    // Seedance 2.5（Token 计费）：时长字符串最长 30s；2.0 / 2.0-fast 仍是 4–15s，按型号各自声明。
    {
        routeId: 'bytedance/seedance-2.5-token/text-to-video',
        productModelId: 'flovart:seedance-2.5',
        modes: ['text-to-video'],
        channelTier: 'official-stable',
        promptField: 'prompt',
        aspectRatioField: 'ratio',
        aspectRatioValues: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
        durationType: 'string',
        durationValues: SEEDANCE_25_DURATION_VALUES,
        durationDefault: '5',
        resolutionDefault: '720p',
        params: [
            { field: 'generateAudio', type: 'boolean', default: true },
            { field: 'webSearch', type: 'boolean', default: false },
            { field: 'returnLastFrame', type: 'boolean', default: false },
            { field: 'seed', type: 'number', default: -1 },
        ],
        media: [],
        officialEvidence: RH_DOC_EN + 'api-498749519',
    },
    {
        routeId: 'bytedance/seedance-2.5-token/image-to-video',
        productModelId: 'flovart:seedance-2.5',
        modes: ['image-to-video', 'first-last-frame'],
        channelTier: 'official-stable',
        promptField: 'prompt',
        aspectRatioField: 'ratio',
        aspectRatioValues: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
        durationType: 'string',
        durationValues: SEEDANCE_25_DURATION_VALUES,
        durationDefault: '5',
        resolutionDefault: '720p',
        params: [
            { field: 'generateAudio', type: 'boolean', default: true },
            { field: 'realPersonMode', type: 'boolean', default: true },
            { field: 'conversionSlots', type: 'string', default: 'all' },
            { field: 'returnLastFrame', type: 'boolean', default: false },
            { field: 'seed', type: 'number', default: -1 },
        ],
        media: [
            { field: 'firstFrameUrl', kind: 'image', serialization: 'single', max: 1, min: 1, required: true, mapping: 'first_last_frame' },
            { field: 'lastFrameUrl', kind: 'image', serialization: 'single', max: 1, mapping: 'first_last_frame' },
        ],
        officialEvidence: RH_DOC_EN + 'api-498749516',
    },
    {
        routeId: 'bytedance/seedance-2.5-token/multimodal-video',
        productModelId: 'flovart:seedance-2.5',
        modes: ['reference-to-video'],
        channelTier: 'official-stable',
        promptField: 'prompt',
        aspectRatioField: 'ratio',
        aspectRatioValues: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'],
        durationType: 'string',
        durationValues: SEEDANCE_25_DURATION_VALUES,
        durationDefault: '5',
        resolutionDefault: '720p',
        params: [
            { field: 'generateAudio', type: 'boolean', default: true },
            { field: 'realPersonMode', type: 'boolean', default: true },
            { field: 'conversionSlots', type: 'string', default: 'all' },
            { field: 'returnLastFrame', type: 'boolean', default: false },
            { field: 'seed', type: 'number', default: -1 },
        ],
        media: [
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 30, mapping: 'multimodal' },
            { field: 'videoUrls', kind: 'video', serialization: 'array', max: 10, mapping: 'multimodal' },
            { field: 'audioUrls', kind: 'audio', serialization: 'array', max: 10, mapping: 'multimodal' },
        ],
        officialEvidence: RH_DOC_EN + 'api-498749513',
    },
    {
        routeId: 'seedream-v4.5/text-to-image',
        productModelId: 'flovart:seedream-4.5',
        modes: ['text-to-image'],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: null,
        durationType: null,
        resolutionDefault: '2k',
        params: [
            { field: 'width', type: 'number', default: 2048 },
            { field: 'height', type: 'number', default: 2048 },
            { field: 'sequentialImageGeneration', type: 'string', default: 'disabled' },
            { field: 'maxImages', type: 'number', default: 1 },
        ],
        media: [],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183229',
    },
];

const ROUTE_MAP = new Map<string, RouteCapabilitySchema>(
    RUNNHUB_ROUTE_CATALOG.map(schema => [schema.routeId, schema]),
);

export function getRouteSchema(routeId: string): RouteCapabilitySchema | undefined {
    return ROUTE_MAP.get(routeId);
}

export function isVerifiedRoute(routeId: string): boolean {
    return ROUTE_MAP.has(routeId);
}

export function getRouteDurations(routeId: string): number[] | undefined {
    const schema = ROUTE_MAP.get(routeId);
    if (!schema || !schema.durationType) return undefined;
    if (schema.durationValues) {
        return schema.durationValues.map(v => Number(v)).filter(n => !isNaN(n));
    }
    if (schema.durationDefault !== undefined) {
        return [Number(schema.durationDefault)].filter(n => !isNaN(n));
    }
    return undefined;
}

export function getRouteCatalog(): RouteCapabilitySchema[] {
    return RUNNHUB_ROUTE_CATALOG;
}

const DOC_ID_TO_ROUTE_ID: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    for (const schema of RUNNHUB_ROUTE_CATALOG) {
        const docId = schema.officialEvidence.match(/api-(\d+)/)?.[1];
        if (docId) map[docId] = schema.routeId;
    }
    return map;
})();

export function resolveRouteIdByDocId(docId: string): string | undefined {
    return DOC_ID_TO_ROUTE_ID[docId];
}
