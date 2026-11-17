import { describe, expect, it } from 'vitest';
import type { PromptPack } from '../services/promptPack';
import {
  createPromptAsset,
  promptAssetFromPromptItem,
  promptAssetFromQuickPrompt,
  promptAssetsFromPromptPack,
  searchPromptAssets,
} from '../services/promptAsset';

const pack: PromptPack = {
  id: 'pack-1',
  slug: 'night-rain',
  title: '夜雨镜头',
  description: '城市夜雨',
  authorId: 'author-1',
  mode: 'video',
  tags: ['雨夜', '电影感'],
  items: [
    { id: 'wide', name: '宽幅开场', prompt: '城市在雨幕中苏醒' },
    { id: 'detail', name: '细节特写', prompt: '雨滴落在霓虹招牌上' },
  ],
  likeCount: 0,
  downloadCount: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('PromptAsset', () => {
  it('normalizes reusable provider-neutral metadata and reference roles', () => {
    const asset = createPromptAsset({
      id: '  asset-1 ',
      title: ' 夜雨 ',
      text: '  一段有层次的夜雨镜头  ',
      tags: ['雨夜', '雨夜', '电影感'],
      modelHints: ['video-family', 'video-family'],
      requiredReferenceRoles: ['first_frame', 'not-a-role', 'first_frame'],
      optionalReferenceRoles: ['style'],
      examples: [{ title: '示例', text: '霓虹倒影' }],
      source: { kind: 'local', id: 'library-1', label: '我的提示词' },
    });

    expect(asset).toMatchObject({
      id: 'asset-1',
      title: '夜雨',
      text: '一段有层次的夜雨镜头',
      tags: ['雨夜', '电影感'],
      modelHints: ['video-family'],
      requiredReferenceRoles: ['first_frame'],
      optionalReferenceRoles: ['style'],
      source: { kind: 'local', id: 'library-1' },
    });
    expect(asset.examples).toEqual([{ title: '示例', text: '霓虹倒影' }]);
  });

  it('maps community prompt items into distinct remote assets', () => {
    const assets = promptAssetsFromPromptPack(pack);
    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({
      id: 'prompt:pack-1:wide',
      title: '宽幅开场',
      modality: 'video',
      tags: ['雨夜', '电影感'],
      source: { kind: 'remote', id: 'pack-1', label: '夜雨镜头' },
    });
    expect(promptAssetFromPromptItem(pack, pack.items[1], 1).text).toBe('雨滴落在霓虹招牌上');
  });

  it('keeps quick prompts and search independent from Provider configuration', () => {
    const assets = [
      promptAssetFromQuickPrompt({ id: 'quick-1', title: '电影夜景', text: '电影感夜景', tags: ['电影'] }),
      promptAssetFromQuickPrompt({ id: 'quick-2', title: '明亮白天', text: '明亮的白天', modality: 'image' }),
    ];
    expect(searchPromptAssets(assets, '电影')).toHaveLength(1);
    expect(searchPromptAssets(assets, '', 'image')).toHaveLength(1);
  });

  it('rejects raw credentials instead of persisting them as creative text', () => {
    expect(() => createPromptAsset({
      id: 'unsafe',
      title: '不安全',
      text: 'api_key=secret-value',
      source: { kind: 'user', id: 'user-1' },
    })).toThrow('API Key');
    expect(() => createPromptAsset({
      id: 'unsafe-2',
      title: '不安全',
      text: 'Bearer abcdefghijklmnopqrstuvwxyz',
      source: { kind: 'user', id: 'user-1' },
    })).toThrow('API Key');
  });
});
