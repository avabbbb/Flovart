/**
 * RunningHub 动态线路能力（Route Capability Schema）。
 *
 * 唯一可信来源是 RunningHub 官方 API 文档：
 * - `llms.txt` 列出每个 API 文档（分类路径 + 标题 + api-NNN.md 链接）；
 * - 每个 `api-NNN.md` 内嵌 OpenAPI 3 YAML，`paths./openapi/v2/<endpoint>.post.requestBody` 给出精确字段。
 *
 * 本模块负责：解析 llms.txt / 文档 YAML → RouteCapabilitySchema（模式、媒体字段、比例/时长/分辨率枚举、数值约束），
 * 把同一模型家族的兄弟线路（`seedream-v5-flash/text-to-image` + `/image-to-image`）归为一个家族，
 * 并在内存 + localStorage（版本化、24h TTL）里缓存解析结果。前端不再为单个 RunningHub 模型手写能力配置；
 * runningHubRouteCatalog 里的静态表只作为离线兜底种子。
 *
 * 计费安全：只有从官方文档解析出的线路（source: 'docs'）才算「已核验」可执行；
 * 文档拿不到时按 endpoint 后缀推断的线路（source: 'inferred'）只用于展示，不会被自动映射或执行。
 */
import { parse as parseYaml } from 'yaml';
import type { ProductModelMode } from '../types';
import type { RouteCapabilitySchema, RouteMediaSpec, RouteParamSpec } from './runningHubRouteCatalog';

export type RunningHubDocSite = 'cn' | 'ai';

export interface RunningHubDocEntry {
    docId: string;
    url: string;
    title: string;
    category: string;
    description: string;
}

/** 动态线路：在 RouteCapabilitySchema 之上带出来源与家族信息。 */
export interface DynamicRouteSchema extends RouteCapabilitySchema {
    source: 'docs' | 'inferred';
    family: string;
    capability: 'image' | 'video';
    site?: RunningHubDocSite;
    docId?: string;
    title?: string;
    vendor?: string;
    description?: string;
}

const DOC_BASE: Record<RunningHubDocSite, string> = {
    cn: 'https://www.runninghub.cn/runninghub-api-doc-cn/',
    ai: 'https://www.runninghub.ai/runninghub-api-doc-en/',
};

export function runningHubDocSite(baseUrl?: string): RunningHubDocSite {
    const raw = String(baseUrl || '').trim().toLowerCase();
    let host = raw;
    try { host = new URL(raw).hostname; } catch { /* keep raw */ }
    return /(^|[./])runninghub\.ai([/:]|$)/.test(host) ? 'ai' : 'cn';
}

export function runningHubDocBaseUrl(site: RunningHubDocSite): string {
    return DOC_BASE[site];
}

// ── llms.txt ────────────────────────────────────────────────────────────────

/** 解析 llms.txt 中的 API 文档条目（只保留 api-NNN.md，忽略 doc-NNN 指南页）。 */
export function parseRunningHubLlmsTxt(text: string): RunningHubDocEntry[] {
    const entries: RunningHubDocEntry[] = [];
    const seen = new Set<string>();
    const re = /^-\s+(.*?)\[([^\]]+)\]\((https?:\/\/[^)\s]+\/(api-\d+)\.md)\)\s*:?\s*(.*)$/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
        const docId = match[4];
        if (seen.has(docId)) continue;
        seen.add(docId);
        entries.push({ docId, url: match[3], title: match[2].trim(), category: match[1].trim(), description: match[5].trim() });
    }
    return entries;
}

const EXCLUDED_CATEGORY = /音频|3D|video-tools|video-edit|video-extend|video-to-video|motion-control|audio-to-video|digital-human|image-tools|image-effects|reference-to-image/i;
const EXCLUDED_TITLE = /deprecated|已下线|3D|图层|拆分|分割|重拓扑|贴图|音色|语音|克隆|超分|放大|upscale|lora|对口型|lip-sync/i;

/** 是否可能是图片/视频生成接口（「其他」分类里也混有 Seedream 5 Flash 这类生成接口，交给文档 YAML 判定）。 */
export function isCandidateGenerationDoc(entry: RunningHubDocEntry): boolean {
    if (!/模型API|model api/i.test(entry.category)) return false;
    if (EXCLUDED_CATEGORY.test(entry.category)) return false;
    if (EXCLUDED_TITLE.test(entry.title)) return false;
    return /图像生成|视频生成|image|video|其他|other/i.test(entry.category);
}

