import type { ProductModelMode } from '../types';
import { getDynamicRouteSchema, getRunningHubRoutesVersion, listDynamicRouteSchemas, routeFamilyOf } from './runningHubDynamicRoutes';

export type RouteParamType = 'string' | 'number' | 'boolean';

export interface RouteParamSpec {
    field: string;
    type: RouteParamType;
    default?: string | number | boolean;
    required?: boolean;
    /** 数值参数的官方约束（来自 RunningHub 文档 OpenAPI schema）。 */
    minimum?: number;
    maximum?: number;
    multipleOf?: number;
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
    /** first_last_frame 映射下该字段承载首帧还是尾帧；缺省时按 firstFrameUrl / lastFrameUrl 推断。 */
    role?: 'first' | 'last';
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
    /** 官方 resolution 枚举（动态文档解析得到；静态兜底种子可省略）。 */
    resolutionValues?: string[];
    params: RouteParamSpec[];
    media: RouteMediaSpec[];
    officialEvidence: string;
    /** 'docs' = 从 RunningHub 官方文档解析；'fallback' = 离线兜底种子；'inferred' 不会出现在已核验目录里。 */
    source?: 'docs' | 'fallback' | 'inferred';
    /** 同一模型家族（去掉模式后缀的 endpoint），兄弟线路按模式切换。 */
    family?: string;
    capability?: 'image' | 'video';
    site?: 'cn' | 'ai';
    title?: string;
    vendor?: string;
    description?: string;
}

/**
 * 离线兜底种子（FALLBACK SEED）。
 * RunningHub 线路能力的唯一可信来源是官方文档（见 runningHubDynamicRoutes：llms.txt + api-NNN.md 的 OpenAPI schema），
 * 「获取模型」时动态解析并缓存。这里只保留少量历史上已核验、且被静态产品卡（Seedance / Veo / GPT Image …）引用的线路，
 * 用于首次启动 / 文档不可达时保持可用；同一 routeId 一旦有文档解析结果，以文档为准。
 */
/** RunningHub 英文文档前缀（按文档 id 拼接引用）。 */
const RH_DOC_EN = ['https:', '', ['www', 'runninghub', 'ai'].join('.'), 'runninghub-api-doc-en', ''].join('/');
/** Seedance 2.5 官方时长：4–30s 的整数秒字符串。 */
const SEEDANCE_25_DURATION_VALUES: string[] = Array.from({ length: 27 }, (_, i) => String(i + 4));
const FALLBACK_ROUTE_SEED: RouteCapabilitySchema[] = [
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
        // 国内站可用（2026-11-15 实测）；GPT / Gemini / 悠船等海外模型在 CN 节点返回 40310。
        routeId: 'seedream-v5-flash/text-to-image',
        productModelId: 'flovart:seedream-5-flash',
        modes: ['text-to-image'],
        channelTier: 'official',
        promptField: 'prompt',
        aspectRatioField: null,
        durationType: null,
        // 官方 schema：resolution 优先级高于 width/height，传了 resolution 就不再用宽高像素。
        // 有比例时网关会去掉 resolution、只发精确宽高（见 aiGateway sizeFromAspectRatio）。
        resolutionDefault: '2k',
        params: [
            { field: 'width', type: 'number', default: 2048, minimum: 240, maximum: 8192, multipleOf: 1 },
            { field: 'height', type: 'number', default: 2048, minimum: 240, maximum: 8192, multipleOf: 1 },
            { field: 'outputFormat', type: 'string', default: 'jpeg' },
        ],
        media: [],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-519905082',
    },
    {
        // 与文生图同一模型；官方 1–10 张参考图（主体保持 / 局部改绘 / 多图融合），参考图不另收费。
        routeId: 'seedream-v5-flash/image-to-image',
        productModelId: 'flovart:seedream-5-flash',
        modes: ['image-to-image'],
        channelTier: 'official',
        promptField: 'prompt',
        aspectRatioField: null,
        durationType: null,
        resolutionDefault: '2k',
        params: [
            { field: 'width', type: 'number', default: 2048, minimum: 240, maximum: 8192, multipleOf: 1 },
            { field: 'height', type: 'number', default: 2048, minimum: 240, maximum: 8192, multipleOf: 1 },
            { field: 'outputFormat', type: 'string', default: 'jpeg' },
        ],
        media: [
            { field: 'imageUrls', kind: 'image', serialization: 'array', max: 10, min: 1, required: true, mapping: 'all_references' },
        ],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-519905081',
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
            { field: 'width', type: 'number', default: 2048, minimum: 512, maximum: 8192, multipleOf: 8 },
            { field: 'height', type: 'number', default: 2048, minimum: 512, maximum: 8192, multipleOf: 8 },
            { field: 'sequentialImageGeneration', type: 'string', default: 'disabled' },
            { field: 'maxImages', type: 'number', default: 1 },
        ],
        media: [],
        officialEvidence: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-448183229',
    },
];

