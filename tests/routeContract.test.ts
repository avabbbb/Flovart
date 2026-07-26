/**
 * Route Contract Tests — RunningHub 已验证 Route 的契约验证
 * 每条 Route 验证 endpoint、字段名、字段类型、默认值、媒体角色与数量限制。
 * 依据：docs/dev/runninghub-route-catalog.md + docs/adr/0006
 */
import { describe, it, expect } from 'vitest';
import {
    getRouteCatalog,
    getRouteSchema,
    isVerifiedRoute,
    getRouteDurations,
    resolveRouteIdByDocId,
    type RouteCapabilitySchema,
} from '../services/runningHubRouteCatalog';
import { getEffectiveReferenceLimits } from '../services/productModelCatalog';

const CATALOG = getRouteCatalog();

const ROUTE_IDS = CATALOG.map(r => r.routeId);

const IMAGE_ROUTES = ROUTE_IDS.filter(id => !id.startsWith('rhart-video') && !id.includes('sparkvideo'));
const VIDEO_ROUTES = ROUTE_IDS.filter(id => id.startsWith('rhart-video') || id.includes('sparkvideo'));

function schemaOf(routeId: string): RouteCapabilitySchema {
    const s = getRouteSchema(routeId);
    if (!s) throw new Error(`Route ${routeId} not found in catalog`);
    return s;
}

function paramFields(schema: RouteCapabilitySchema): Set<string> {
    return new Set(schema.params.map(p => p.field));
}

function mediaFields(schema: RouteCapabilitySchema): Set<string> {
    return new Set(schema.media.map(m => m.field));
}

describe('Route Catalog — structural integrity', () => {
    it('drives @ media limits for every verified product route and mode', () => {
        for (const schema of CATALOG) {
            const expected = schema.media.reduce((limits, spec) => ({ ...limits, [spec.kind]: limits[spec.kind] + spec.max }), { image: 0, video: 0, audio: 0 });
            for (const mode of schema.modes) {
                expect(getEffectiveReferenceLimits(schema.productModelId, mode, { provider: 'runningHub', routeId: schema.routeId }), `${schema.routeId} ${mode}`).toEqual(expected);
            }
        }
    });

    it('contains exactly 17 routes', () => {
        expect(CATALOG).toHaveLength(17);
    });

    it('every routeId is unique', () => {
        const ids = CATALOG.map(r => r.routeId);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every officialEvidence URL is a valid RunningHub doc link', () => {
        for (const route of CATALOG) {
            expect(route.officialEvidence).toMatch(/^https:\/\/www\.runninghub\.cn\/runninghub-api-doc-cn\/api-\d+$/);
        }
    });

    it('contains 6 image routes and 11 video routes', () => {
        expect(IMAGE_ROUTES).toHaveLength(6);
        expect(VIDEO_ROUTES).toHaveLength(11);
    });
});

describe('Route Catalog — isVerifiedRoute', () => {
    it('returns true for every catalog routeId', () => {
        for (const id of ROUTE_IDS) {
            expect(isVerifiedRoute(id)).toBe(true);
        }
    });

    it('returns false for unknown route IDs', () => {
        expect(isVerifiedRoute('rhart-video-unknown/text-to-video')).toBe(false);
        expect(isVerifiedRoute('')).toBe(false);
        expect(isVerifiedRoute('random-endpoint')).toBe(false);
    });
});

describe('Route Catalog — resolveRouteIdByDocId', () => {
    it('resolves every route\'s official evidence doc ID back to its routeId', () => {
        for (const route of CATALOG) {
            const docId = route.officialEvidence.match(/api-(\d+)/)?.[1];
            expect(docId).toBeTruthy();
            expect(resolveRouteIdByDocId(docId!)).toBe(route.routeId);
        }
    });

    it('returns undefined for unknown doc IDs', () => {
        expect(resolveRouteIdByDocId('000000000')).toBeUndefined();
        expect(resolveRouteIdByDocId('')).toBeUndefined();
    });
});

