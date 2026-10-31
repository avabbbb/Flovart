import { describe, expect, it } from 'vitest';
import { buildSeedancePromptText } from '../services/aiGateway';

type Slot = Parameters<typeof buildSeedancePromptText>[1][number];

const slot = (kind: Slot['kind'], label?: string): Slot => ({
    kind,
    href: 'https://cdn.example.com/' + kind,
    mimeType: kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/mpeg',
    label,
} as Slot);

describe('buildSeedancePromptText (Volcengine Seedance reference binding)', () => {
    it('sends the prompt as-is with no numbering preamble', () => {
        expect(buildSeedancePromptText('  first-person tea commercial  ', [slot('image'), slot('video')])).toBe('first-person tea commercial');
    });

    it('rewrites canvas labels to the per-kind order of the content array', () => {
        const slots = [slot('image', '图片2'), slot('image', '图片1'), slot('video', '视频3'), slot('audio', '音频1')];
        expect(buildSeedancePromptText('首帧为@图片2，参考@视频3的运镜，人物@图片1中的女孩，背景音乐@音频1', slots))
            .toBe('首帧为@图片1，参考@视频1的运镜，人物@图片2中的女孩，背景音乐@音频1');
    });

    it('maps custom titles and never swallows a longer numbered label', () => {
        const slots = [slot('image', 'role-a'), slot('image', '图片1')];
        expect(buildSeedancePromptText('@role-a meets @图片1 near @图片12', slots)).toBe('@图片1 meets @图片2 near @图片12');
    });

    it('rewrites plain-text ordinal labels that were never converted to chips', () => {
        const slots = [slot('image', '图片2'), slot('image', '图片1'), slot('video', '视频3')];
        expect(buildSeedancePromptText('参考图片2的构图，图片1中的人物，运镜同视频3', slots))
            .toBe('参考图片1的构图，图片2中的人物，运镜同视频1');
    });

    it('keeps longer plain numbers and mixed forms consistent', () => {
        const slots = [slot('image', '图片2'), slot('image', '图片1')];
        expect(buildSeedancePromptText('图片12 不动，@图片2 与 图片2 一致', slots)).toBe('图片12 不动，@图片1 与 图片1 一致');
    });

    it('only rewrites custom titles in @ form', () => {
        const slots = [slot('image', 'role-a')];
        expect(buildSeedancePromptText('画 role-a，参考 @role-a', slots)).toBe('画 role-a，参考 @图片1');
    });
});
