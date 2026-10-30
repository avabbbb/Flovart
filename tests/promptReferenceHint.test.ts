import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaMentionNode } from '../components/MediaMentionExtension';
import { findReferenceHint, insertReferenceHint } from '../components/promptReferenceHint';

const items = [{ id: 'n1', label: '图片1', thumbnail: '', elementType: 'image' }];
const editors: Editor[] = [];

function editorWith(text: string): Editor {
    const editor = new Editor({ extensions: [StarterKit, MediaMentionNode], content: '<p>' + text + '</p>' });
    editor.commands.focus('end');
    editors.push(editor);
    return editor;
}

afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });

describe('prompt reference Tab hint', () => {
    it('offers a connected reference typed without @ and converts it into a mention', () => {
        const editor = editorWith('把图片1');
        const match = findReferenceHint(editor.state, items);
        expect(match?.item.id).toBe('n1');
        expect(insertReferenceHint(editor.view, match!)).toBe(true);
        expect(editor.getJSON().content?.[0].content?.[1]).toMatchObject({ type: 'mediaMention', attrs: { id: 'n1', label: '图片1' } });
    });

    it('stays quiet for existing @ mentions and names away from the cursor', () => {
        expect(findReferenceHint(editorWith('参考@图片1').state, items)).toBeNull();
        expect(findReferenceHint(editorWith('图片1 的人物').state, items)).toBeNull();
    });
});
