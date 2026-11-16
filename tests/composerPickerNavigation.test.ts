import { describe, expect, it } from 'vitest';

import { clampHighlight, matchesReference, mediaKind, nextHighlight } from '../components/agent/pickerNavigation';

describe('composer picker keyboard highlight', () => {
  it('↓ enters the list, clamps at the end, ↑ from the first item returns to the input', () => {
    expect(nextHighlight(-1, 3, 1)).toBe(0);
    expect(nextHighlight(0, 3, 1)).toBe(1);
    expect(nextHighlight(2, 3, 1)).toBe(2);
    expect(nextHighlight(0, 3, -1, { exitAbove: true })).toBe(-1);
    expect(nextHighlight(0, 3, -1)).toBe(0);
    expect(nextHighlight(-1, 0, 1)).toBe(-1);
  });

  it('wraps when asked', () => {
    expect(nextHighlight(2, 3, 1, { wrap: true })).toBe(0);
    expect(nextHighlight(0, 3, -1, { wrap: true })).toBe(2);
  });

  it('clamps the highlight when the filtered list shrinks', () => {
    expect(clampHighlight(5, 2)).toBe(1);
    expect(clampHighlight(1, 0)).toBe(-1);
  });
});

describe('@ reference live filter', () => {
  const items = [
    { label: '图片 3', mediaType: 'image' },
    { label: '图片 10', mediaType: 'image' },
    { label: '视频 1', mediaType: 'video' },
    { label: '海报', mediaType: 'image/png' },
    { label: '旁白稿', mediaType: 'text' },
  ];
  const run = (query: string) => items.filter(item => matchesReference(item, query)).map(item => item.label);

  it('matches names ignoring spaces and case', () => {
    expect(run('图片3')).toEqual(['图片 3']);
    expect(run('海')).toEqual(['海报']);
  });

  it('matches type words in Chinese and English', () => {
    expect(run('视频')).toEqual(['视频 1']);
    expect(run('image')).toEqual(['图片 3', '图片 10', '海报']);
    expect(run('视')).toEqual(['视频 1']);
  });

  it('type word + rest narrows by name', () => {
    expect(run('视频1')).toEqual(['视频 1']);
    expect(run('图片1')).toEqual(['图片 10']);
  });

  it('nothing matches → empty', () => {
    expect(run('不存在')).toEqual([]);
  });

  it('maps node types and MIME types to kinds', () => {
    expect(mediaKind('video/mp4')).toBe('video');
    expect(mediaKind('image')).toBe('image');
    expect(mediaKind('text')).toBe('text');
  });
});