const FALLBACK_MAP = new Map<string, RouteCapabilitySchema>(
    FALLBACK_ROUTE_SEED.map(schema => [schema.routeId, { ...schema, source: 'fallback' as const, family: routeFamilyOf(schema.routeId) }]),
);

/**
 * 家族归属：兜底种子里已绑定静态产品卡的家族，其动态兄弟线路沿用同一产品卡
 * （例如 seedream-v5-flash/* → flovart:seedream-5-flash，rhart-video/sparkvideo-2.0/* → flovart:seedance-2），
 * 其余家族生成动态产品卡 rh:<family>；同一家族同时有图片与视频线路时按能力拆成 rh:<family>@image / @video。
 */
const ADOPTED_FAMILY_PRODUCT = new Map<string, string>(
    FALLBACK_ROUTE_SEED.map(schema => [routeFamilyOf(schema.routeId), schema.productModelId]),
);

function capabilityOfSchema(schema: RouteCapabilitySchema): 'image' | 'video' {
    return schema.capability || (schema.modes.some(mode => mode === 'text-to-image' || mode === 'image-to-image') ? 'image' : 'video');
}

let catalogMemo: { version: number; list: RouteCapabilitySchema[]; map: Map<string, RouteCapabilitySchema> } | null = null;

function mergedCatalog() {
    const version = getRunningHubRoutesVersion();
    if (catalogMemo?.version === version) return catalogMemo;
    const dynamic = listDynamicRouteSchemas();
    const capsByFamily = new Map<string, Set<string>>();
    for (const schema of dynamic) {
        const family = schema.family || routeFamilyOf(schema.routeId);
        capsByFamily.set(family, (capsByFamily.get(family) || new Set()).add(capabilityOfSchema(schema)));
    }
    const productIdFor = (schema: RouteCapabilitySchema) => {
        const family = schema.family || routeFamilyOf(schema.routeId);
        const adopted = ADOPTED_FAMILY_PRODUCT.get(family);
        if (adopted) return adopted;
        const mixed = (capsByFamily.get(family)?.size || 0) > 1;
        return mixed ? `rh:${family}@${capabilityOfSchema(schema)}` : `rh:${family}`;
    };
    const map = new Map<string, RouteCapabilitySchema>();
    for (const schema of dynamic) {
        const fallback = FALLBACK_MAP.get(schema.routeId);
        // 兜底种子已绑定静态产品时保持原产品归属，能力字段以文档为准。
        map.set(schema.routeId, { ...schema, productModelId: fallback?.productModelId || productIdFor(schema) });
    }
    for (const [routeId, schema] of FALLBACK_MAP) {
        if (!map.has(routeId)) map.set(routeId, schema);
    }
    catalogMemo = { version, list: [...map.values()], map };
    return catalogMemo;
}

export function getRouteSchema(routeId: string): RouteCapabilitySchema | undefined {
    const id = routeId.trim();
    if (!id) return undefined;
    if (getDynamicRouteSchema(id)) return mergedCatalog().map.get(id);
    return FALLBACK_MAP.get(id);
}

/** 已核验 = 官方文档解析得到（source: 'docs'）或离线兜底种子；按后缀推断的线路不算。 */
export function isVerifiedRoute(routeId: string): boolean {
    const id = routeId.trim();
    return Boolean(id) && (Boolean(getDynamicRouteSchema(id)) || FALLBACK_MAP.has(id));
}

export function getRouteDurations(routeId: string): number[] | undefined {
    const schema = getRouteSchema(routeId);
    if (!schema || !schema.durationType) return undefined;
    if (schema.durationValues) {
        return schema.durationValues.map(v => Number(v)).filter(n => !isNaN(n));
    }
    if (schema.durationDefault !== undefined) {
        return [Number(schema.durationDefault)].filter(n => !isNaN(n));
    }
    return undefined;
}

/** 当前全部已核验线路：动态文档线路优先，兜底种子补齐。 */
export function getRouteCatalog(): RouteCapabilitySchema[] {
    return mergedCatalog().list;
}

/** 离线兜底种子（只读）；测试与迁移使用。 */
export function getFallbackRouteSeed(): RouteCapabilitySchema[] {
    return [...FALLBACK_MAP.values()];
}

export function resolveRouteIdByDocId(docId: string): string | undefined {
    const id = docId.replace(/^api-/, '');
    for (const schema of getRouteCatalog()) {
        if (schema.officialEvidence.match(/api-(\d+)/)?.[1] === id) return schema.routeId;
    }
    return undefined;
}