// ── endpoint → 模式 / 家族 ─────────────────────────────────────────────────────

const MODE_TOKENS: Array<[string, ProductModelMode]> = [
    ['start-end-to-video', 'first-last-frame'],
    ['first-last-frame', 'first-last-frame'],
    ['start-to-end', 'first-last-frame'],
    ['multimodal-to-video', 'reference-to-video'],
    ['multimodal-video', 'reference-to-video'],
    ['reference-to-video', 'reference-to-video'],
    ['refrence-to-video', 'reference-to-video'],
    ['omni-reference', 'reference-to-video'],
    ['omni-video', 'reference-to-video'],
    ['image-to-video', 'image-to-video'],
    ['i2v', 'image-to-video'],
    ['text-to-video', 'text-to-video'],
    ['t2v', 'text-to-video'],
    ['image-to-image', 'image-to-image'],
    ['image-edit', 'image-to-image'],
    ['edit', 'image-to-image'],
    ['text-to-image', 'text-to-image'],
];

/** 这些线路需要 Iris 尚未建模的输入（视频编辑、LoRA、图层拆分…），不进入生成模型目录。 */
const EXCLUDED_SEGMENT = /video-edit|edit-video|extend|motion-control|layer-decomposition|upscale|upscaler|lora|draft|lip-sync|character|transition|super-resolution|enhance|to-3d|deprecated|-star\b|star-fast|audio-to-video|image-audio|regeneration|context-ir/i;

export const IMAGE_MODES: ProductModelMode[] = ['text-to-image', 'image-to-image'];
export const VIDEO_MODES: ProductModelMode[] = ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'];

function matchModeToken(segment: string): { token: string; mode: ProductModelMode; rest: string } | null {
    const seg = segment.toLowerCase();
    for (const [token, mode] of MODE_TOKENS) {
        if (seg === token) return { token, mode, rest: '' };
        if (seg.startsWith(`${token}-`)) return { token, mode, rest: segment.slice(token.length + 1) };
        if (seg.endsWith(`-${token}`)) return { token, mode, rest: segment.slice(0, segment.length - token.length - 1) };
    }
    return null;
}

/** endpoint 末段的模式词；不含模式词或是排除的工具类线路时返回 null。 */
export function modeFromEndpoint(routeId: string): ProductModelMode | null {
    const last = routeId.split('/').pop() || '';
    if (EXCLUDED_SEGMENT.test(last)) return null;
    return matchModeToken(last)?.mode ?? null;
}

/**
 * 家族 = 去掉末段模式词后的 endpoint：
 * `seedream-v5-flash/image-to-image` → `seedream-v5-flash`；`vidu/start-end-to-video-q2-pro` → `vidu/q2-pro`；
 * 末段没有模式词（`minimax/hailuo-02/fast`）时整条 endpoint 自成一个家族，避免把不同型号混为一谈。
 */
export function routeFamilyOf(routeId: string): string {
    const segments = routeId.split('/').filter(Boolean);
    const last = segments.pop() || '';
    const matched = EXCLUDED_SEGMENT.test(last) ? null : matchModeToken(last);
    if (!matched) return routeId;
    const family = [...segments, matched.rest.replace(/^-+|-+$/g, '')].filter(Boolean).join('/');
    return family || routeId;
}

function modeFromCategory(category: string): ProductModelMode | null {
    const c = category.toLowerCase();
    if (/(^|[/> ])text-to-image/.test(c)) return 'text-to-image';
    if (/(^|[/> ])image-to-image/.test(c)) return 'image-to-image';
    if (/(^|[/> ])reference-to-video/.test(c)) return 'reference-to-video';
    if (/(^|[/> ])image-to-video/.test(c)) return 'image-to-video';
    if (/(^|[/> ])text-to-video/.test(c)) return 'text-to-video';
    return null;
}

const capabilityOfMode = (mode: ProductModelMode): 'image' | 'video' => (IMAGE_MODES.includes(mode) ? 'image' : 'video');

// ── OpenAPI 文档解析 ─────────────────────────────────────────────────────────

type JsonSchema = {
    type?: string;
    format?: string;
    enum?: unknown[];
    default?: unknown;
    minimum?: number;
    maximum?: number;
    multipleOf?: number;
    minItems?: number;
    maxItems?: number;
    items?: JsonSchema;
    description?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    $ref?: string;
};

