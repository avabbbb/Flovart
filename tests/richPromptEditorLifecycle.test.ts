import { describe, expect, it } from 'vitest';
import { applyEditorPlaceholder } from '../components/RichPromptEditor';

describe('RichPromptEditor lifecycle', () => {
  it('does not access the editor view before mount or after destroy', () => {
    let viewAccessed = false;
    const editor = {
      isDestroyed: true,
      get view(): { dom: HTMLElement } {
        viewAccessed = true;
        throw new Error('view is unavailable');
      },
    };

    expect(() => applyEditorPlaceholder(editor, '提示词')).not.toThrow();
    expect(viewAccessed).toBe(false);
  });

  it('keeps the visual placeholder and accessible name in sync', () => {
    const dom = document.createElement('div');
    applyEditorPlaceholder({ isDestroyed: false, view: { dom } }, '描述你想生成的画面');
    expect(dom.getAttribute('data-placeholder')).toBe('描述你想生成的画面');
    expect(dom.getAttribute('aria-label')).toBe('描述你想生成的画面');
  });
});
