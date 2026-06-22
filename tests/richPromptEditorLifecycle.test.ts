import { describe, expect, it } from 'vitest';
import { applyEditorPlaceholder } from '../components/RichPromptEditor';

describe('RichPromptEditor lifecycle', () => {
  it('does not access the editor view before mount or after destroy', () => {
    let viewAccessed = false;
    const editor = {
      isDestroyed: true,
      get view() {
        viewAccessed = true;
        throw new Error('view is unavailable');
      },
    };

    expect(() => applyEditorPlaceholder(editor, '提示词')).not.toThrow();
    expect(viewAccessed).toBe(false);
  });
});
