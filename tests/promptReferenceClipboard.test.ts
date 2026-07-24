import { describe, expect, it } from 'vitest';
import {
  decodePromptClipboard,
  encodePromptClipboard,
  getPromptReferenceAliases,
  hydratePromptText,
  rebindPromptDocument,
} from '../utils/promptReferenceClipboard';

describe('prompt reference clipboard', () => {
  it('keeps the stable asset identity behind a visible @ label', () => {
    const document = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: '让 ' },
          {
            type: 'mediaMention',
            attrs: {
              id: 'source-node-1',
              assetId: 'asset-character-a',
              label: '角色1',
              elementType: 'image',
              sourceType: 'assetLibrary',
            },
          },
          { type: 'text', text: ' 向前走' },
        ],
      }],
    };

    const payload = decodePromptClipboard(encodePromptClipboard(document));

    expect(payload).toEqual({
      version: 1,
      plainText: '让 @角色1 向前走',
      document,
    });
  });

  it('rebinds a copied mention to the target node without changing its visible alias', () => {
    const document = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mediaMention',
          attrs: {
            id: 'source-node-1',
            assetId: 'asset-character-a',
            label: '角色1',
            elementType: 'image',
            sourceType: 'assetLibrary',
          },
        }],
      }],
    };

    const result = rebindPromptDocument(document, mention => ({
      ...mention,
      id: 'target-upstream-node-9',
    }));

    expect(result).toEqual({
      plainText: '@角色1',
      document: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'mediaMention',
            attrs: expect.objectContaining({
              id: 'target-upstream-node-9',
              assetId: 'asset-character-a',
              label: '角色1',
            }),
          }],
        }],
      },
      mentionedElementIds: ['target-upstream-node-9'],
      unresolvedLabels: [],
    });
  });

  it('hydrates only uniquely matched plain-text aliases and leaves ambiguous aliases unresolved', () => {
    const result = hydratePromptText('@角色1 向左走\n@角色2 向右走', [
      { id: 'node-a', label: '角色1', thumbnail: '', elementType: 'image' },
      { id: 'node-b', label: '角色1', thumbnail: '', elementType: 'image' },
      { id: 'node-c', label: '角色2', thumbnail: '', elementType: 'image' },
    ]);

    expect(result.plainText).toBe('@角色1 向左走\n@角色2 向右走');
    expect(result.mentionedElementIds).toEqual(['node-c']);
    expect(result.unresolvedLabels).toEqual(['角色1']);
    expect(result.document).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '@角色1 向左走' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'mediaMention', attrs: expect.objectContaining({ id: 'node-c', label: '角色2' }) },
            { type: 'text', text: ' 向右走' },
          ],
        },
      ],
    });
  });

  it('exposes mention aliases by stable node id for Provider compilation', () => {
    expect(getPromptReferenceAliases({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'mediaMention', attrs: { id: 'node-a', label: '角色1' } },
          { type: 'text', text: '和' },
          { type: 'mediaMention', attrs: { id: 'node-b', label: '角色2' } },
        ],
      }],
    })).toEqual({
      'node-a': '角色1',
      'node-b': '角色2',
    });
  });

  it('does not bind a numbered alias as a prefix of another numbered alias', () => {
    const result = hydratePromptText('@角色10向前走', [
      { id: 'node-role-1', label: '角色1', thumbnail: '', elementType: 'image' },
    ]);

    expect(result.mentionedElementIds).toEqual([]);
    expect(result.document).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '@角色10向前走' }] }],
    });
  });

  it('does not keep one visible alias bound to two different assets', () => {
    const result = rebindPromptDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'mediaMention', attrs: { id: 'node-a', label: '角色1', thumbnail: '', elementType: 'image' } },
          { type: 'text', text: '和' },
          { type: 'mediaMention', attrs: { id: 'node-b', label: '角色1', thumbnail: '', elementType: 'image' } },
        ],
      }],
    }, mention => mention);

    expect(result.mentionedElementIds).toEqual(['node-a']);
    expect(result.unresolvedLabels).toEqual(['角色1']);
    expect(result.document).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'mediaMention', attrs: expect.objectContaining({ id: 'node-a', label: '角色1' }) },
          { type: 'text', text: '和' },
          { type: 'text', text: '@角色1' },
        ],
      }],
    });
  });
});