function extractYamlBlock(markdown: string): string | null {
    const match = markdown.match(/```ya?ml\s*\n([\s\S]*?)```/i);
    return match ? match[1] : null;
}

function resolveRef(doc: any, schema: JsonSchema | undefined): JsonSchema | undefined {
    let current = schema;
    for (let depth = 0; current?.$ref && depth < 5; depth += 1) {
        const path = current.$ref.replace(/^#\//, '').split('/');
        current = path.reduce<any>((node, key) => node?.[key], doc);
    }
    return current;
}

type MediaKind = RouteMediaSpec['kind'];

function mediaKindOf(field: string): MediaKind | null {
    const f = field.toLowerCase();
    if (/video/.test(f)) return 'video';
    if (/audio|voice|sound/.test(f)) return 'audio';
    if (/image|frame|img|picture|photo/.test(f)) return 'image';
    return null;
}

function isMediaProperty(field: string, prop: JsonSchema): boolean {
    if (!mediaKindOf(field)) return false;
    if (prop.type === 'array') {
        const itemType = prop.items?.type;
        if (itemType && itemType !== 'string') return false;
        return /urls$|^(ref|reference)?(images|videos|audios)$/i.test(field) || prop.items?.format === 'uri';
    }
    if (prop.type === 'string' || !prop.type) return /url$/i.test(field) || prop.format === 'uri';
    return false;
}

function rangeFromDescription(description?: string): { min?: number; max?: number } {
    const text = String(description || '');
    const range = text.match(/(\d+)\s*(?:到|至|~|～|-|—)\s*(\d+)\s*(?:张|个|段|条|images?|videos?|files?)/i);
    if (range) return { min: Number(range[1]), max: Number(range[2]) };
    const most = text.match(/(?:最多|至多|不超过|up to|at most|max(?:imum)?)\s*(\d+)/i);
    if (most) return { max: Number(most[1]) };
    return {};
}

const FIRST_FIELD = /^(first|start)/i;
const LAST_FIELD = /^(last|end)/i;
const ASPECT_FIELDS = ['aspectRatio', 'ratio', 'aspect_ratio'];
const PROMPT_FIELDS = ['prompt', 'text'];

function toParamType(type?: string): RouteParamSpec['type'] | null {
    if (type === 'string') return 'string';
    if (type === 'integer' || type === 'number') return 'number';
    if (type === 'boolean') return 'boolean';
    return null;
}

function primitiveDefault(value: unknown): string | number | boolean | undefined {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
}

function stringList(values?: unknown[]): string[] | undefined {
    if (!Array.isArray(values)) return undefined;
    const list = values.filter(v => typeof v === 'string' || typeof v === 'number').map(String);
    return list.length ? list : undefined;
}

function defaultFirst<T>(values: T[], def: unknown): T[] {
    const index = values.findIndex(value => String(value) === String(def));
    if (index <= 0) return values;
    return [values[index], ...values.slice(0, index), ...values.slice(index + 1)];
}

export interface ParseDocMeta {
    docId?: string;
    title?: string;
    category?: string;
    site?: RunningHubDocSite;
    url?: string;
}

/**
 * 把一个 RunningHub API 文档（markdown + 内嵌 OpenAPI YAML）解析为线路能力。
 * 无法安全执行的线路（无 prompt、工具类、必填字段无法由 Iris 提供、缺少模式所需媒体）返回 null。
 */
export function parseRunningHubApiDoc(markdown: string, meta: ParseDocMeta = {}): DynamicRouteSchema | null {
    const yamlText = extractYamlBlock(markdown);
    if (!yamlText) return null;
    let doc: any;
    try {
        doc = parseYaml(yamlText);
    } catch {
        return null;
    }
    const pathKey = Object.keys(doc?.paths || {}).find(key => key.startsWith('/openapi/v2/'));
    if (!pathKey) return null;
    const routeId = pathKey.slice('/openapi/v2/'.length).replace(/\/+$/, '');
    const post = doc.paths[pathKey]?.post;
    if (!post || post.deprecated === true) return null;
    const summary = String(post.summary || meta.title || '').trim();
    if (/deprecated|已下线|已废弃/i.test(`${routeId} ${summary}`)) return null;
    const tags: string[] = Array.isArray(post.tags) ? post.tags.map(String) : [];

    const schema = resolveRef(doc, post.requestBody?.content?.['application/json']?.schema);
    const properties = schema?.properties || {};
    const required = new Set<string>(Array.isArray(schema?.required) ? schema!.required : []);
    const promptField = PROMPT_FIELDS.find(field => properties[field]?.type === 'string');
    if (!promptField) return null;

    const generationTag = tags.find(tag => /生成与处理|generation/i.test(tag) && modeFromCategory(tag)) || '';
    const tokenMode = modeFromEndpoint(routeId);
    const lastSegment = routeId.split('/').pop() || '';
    if (EXCLUDED_SEGMENT.test(lastSegment)) return null;
    const primaryMode = tokenMode
        ?? (matchModeToken(lastSegment) ? null : modeFromCategory(generationTag) ?? modeFromCategory(meta.category || ''));
    if (!primaryMode) return null;
    const capability = capabilityOfMode(primaryMode);

    // 媒体字段
    type RawMedia = { field: string; kind: MediaKind; array: boolean; max: number; min?: number; required: boolean; role?: 'first' | 'last' };
    const rawMedia: RawMedia[] = [];
    for (const [field, rawProp] of Object.entries(properties)) {
        const prop = resolveRef(doc, rawProp) || {};
        if (!isMediaProperty(field, prop)) continue;
        const kind = mediaKindOf(field)!;
        const array = prop.type === 'array';
        const described = rangeFromDescription(prop.description);
        const max = array ? (prop.maxItems ?? described.max ?? 1) : 1;
        const isRequired = required.has(field);
        const min = array ? (prop.minItems ?? (isRequired ? (described.min ?? 1) : undefined)) : (isRequired ? 1 : undefined);
        const role = !array && kind === 'image' ? (FIRST_FIELD.test(field) ? 'first' : LAST_FIELD.test(field) ? 'last' : undefined) : undefined;
        rawMedia.push({ field, kind, array, max: Math.max(1, max), min: min && min > 0 ? min : undefined, required: isRequired, role });
    }

    // 模式细化 + 媒体映射
    let modes: ProductModelMode[] = [primaryMode];
    let media: RouteMediaSpec[] = [];
    const images = rawMedia.filter(m => m.kind === 'image');
    const nonImages = rawMedia.filter(m => m.kind !== 'image');
    const firstField = images.find(m => m.role === 'first');
    const lastField = images.find(m => m.role === 'last');
    const plainImage = images.find(m => !m.role);
    const spec = (m: RawMedia, mapping: RouteMediaSpec['mapping']): RouteMediaSpec => ({
        field: m.field,
        kind: m.kind,
        serialization: m.array ? 'array' : 'single',
        max: m.max,
        ...(m.min !== undefined ? { min: m.min } : {}),
        ...(m.required ? { required: true } : {}),
        mapping,
        ...(m.role ? { role: m.role } : {}),
    });

    if (primaryMode === 'text-to-image' || primaryMode === 'text-to-video') {
        media = [];
    } else if (primaryMode === 'image-to-image') {
        const target = images.find(m => m.array) || plainImage || firstField;
        if (!target) return null;
        media = [spec(target, target.array ? 'all_references' : 'first_frame_only')];
    } else if (primaryMode === 'first-last-frame' || (primaryMode === 'image-to-video' && firstField && lastField)) {
        const first = firstField || plainImage;
        if (!first || !lastField) {
            if (primaryMode === 'first-last-frame') return null;
        } else {
            media = [spec({ ...first, role: 'first' }, 'first_last_frame'), spec({ ...lastField, role: 'last' }, 'first_last_frame')];
            modes = primaryMode === 'first-last-frame' ? ['first-last-frame'] : ['image-to-video', 'first-last-frame'];
        }
    } else if (primaryMode === 'image-to-video') {
        const arrayImage = images.find(m => m.array);
        const single = firstField || plainImage;
        if (arrayImage) media = [spec(arrayImage, 'all_references')];
        else if (single) media = [spec(single, 'first_frame_only')];
        else return null;
    } else if (primaryMode === 'reference-to-video') {
        const multimodal = nonImages.length > 0;
        const refs = [...images.filter(m => m.array), ...images.filter(m => !m.array && !m.role), ...nonImages];
        if (refs.length === 0) return null;
        media = refs.map(m => spec(m, multimodal ? 'multimodal' : m.array ? 'reference_images' : 'first_frame_only'));
    }
    if (primaryMode === 'image-to-video' && media.length === 0) return null;

    // 必填媒体字段若没被映射，Iris 无法填充 → 不可执行
    const mappedFields = new Set(media.map(m => m.field));
    if (rawMedia.some(m => m.required && !mappedFields.has(m.field))) return null;

    // 比例 / 分辨率 / 时长
    const aspectRatioField = ASPECT_FIELDS.find(field => properties[field]) || null;
    const aspectProp = aspectRatioField ? resolveRef(doc, properties[aspectRatioField]) : undefined;
    const aspectValues = stringList(aspectProp?.enum);
    const resolutionProp = properties.resolution ? resolveRef(doc, properties.resolution) : undefined;
    const resolutionValues = stringList(resolutionProp?.enum);
    const resolutionDefault = resolutionProp
        ? (primitiveDefault(resolutionProp.default) !== undefined ? String(resolutionProp.default) : undefined)
        : undefined;
    const durationProp = properties.duration ? resolveRef(doc, properties.duration) : undefined;
    let durationType: RouteCapabilitySchema['durationType'] = null;
    let durationValues: (string | number)[] | undefined;
    let durationDefault: string | number | undefined;
    if (durationProp) {
        durationType = durationProp.type === 'string' ? 'string' : 'number';
        if (Array.isArray(durationProp.enum) && durationProp.enum.length) {
            durationValues = durationProp.enum
                .filter(v => typeof v === 'string' || typeof v === 'number')
                .map(v => (durationType === 'string' ? String(v) : Number(v)));
        } else if (typeof durationProp.minimum === 'number' && typeof durationProp.maximum === 'number'
            && durationProp.maximum >= durationProp.minimum && durationProp.maximum - durationProp.minimum <= 60) {
            const step = durationProp.multipleOf && durationProp.multipleOf >= 1 ? durationProp.multipleOf : 1;
            durationValues = [];
            for (let v = Math.ceil(durationProp.minimum); v <= durationProp.maximum; v += step) {
                durationValues.push(durationType === 'string' ? String(v) : v);
            }
        }
        const def = primitiveDefault(durationProp.default);
        if (def !== undefined) durationDefault = durationType === 'string' ? String(def) : Number(def);
    }

    // 其余基础参数：保留字段 + 数值约束；只有必填项与宽高带默认值（其余交给 RunningHub 自身默认）。
    const reserved = new Set<string>([promptField, ...rawMedia.map(m => m.field), 'resolution', 'duration', ...(aspectRatioField ? [aspectRatioField] : [])]);
    const params: RouteParamSpec[] = [];
    for (const [field, rawProp] of Object.entries(properties)) {
        if (reserved.has(field)) continue;
        const prop = resolveRef(doc, rawProp) || {};
        const type = toParamType(prop.type);
        const isRequired = required.has(field);
        if (!type) {
            if (isRequired) return null;
            continue;
        }
        let def = primitiveDefault(prop.default);
        if (def === undefined && isRequired && Array.isArray(prop.enum) && prop.enum.length) def = primitiveDefault(prop.enum[0]);
        if (isRequired && def === undefined) return null;
        const keepDefault = isRequired || field === 'width' || field === 'height';
        params.push({
            field,
            type,
            ...(keepDefault && def !== undefined ? { default: type === 'number' ? Number(def) : def } : {}),
            ...(isRequired ? { required: true } : {}),
            ...(typeof prop.minimum === 'number' ? { minimum: prop.minimum } : {}),
            ...(typeof prop.maximum === 'number' ? { maximum: prop.maximum } : {}),
            ...(typeof prop.multipleOf === 'number' ? { multipleOf: prop.multipleOf } : {}),
        });
    }

    const vendorTag = tags.map(tag => tag.split('/')).find(parts => parts.length >= 4 && modeFromCategory(parts.join('/')));
    const vendor = vendorTag?.[3]?.trim() || meta.category?.split('>').map(s => s.trim()).filter(Boolean)[3] || undefined;
    const isStandard = tags.some(tag => /^标准模型API|^standard/i.test(tag)) || /^标准模型API/.test(meta.category || '');
    const docUrl = meta.url || (meta.docId && meta.site ? `${DOC_BASE[meta.site]}${meta.docId}.md` : '');
    const description = String(post.description || '').replace(/\s+/g, ' ').trim().slice(0, 240);

    return {
        routeId,
        productModelId: `rh:${routeFamilyOf(routeId)}`,
        modes,
        channelTier: /official/i.test(routeId) ? 'official-stable' : isStandard ? 'official' : 'low-price',
        promptField,
        aspectRatioField,
        ...(aspectValues ? { aspectRatioValues: defaultFirst(aspectValues, aspectProp?.default) } : {}),
        durationType,
        ...(durationValues?.length ? { durationValues } : {}),
        ...(durationDefault !== undefined ? { durationDefault } : {}),
        ...(resolutionDefault ? { resolutionDefault } : {}),
        ...(resolutionValues ? { resolutionValues } : {}),
        params,
        media,
        officialEvidence: docUrl.replace(/\.md$/, ''),
        source: 'docs',
        family: routeFamilyOf(routeId),
        capability,
        ...(meta.site ? { site: meta.site } : {}),
        ...(meta.docId ? { docId: meta.docId } : {}),
        title: summary || meta.title || routeId,
        ...(vendor ? { vendor } : {}),
        ...(description ? { description } : {}),
    };
}

/**
 * 文档拿不到时的保守推断：只按 endpoint 后缀 / page-api categoryName 推断模式，媒体按通用 imageUrls 数组。
 * 标记为 source: 'inferred'，不计入已核验线路（不会被自动映射或执行）。
 */
export function inferRouteSchema(routeId: string, categoryName = ''): DynamicRouteSchema | null {
    const id = routeId.trim();
    if (!id) return null;
    const mode = modeFromEndpoint(id) ?? modeFromCategory(categoryName);
    if (!mode) return null;
    const needsImages = mode !== 'text-to-image' && mode !== 'text-to-video';
    const media: RouteMediaSpec[] = !needsImages ? []
        : mode === 'first-last-frame'
            ? [
                { field: 'firstFrameUrl', kind: 'image', serialization: 'single', max: 1, min: 1, required: true, mapping: 'first_last_frame', role: 'first' },
                { field: 'lastFrameUrl', kind: 'image', serialization: 'single', max: 1, mapping: 'first_last_frame', role: 'last' },
            ]
            : [{ field: 'imageUrls', kind: 'image', serialization: 'array', max: 1, min: 1, required: true, mapping: mode === 'reference-to-video' ? 'reference_images' : 'all_references' }];
    return {
        routeId: id,
        productModelId: `rh:${routeFamilyOf(id)}`,
        modes: [mode],
        channelTier: 'low-price',
        promptField: 'prompt',
        aspectRatioField: null,
        durationType: null,
        params: [],
        media,
        officialEvidence: '',
        source: 'inferred',
        family: routeFamilyOf(id),
        capability: capabilityOfMode(mode),
        title: id,
    };
}

// ── 家族展示名 ──────────────────────────────────────────────────────────────

const MODE_WORDS = /首尾帧生视频|首尾帧|文生图|图生图|图像编辑|图片编辑|文生视频|图生视频|参考生视频|参考图生视频|多模态视频|多模态生视频|全能参考|多模态|start-end-to-video|text-to-image|image-to-image|text-to-video|image-to-video|reference-to-video|multimodal-video|text to image|image to image|text to video|image to video|reference to video|first[- ]last[- ]frame/gi;

export function familyDisplayName(titles: string[], family: string): string {
    const counts = new Map<string, number>();
    for (const title of titles) {
        const cleaned = title.replace(MODE_WORDS, ' ').replace(/[\s_-]*\s[\s_-]*/g, ' ').replace(/^[\s_/-]+|[\s_/-]+$/g, '').trim();
        if (cleaned) counts.set(cleaned, (counts.get(cleaned) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0];
    return best || family;
}

// ── 注册表 + 缓存 ───────────────────────────────────────────────────────────

const CACHE_KEY = 'iris.runningHubDocRoutes.v1';
export const RUNNINGHUB_DOC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type SiteCache = {
    fetchedAt: number;
    /** docId → 解析结果（null 表示该文档不是可执行的生成线路，也缓存以免重复拉取）。 */
    docs: Record<string, { at: number; schema: DynamicRouteSchema | null }>;
};
type CacheShape = { version: 1; sites: Partial<Record<RunningHubDocSite, SiteCache>> };

let cache: CacheShape = { version: 1, sites: {} };
let registry = new Map<string, DynamicRouteSchema>();
let inferred = new Map<string, DynamicRouteSchema>();
let version = 0;
const listeners = new Set<() => void>();

function storage(): Storage | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

function rebuildRegistry() {
    const next = new Map<string, DynamicRouteSchema>();
    // cn 优先：同一 endpoint 两站都有时以国内站文档为准（国内站是默认站点）。
    for (const site of ['ai', 'cn'] as RunningHubDocSite[]) {
        for (const entry of Object.values(cache.sites[site]?.docs || {})) {
            if (entry.schema) next.set(entry.schema.routeId, entry.schema);
        }
    }
    registry = next;
}

function notify() {
    version += 1;
    for (const listener of [...listeners]) {
        try { listener(); } catch { /* listener errors must not break registry updates */ }
    }
}

function persist() {
    const store = storage();
    if (!store) return;
    try { store.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* quota — keep in memory */ }
}

/** 从 localStorage 恢复解析结果（模块加载时自动执行一次；过期条目仍可作离线兜底，刷新时再更新）。 */
export function loadCachedRunningHubRoutes(): void {
    const store = storage();
    if (!store) return;
    try {
        const raw = store.getItem(CACHE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as CacheShape;
        if (parsed?.version !== 1 || typeof parsed.sites !== 'object') return;
        cache = parsed;
        rebuildRegistry();
        notify();
    } catch { /* corrupt cache — ignore */ }
}

/** 直接登记解析好的线路（测试 / CLI / 已有解析结果时使用）。 */
export function registerRunningHubRouteSchemas(schemas: DynamicRouteSchema[], site: RunningHubDocSite = 'cn', at = Date.now()): void {
    const siteCache = cache.sites[site] || { fetchedAt: at, docs: {} };
    for (const schema of schemas) {
        const docId = schema.docId || `route:${schema.routeId}`;
        siteCache.docs[docId] = { at, schema: { ...schema, site: schema.site || site } };
    }
    siteCache.fetchedAt = at;
    cache.sites[site] = siteCache;
    rebuildRegistry();
    persist();
    notify();
}

/** 登记文档缺失时的推断线路（只展示，不核验）。 */
export function registerInferredRunningHubRoutes(models: Array<{ id: string; categoryName?: string }>): void {
    let changed = false;
    for (const model of models) {
        if (registry.has(model.id) || inferred.has(model.id)) continue;
        const schema = inferRouteSchema(model.id, model.categoryName);
        if (schema) { inferred.set(schema.routeId, schema); changed = true; }
    }
    if (changed) notify();
}

export function clearRunningHubDynamicRoutes(options: { persist?: boolean } = {}): void {
    cache = { version: 1, sites: {} };
    registry = new Map();
    inferred = new Map();
    if (options.persist !== false) {
        try { storage()?.removeItem(CACHE_KEY); } catch { /* ignore */ }
    }
    notify();
}

/** 文档解析出的（已核验）动态线路。 */
export function getDynamicRouteSchema(routeId: string): DynamicRouteSchema | undefined {
    return registry.get(routeId);
}

export function getInferredRouteSchema(routeId: string): DynamicRouteSchema | undefined {
    return registry.get(routeId) || inferred.get(routeId);
}

export function listDynamicRouteSchemas(site?: RunningHubDocSite): DynamicRouteSchema[] {
    const all = [...registry.values()];
    return site ? all.filter(schema => !schema.site || schema.site === site) : all;
}

export function hasDynamicRoutesForSite(site: RunningHubDocSite): boolean {
    return Object.values(cache.sites[site]?.docs || {}).some(entry => entry.schema);
}

export function getRunningHubRoutesVersion(): number {
    return version;
}

export function subscribeRunningHubRoutes(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

// ── 拉取 ───────────────────────────────────────────────────────────────────

export type DocTextFetcher = (url: string, signal?: AbortSignal) => Promise<string>;

function isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
}

/** 浏览器经同源代理 `/api/llm-proxy/<host>/<path>`（文档不支持 CORS）；桌面端先直连；Node 直连。 */
export function runningHubDocProxyUrl(url: string): string {
    const parsed = new URL(url);
    return `/api/llm-proxy/${parsed.hostname}${parsed.pathname}`;
}

async function fetchTextOk(url: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
}

export const defaultDocTextFetcher: DocTextFetcher = async (url, signal) => {
    if (typeof window === 'undefined') return fetchTextOk(url, signal);
    if (isTauriRuntime()) {
        try {
            return await fetchTextOk(url, signal);
        } catch (error) {
            if (signal?.aborted) throw error;
            const { fetchRemoteMediaBlob } = await import('./desktopNetwork');
            return (await fetchRemoteMediaBlob(url, { signal, fallbackMimeType: 'text/plain' })).text();
        }
    }
    return fetchTextOk(runningHubDocProxyUrl(url), signal);
};

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>, signal?: AbortSignal) {
    let index = 0;
    const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (index < items.length && !signal?.aborted) {
            const item = items[index++];
            await worker(item);
        }
    });
    await Promise.all(runners);
}

export interface RefreshRunningHubDocRoutesOptions {
    baseUrl?: string;
    site?: RunningHubDocSite;
    /** 忽略站点级 24h 新鲜度，重新拉取 llms.txt（24h 内解析过的单个文档仍复用）。 */
    force?: boolean;
    /** 连同单个文档缓存一起全部重新解析。 */
    reparseAll?: boolean;
    concurrency?: number;
    fetchText?: DocTextFetcher;
    signal?: AbortSignal;
    /** 测试用：覆盖当前时间。 */
    now?: number;
}

export interface RefreshRunningHubDocRoutesResult {
    ok: boolean;
    site: RunningHubDocSite;
    fromCache: boolean;
    parsed: number;
    failed: number;
    routes: DynamicRouteSchema[];
    error?: string;
}

const inflight = new Map<RunningHubDocSite, Promise<RefreshRunningHubDocRoutesResult>>();

/**
 * 拉取 llms.txt → 并发拉取生成类 API 文档（默认 8 并发）→ 解析并登记。
 * 24h 内已解析的文档直接复用；单个文档失败不影响其它文档。
 */
export function refreshRunningHubDocRoutes(options: RefreshRunningHubDocRoutesOptions = {}): Promise<RefreshRunningHubDocRoutesResult> {
    const site = options.site || runningHubDocSite(options.baseUrl);
    const running = inflight.get(site);
    if (running && !options.force) return running;
    const task = doRefresh(site, options).finally(() => inflight.delete(site));
    inflight.set(site, task);
    return task;
}

async function doRefresh(site: RunningHubDocSite, options: RefreshRunningHubDocRoutesOptions): Promise<RefreshRunningHubDocRoutesResult> {
    const now = options.now ?? Date.now();
    const fetchText = options.fetchText || defaultDocTextFetcher;
    const siteCache = cache.sites[site];
    const fresh = siteCache && now - siteCache.fetchedAt < RUNNINGHUB_DOC_CACHE_TTL_MS;
    if (fresh && !options.force) {
        return { ok: true, site, fromCache: true, parsed: 0, failed: 0, routes: listDynamicRouteSchemas(site) };
    }
    let entries: RunningHubDocEntry[];
    try {
        entries = parseRunningHubLlmsTxt(await fetchText(`${DOC_BASE[site]}llms.txt`, options.signal)).filter(isCandidateGenerationDoc);
    } catch (error) {
        return { ok: false, site, fromCache: Boolean(siteCache), parsed: 0, failed: 0, routes: listDynamicRouteSchemas(site), error: error instanceof Error ? error.message : String(error) };
    }
    const nextDocs: SiteCache['docs'] = {};
    const pending: RunningHubDocEntry[] = [];
    for (const entry of entries) {
        const cached = siteCache?.docs[entry.docId];
        if (cached && !options.reparseAll && now - cached.at < RUNNINGHUB_DOC_CACHE_TTL_MS) nextDocs[entry.docId] = cached;
        else pending.push(entry);
    }
    let parsed = 0;
    let failed = 0;
    await mapWithConcurrency(pending, options.concurrency ?? 8, async entry => {
        try {
            const markdown = await fetchText(entry.url, options.signal);
            nextDocs[entry.docId] = { at: now, schema: parseRunningHubApiDoc(markdown, { docId: entry.docId, title: entry.title, category: entry.category, site, url: entry.url }) };
            parsed += 1;
        } catch {
            failed += 1;
            // 拉取失败：保留旧的解析结果（过期也比没有强）。
            const previous = siteCache?.docs[entry.docId];
            if (previous) nextDocs[entry.docId] = previous;
        }
    }, options.signal);
    // 全部失败时不覆盖旧缓存的时间戳，下次继续尝试。
    const allFailed = pending.length > 0 && parsed === 0;
    cache.sites[site] = { fetchedAt: allFailed ? (siteCache?.fetchedAt ?? 0) : now, docs: nextDocs };
    rebuildRegistry();
    persist();
    notify();
    return { ok: !allFailed, site, fromCache: false, parsed, failed, routes: listDynamicRouteSchemas(site) };
}

loadCachedRunningHubRoutes();
