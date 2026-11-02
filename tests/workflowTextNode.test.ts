import { describe, expect, it } from 'vitest';
import { parseTextBlocks } from '../components/workflow/TextNodeBody';
import { buildTextAssetPrompt, canGenerateTextAssets, textAssetSpec } from '../components/workflow/textAssets';

describe('text node document layout', () => {
  it('parses heading levels, lists, quotes and collapses blank lines', () => {
    const blocks = parseTextBlocks('# 片名\n\n\n## 角色\n【设定】\n- 雅伊\n1. 开场\n> 旁白\n---\n正文 **重点**\n\n');
    expect(blocks.map(block => block.kind)).toEqual(['h1', 'gap', 'h2', 'h3', 'li', 'ol', 'quote', 'hr', 'p']);
    expect(blocks[5]).toMatchObject({ kind: 'ol', marker: '1', text: '开场' });
  });
});

describe('text node asset derivation', () => {
  it('only offers assets for non-empty text nodes', () => {
    expect(canGenerateTextAssets({ type: 'text', metadata: { content: '  ' } } as never)).toBe(false);
    expect(canGenerateTextAssets({ type: 'text', metadata: { content: '角色：雅伊' } } as never)).toBe(true);
    expect(canGenerateTextAssets({ type: 'image', metadata: { content: '角色' } } as never)).toBe(false);
  });

  it('maps each asset kind to its own instruction and aspect ratio', () => {
    expect(textAssetSpec('character').aspectRatio).toBe('3:4');
    expect(textAssetSpec('scene').aspectRatio).toBe('16:9');
    expect(buildTextAssetPrompt('prop')).toContain('道具');
  });
});