describe('Route Catalog — getRouteDurations', () => {
    it('returns undefined for image routes (no duration)', () => {
        for (const id of IMAGE_ROUTES) {
            expect(getRouteDurations(id)).toBeUndefined();
        }
    });

    it('returns numeric durations for all video routes', () => {
        for (const id of VIDEO_ROUTES) {
            const durations = getRouteDurations(id);
            expect(durations).toBeDefined();
            expect(durations!.length).toBeGreaterThan(0);
            for (const d of durations!) {
                expect(typeof d).toBe('number');
                expect(d).toBeGreaterThan(0);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Image Route Contracts (6)
// ---------------------------------------------------------------------------

describe('Image Route — youchuan/text-to-image-v81 (Midjourney v8.1)', () => {
    const s = schemaOf('youchuan/text-to-image-v81');
    it('maps to flovart:midjourney-v8-1 with text-to-image mode', () => {
        expect(s.productModelId).toBe('flovart:midjourney-v8-1');
        expect(s.modes).toEqual(['text-to-image']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses "prompt" as prompt field and has no aspectRatio field', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBeNull();
    });
    it('has no duration fields', () => {
        expect(s.durationType).toBeNull();
        expect(s.durationDefault).toBeUndefined();
    });
    it('declares hd boolean param defaulting to false', () => {
        expect(paramFields(s)).toContain('hd');
        const hd = s.params.find(p => p.field === 'hd')!;
        expect(hd.type).toBe('boolean');
        expect(hd.default).toBe(false);
    });
    it('uses imageUrl single field with first_frame_only mapping', () => {
        expect(s.media).toHaveLength(1);
        const m = s.media[0];
        expect(m.field).toBe('imageUrl');
        expect(m.kind).toBe('image');
        expect(m.serialization).toBe('single');
        expect(m.max).toBe(1);
        expect(m.mapping).toBe('first_frame_only');
    });
    it('links to official evidence 454760438', () => {
        expect(s.officialEvidence).toContain('454760438');
    });
});

describe('Image Route — rhart-image-n-pro/edit (Gemini 3.0 Pro Image)', () => {
    const s = schemaOf('rhart-image-n-pro/edit');
    it('maps to flovart:gemini-3-pro-image with image-to-image mode', () => {
        expect(s.productModelId).toBe('flovart:gemini-3-pro-image');
        expect(s.modes).toEqual(['image-to-image']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('defaults resolution to 1k', () => {
        expect(s.resolutionDefault).toBe('1k');
    });
    it('has no duration fields', () => {
        expect(s.durationType).toBeNull();
    });
    it('has no extra params', () => {
        expect(s.params).toHaveLength(0);
    });
    it('requires imageUrls array with all_references mapping, max 10, min 1', () => {
        expect(s.media).toHaveLength(1);
        const m = s.media[0];
        expect(m.field).toBe('imageUrls');
        expect(m.kind).toBe('image');
        expect(m.serialization).toBe('array');
        expect(m.max).toBe(10);
        expect(m.min).toBe(1);
        expect(m.required).toBe(true);
        expect(m.mapping).toBe('all_references');
    });
    it('links to official evidence 448183220', () => {
        expect(s.officialEvidence).toContain('448183220');
    });
});

describe('Image Route — rhart-image-g-2/image-to-image (GPT Image 2)', () => {
    const s = schemaOf('rhart-image-g-2/image-to-image');
    it('maps to flovart:gpt-image-2 with image-to-image mode', () => {
        expect(s.productModelId).toBe('flovart:gpt-image-2');
        expect(s.modes).toEqual(['image-to-image']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('defaults resolution to 1k', () => {
        expect(s.resolutionDefault).toBe('1k');
    });
    it('has no duration fields', () => {
        expect(s.durationType).toBeNull();
    });
    it('has no extra params', () => {
        expect(s.params).toHaveLength(0);
    });
    it('requires imageUrls array with all_references mapping, max 10, min 1', () => {
        expect(s.media).toHaveLength(1);
        const m = s.media[0];
        expect(m.field).toBe('imageUrls');
        expect(m.kind).toBe('image');
        expect(m.serialization).toBe('array');
        expect(m.max).toBe(10);
        expect(m.min).toBe(1);
        expect(m.required).toBe(true);
        expect(m.mapping).toBe('all_references');
    });
    it('links to official evidence 448183227', () => {
        expect(s.officialEvidence).toContain('448183227');
    });
});

describe('Image Route — rhart-image-n-g31-flash/image-to-image (Gemini 3.1 Flash Image)', () => {
    const s = schemaOf('rhart-image-n-g31-flash/image-to-image');
    it('maps to flovart:gemini-3.1-flash-image with image-to-image mode', () => {
        expect(s.productModelId).toBe('flovart:gemini-3.1-flash-image');
        expect(s.modes).toEqual(['image-to-image']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('defaults resolution to 1k', () => {
        expect(s.resolutionDefault).toBe('1k');
    });
    it('has no duration fields', () => {
        expect(s.durationType).toBeNull();
    });
    it('has no extra params', () => {
        expect(s.params).toHaveLength(0);
    });
    it('requires imageUrls array with all_references mapping, max 10, min 1', () => {
        expect(s.media).toHaveLength(1);
        const m = s.media[0];
        expect(m.field).toBe('imageUrls');
        expect(m.kind).toBe('image');
        expect(m.serialization).toBe('array');
        expect(m.max).toBe(10);
        expect(m.min).toBe(1);
        expect(m.required).toBe(true);
        expect(m.mapping).toBe('all_references');
    });
    it('links to official evidence 448183223', () => {
        expect(s.officialEvidence).toContain('448183223');
    });
});

describe('Image Route — rhart-image-n-g31-flash/text-to-image (Gemini 3.1 Flash Image)', () => {
    const s = schemaOf('rhart-image-n-g31-flash/text-to-image');
    it('maps to flovart:gemini-3.1-flash-image with text-to-image mode', () => {
        expect(s.productModelId).toBe('flovart:gemini-3.1-flash-image');
        expect(s.modes).toEqual(['text-to-image']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('defaults resolution to 1k', () => {
        expect(s.resolutionDefault).toBe('1k');
    });
    it('has no duration fields', () => {
        expect(s.durationType).toBeNull();
    });
    it('has no extra params', () => {
        expect(s.params).toHaveLength(0);
    });
    it('has no media specs (text-to-image)', () => {
        expect(s.media).toHaveLength(0);
    });
    it('links to official evidence 448183261', () => {
        expect(s.officialEvidence).toContain('448183261');
    });
});

describe('Image Route — rhart-image-g-2/text-to-image (GPT Image 2)', () => {
    const s = schemaOf('rhart-image-g-2/text-to-image');
    it('maps to flovart:gpt-image-2 with text-to-image mode', () => {
        expect(s.productModelId).toBe('flovart:gpt-image-2');
        expect(s.modes).toEqual(['text-to-image']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('defaults resolution to 1k', () => {
        expect(s.resolutionDefault).toBe('1k');
    });
    it('has no duration fields', () => {
        expect(s.durationType).toBeNull();
    });
    it('has no extra params', () => {
        expect(s.params).toHaveLength(0);
    });
    it('has no media specs (text-to-image)', () => {
        expect(s.media).toHaveLength(0);
    });
    it('links to official evidence 448183264', () => {
        expect(s.officialEvidence).toContain('448183264');
    });
});

// ---------------------------------------------------------------------------
// Video Route Contracts (11)
// ---------------------------------------------------------------------------

describe('Video Route — rhart-video-v3.1-fast/image-to-video (Veo 3.1 Fast)', () => {
    const s = schemaOf('rhart-video-v3.1-fast/image-to-video');
    it('maps to flovart:veo-3.1-fast with image-to-video mode', () => {
        expect(s.productModelId).toBe('flovart:veo-3.1-fast');
        expect(s.modes).toEqual(['image-to-video']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('has string duration with values 4/6/8 and default 8', () => {
        expect(s.durationType).toBe('string');
        expect(s.durationValues).toEqual(['4', '6', '8']);
        expect(s.durationDefault).toBe('8');
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('has no extra params (no generateAudio for Veo fast)', () => {
        expect(s.params).toHaveLength(0);
    });
    it('requires imageUrls array with all_references mapping, max 3, min 1', () => {
        expect(s.media).toHaveLength(1);
        const m = s.media[0];
        expect(m.field).toBe('imageUrls');
        expect(m.kind).toBe('image');
        expect(m.serialization).toBe('array');
        expect(m.max).toBe(3);
        expect(m.min).toBe(1);
        expect(m.required).toBe(true);
        expect(m.mapping).toBe('all_references');
    });
    it('links to official evidence 448183087', () => {
        expect(s.officialEvidence).toContain('448183087');
    });
});

describe('Video Route — rhart-video-v3.1-fast/start-end-to-video (Veo 3.1 Fast)', () => {
    const s = schemaOf('rhart-video-v3.1-fast/start-end-to-video');
    it('maps to flovart:veo-3.1-fast with first-last-frame mode', () => {
        expect(s.productModelId).toBe('flovart:veo-3.1-fast');
        expect(s.modes).toEqual(['first-last-frame']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('has string duration with only value 8 and default 8', () => {
        expect(s.durationType).toBe('string');
        expect(s.durationValues).toEqual(['8']);
        expect(s.durationDefault).toBe('8');
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('has no extra params', () => {
        expect(s.params).toHaveLength(0);
    });
    it('requires firstFrameUrl and optional lastFrameUrl with first_last_frame mapping', () => {
        expect(s.media).toHaveLength(2);
        const first = s.media.find(m => m.field === 'firstFrameUrl')!;
        expect(first.kind).toBe('image');
        expect(first.serialization).toBe('single');
        expect(first.max).toBe(1);
        expect(first.min).toBe(1);
        expect(first.required).toBe(true);
        expect(first.mapping).toBe('first_last_frame');
        const last = s.media.find(m => m.field === 'lastFrameUrl')!;
        expect(last.kind).toBe('image');
        expect(last.serialization).toBe('single');
        expect(last.max).toBe(1);
        expect(last.required).toBeFalsy();
        expect(last.mapping).toBe('first_last_frame');
    });
    it('links to official evidence 448183086', () => {
        expect(s.officialEvidence).toContain('448183086');
    });
});

describe('Video Route — rhart-video-g/image-to-video (Grok Imagine Video)', () => {
    const s = schemaOf('rhart-video-g/image-to-video');
    it('maps to flovart:grok-imagine-video-1.5 with image-to-video mode', () => {
        expect(s.productModelId).toBe('flovart:grok-imagine-video-1.5');
        expect(s.modes).toEqual(['image-to-video']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('has number duration with current documented default 6', () => {
        expect(s.durationType).toBe('number');
        expect(s.durationDefault).toBe(6);
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('has no extra params', () => {
        expect(s.params).toHaveLength(0);
    });
    it('requires imageUrls array with all_references mapping, max 10, min 1', () => {
        expect(s.media).toHaveLength(1);
        const m = s.media[0];
        expect(m.field).toBe('imageUrls');
        expect(m.kind).toBe('image');
        expect(m.serialization).toBe('array');
        expect(m.max).toBe(10);
        expect(m.min).toBe(1);
        expect(m.required).toBe(true);
        expect(m.mapping).toBe('all_references');
    });
    it('links to official evidence 448183102', () => {
        expect(s.officialEvidence).toContain('448183102');
    });
});

describe('Video Route — rhart-video/sparkvideo-2.0/image-to-video (Seedance 2.0)', () => {
    const s = schemaOf('rhart-video/sparkvideo-2.0/image-to-video');
    it('maps to flovart:seedance-2 with image-to-video and first-last-frame modes', () => {
        expect(s.productModelId).toBe('flovart:seedance-2');
        expect(s.modes).toEqual(['image-to-video', 'first-last-frame']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt field and ratio (not aspectRatio)', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('ratio');
    });
    it('declares aspectRatioValues including adaptive', () => {
        expect(s.aspectRatioValues).toEqual(['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4']);
    });
    it('has string duration with default 5', () => {
        expect(s.durationType).toBe('string');
        expect(s.durationDefault).toBe('5');
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('declares generateAudio, realPersonMode, conversionSlots, returnLastFrame, seed params', () => {
        const fields = paramFields(s);
        expect(fields).toContain('generateAudio');
        expect(fields).toContain('realPersonMode');
        expect(fields).toContain('conversionSlots');
        expect(fields).toContain('returnLastFrame');
        expect(fields).toContain('seed');
        expect(s.params.find(p => p.field === 'generateAudio')!.type).toBe('boolean');
        expect(s.params.find(p => p.field === 'generateAudio')!.default).toBe(true);
        expect(s.params.find(p => p.field === 'realPersonMode')!.default).toBe(true);
        expect(s.params.find(p => p.field === 'conversionSlots')!.type).toBe('string');
        expect(s.params.find(p => p.field === 'conversionSlots')!.default).toBe('all');
        expect(s.params.find(p => p.field === 'returnLastFrame')!.default).toBe(false);
        expect(s.params.find(p => p.field === 'seed')!.type).toBe('number');
        expect(s.params.find(p => p.field === 'seed')!.default).toBe(-1);
    });
    it('requires firstFrameUrl and optional lastFrameUrl with first_last_frame mapping', () => {
        expect(s.media).toHaveLength(2);
        const first = s.media.find(m => m.field === 'firstFrameUrl')!;
        expect(first.kind).toBe('image');
        expect(first.serialization).toBe('single');
        expect(first.max).toBe(1);
        expect(first.min).toBe(1);
        expect(first.required).toBe(true);
        expect(first.mapping).toBe('first_last_frame');
        const last = s.media.find(m => m.field === 'lastFrameUrl')!;
        expect(last.kind).toBe('image');
        expect(last.serialization).toBe('single');
        expect(last.max).toBe(1);
        expect(last.mapping).toBe('first_last_frame');
    });
    it('links to official evidence 448183116', () => {
        expect(s.officialEvidence).toContain('448183116');
    });
});

describe('Video Route — rhart-video/sparkvideo-2.0-fast/image-to-video (Seedance 2.0 Fast)', () => {
    const s = schemaOf('rhart-video/sparkvideo-2.0-fast/image-to-video');
    it('maps to flovart:seedance-2-fast with image-to-video and first-last-frame modes', () => {
        expect(s.productModelId).toBe('flovart:seedance-2-fast');
        expect(s.modes).toEqual(['image-to-video', 'first-last-frame']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt field and ratio (not aspectRatio)', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('ratio');
    });
    it('has string duration with default 5', () => {
        expect(s.durationType).toBe('string');
        expect(s.durationDefault).toBe('5');
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('has same params as seedance-2.0 i2v', () => {
        const fields = paramFields(s);
        expect(fields).toContain('generateAudio');
        expect(fields).toContain('realPersonMode');
        expect(fields).toContain('conversionSlots');
        expect(fields).toContain('returnLastFrame');
        expect(fields).toContain('seed');
    });
    it('requires firstFrameUrl and optional lastFrameUrl with first_last_frame mapping', () => {
        expect(s.media).toHaveLength(2);
        const first = s.media.find(m => m.field === 'firstFrameUrl')!;
        expect(first.required).toBe(true);
        expect(first.mapping).toBe('first_last_frame');
        const last = s.media.find(m => m.field === 'lastFrameUrl')!;
        expect(last.mapping).toBe('first_last_frame');
    });
    it('links to official evidence 448183115', () => {
        expect(s.officialEvidence).toContain('448183115');
    });
});

describe('Video Route — rhart-video/sparkvideo-2.0/multimodal-video (Seedance 2.0)', () => {
    const s = schemaOf('rhart-video/sparkvideo-2.0/multimodal-video');
    it('maps to flovart:seedance-2 with reference-to-video mode', () => {
        expect(s.productModelId).toBe('flovart:seedance-2');
        expect(s.modes).toEqual(['reference-to-video']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt field and ratio (not aspectRatio)', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('ratio');
    });
    it('has string duration with default 5', () => {
        expect(s.durationType).toBe('string');
        expect(s.durationDefault).toBe('5');
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('declares same params as sparkvideo i2v routes', () => {
        const fields = paramFields(s);
        expect(fields).toContain('generateAudio');
        expect(fields).toContain('realPersonMode');
        expect(fields).toContain('conversionSlots');
        expect(fields).toContain('returnLastFrame');
        expect(fields).toContain('seed');
    });
    it('declares imageUrls max 9, videoUrls max 3, audioUrls max 3 with multimodal mapping', () => {
        expect(s.media).toHaveLength(3);
        const images = s.media.find(m => m.field === 'imageUrls')!;
        expect(images.kind).toBe('image');
        expect(images.serialization).toBe('array');
        expect(images.max).toBe(9);
        expect(images.mapping).toBe('multimodal');
        const videos = s.media.find(m => m.field === 'videoUrls')!;
        expect(videos.kind).toBe('video');
        expect(videos.serialization).toBe('array');
        expect(videos.max).toBe(3);
        expect(videos.mapping).toBe('multimodal');
        const audios = s.media.find(m => m.field === 'audioUrls')!;
        expect(audios.kind).toBe('audio');
        expect(audios.serialization).toBe('array');
        expect(audios.max).toBe(3);
        expect(audios.mapping).toBe('multimodal');
    });
    it('links to official evidence 448183127', () => {
        expect(s.officialEvidence).toContain('448183127');
    });
});

describe('Video Route — rhart-video-g-official/reference-to-video (Grok Imagine Video)', () => {
    const s = schemaOf('rhart-video-g-official/reference-to-video');
    it('maps to flovart:grok-imagine-video with reference-to-video mode', () => {
        expect(s.productModelId).toBe('flovart:grok-imagine-video');
        expect(s.modes).toEqual(['reference-to-video']);
    });
    it('uses official-stable channel', () => {
        expect(s.channelTier).toBe('official-stable');
    });
    it('uses prompt field and has no aspectRatio field', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBeNull();
    });
    it('has number duration with default 5', () => {
        expect(s.durationType).toBe('number');
        expect(s.durationDefault).toBe(5);
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('has no extra params', () => {
        expect(s.params).toHaveLength(0);
    });
    it('requires imageUrls array with reference_images mapping, max 7, min 1', () => {
        expect(s.media).toHaveLength(1);
        const m = s.media[0];
        expect(m.field).toBe('imageUrls');
        expect(m.kind).toBe('image');
        expect(m.serialization).toBe('array');
        expect(m.max).toBe(7);
        expect(m.min).toBe(1);
        expect(m.required).toBe(true);
        expect(m.mapping).toBe('reference_images');
    });
    it('links to official evidence 448183126', () => {
        expect(s.officialEvidence).toContain('448183126');
    });
});

describe('Video Route — rhart-video-g/text-to-video (Grok Imagine Video)', () => {
    const s = schemaOf('rhart-video-g/text-to-video');
    it('maps to flovart:grok-imagine-video-1.5 with text-to-video mode', () => {
        expect(s.productModelId).toBe('flovart:grok-imagine-video-1.5');
        expect(s.modes).toEqual(['text-to-video']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('has number duration with current documented default 6', () => {
        expect(s.durationType).toBe('number');
        expect(s.durationDefault).toBe(6);
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('has no extra params', () => {
        expect(s.params).toHaveLength(0);
    });
    it('has no media specs (text-to-video)', () => {
        expect(s.media).toHaveLength(0);
    });
    it('links to official evidence 448183149', () => {
        expect(s.officialEvidence).toContain('448183149');
    });
});

describe('Video Route — rhart-video-v3.1-fast/text-to-video (Veo 3.1 Fast)', () => {
    const s = schemaOf('rhart-video-v3.1-fast/text-to-video');
    it('maps to flovart:veo-3.1-fast with text-to-video mode', () => {
        expect(s.productModelId).toBe('flovart:veo-3.1-fast');
        expect(s.modes).toEqual(['text-to-video']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt and aspectRatio fields', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('aspectRatio');
    });
    it('has string duration with values 4/6/8 and default 8', () => {
        expect(s.durationType).toBe('string');
        expect(s.durationValues).toEqual(['4', '6', '8']);
        expect(s.durationDefault).toBe('8');
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('has no extra params (no generateAudio for Veo fast)', () => {
        expect(s.params).toHaveLength(0);
    });
    it('has no media specs (text-to-video)', () => {
        expect(s.media).toHaveLength(0);
    });
    it('links to official evidence 448183144', () => {
        expect(s.officialEvidence).toContain('448183144');
    });
});

describe('Video Route — rhart-video-v3.1-lite-official/text-to-video (Veo 3.1 Lite)', () => {
    const s = schemaOf('rhart-video-v3.1-lite-official/text-to-video');
    it('maps to flovart:veo-3.1-lite with text-to-video mode', () => {
        expect(s.productModelId).toBe('flovart:veo-3.1-lite');
        expect(s.modes).toEqual(['text-to-video']);
    });
    it('uses official-stable channel', () => {
        expect(s.channelTier).toBe('official-stable');
    });
    it('caps the verified CLI route to 16:9/9:16, 4/6/8 seconds, and 720p by default', () => {
        expect(s.aspectRatioValues).toEqual(['16:9', '9:16']);
        expect(s.durationType).toBe('string');
        expect(s.durationValues).toEqual(['4', '6', '8']);
        expect(s.durationDefault).toBe('8');
        expect(s.resolutionDefault).toBe('720p');
    });
    it('sends no undocumented generateAudio field or media references', () => {
        expect(s.params).toHaveLength(0);
        expect(s.media).toHaveLength(0);
    });
    it('links to official evidence 448183147', () => {
        expect(s.officialEvidence).toContain('448183147');
    });
});

describe('Video Route — rhart-video/sparkvideo-2.0/text-to-video (Seedance 2.0)', () => {
    const s = schemaOf('rhart-video/sparkvideo-2.0/text-to-video');
    it('maps to flovart:seedance-2 with text-to-video mode', () => {
        expect(s.productModelId).toBe('flovart:seedance-2');
        expect(s.modes).toEqual(['text-to-video']);
    });
    it('uses low-price channel', () => {
        expect(s.channelTier).toBe('low-price');
    });
    it('uses prompt field and ratio (not aspectRatio)', () => {
        expect(s.promptField).toBe('prompt');
        expect(s.aspectRatioField).toBe('ratio');
    });
    it('declares aspectRatioValues including adaptive', () => {
        expect(s.aspectRatioValues).toEqual(['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4']);
    });
    it('has string duration with default 5', () => {
        expect(s.durationType).toBe('string');
        expect(s.durationDefault).toBe('5');
    });
    it('defaults resolution to 720p', () => {
        expect(s.resolutionDefault).toBe('720p');
    });
    it('declares generateAudio, webSearch, realPersonMode, conversionSlots, returnLastFrame, seed params', () => {
        const fields = paramFields(s);
        expect(fields).toContain('generateAudio');
        expect(fields).toContain('webSearch');
        expect(fields).toContain('realPersonMode');
        expect(fields).toContain('conversionSlots');
        expect(fields).toContain('returnLastFrame');
        expect(fields).toContain('seed');
        expect(s.params.find(p => p.field === 'generateAudio')!.default).toBe(true);
        expect(s.params.find(p => p.field === 'webSearch')!.type).toBe('boolean');
        expect(s.params.find(p => p.field === 'webSearch')!.default).toBe(false);
        expect(s.params.find(p => p.field === 'seed')!.default).toBe(-1);
    });
    it('has no media specs (text-to-video)', () => {
        expect(s.media).toHaveLength(0);
    });
    it('links to official evidence 448183167', () => {
        expect(s.officialEvidence).toContain('448183167');
    });
});
