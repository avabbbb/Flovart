import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { typedRanges } from '../components/promptFreshText';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
const state = EditorState.create({ schema, doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('ab')])]) });

describe('promptFreshText.typedRanges', () => {
  it('marks a typed character', () => {
    expect(typedRanges(state.tr.insertText('c', 3))).toEqual([{ from: 3, to: 4 }]);
  });
  it('ignores pastes and long inserts', () => {
    expect(typedRanges(state.tr.insertText('c', 3).setMeta('paste', true))).toEqual([]);
    expect(typedRanges(state.tr.insertText('hello world', 3))).toEqual([]);
  });
  it('ignores deletions', () => {
    expect(typedRanges(state.tr.delete(1, 2))).toEqual([]);
  });
});
