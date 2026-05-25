import { describe, expect, it } from 'vitest';
import type { CanvasElement } from '../types';
import { hydrateRawTextToTiptapJSON } from '../utils/htmlHydrator';

const elements: CanvasElement[] = [
    { id: 'img_a', type: 'image', name: '首帧参考', x: 0, y: 0, width: 100, height: 100, href: 'data:image/png;base64,abc', mimeType: 'image/png' },
    { id: 'vid_a', type: 'video', name: '镜头运动', x: 120, y: 0, width: 100, height: 100, href: 'blob:test', mimeType: 'video/mp4' },
];

describe('htmlHydrator', () => {
    it('hydrates plain @ tokens into canvasMention nodes', () => {
        const result = hydrateRawTextToTiptapJSON('参考 @首帧参考 生成 @镜头运动', elements);

        expect(result.html).toContain('data-canvas-mention');
        expect(result.json).toEqual({
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: '参考 ' },
                    {
                        type: 'canvasMention',
                        attrs: {
                            id: 'img_a',
                            label: '首帧参考',
                            thumbnail: 'data:image/png;base64,abc',
                            elementType: 'image',
                        },
                    },
                    { type: 'text', text: ' 生成 ' },
                    {
                        type: 'canvasMention',
                        attrs: {
                            id: 'vid_a',
                            label: '镜头运动',
                            thumbnail: '',
                            elementType: 'video',
                        },
                    },
                ],
            }],
        });
    });

    it('keeps unknown mentions as plain text', () => {
        const result = hydrateRawTextToTiptapJSON('保留 @未知资产 原文', elements);

        expect(result.json).toEqual({
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: '保留 @未知资产 原文' }],
            }],
        });
    });
});
