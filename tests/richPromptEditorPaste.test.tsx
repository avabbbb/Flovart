import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RichPromptEditor from '../components/RichPromptEditor';
import { encodePromptClipboard, FLOVART_PROMPT_CLIPBOARD_MIME } from '../utils/promptReferenceClipboard';

describe('RichPromptEditor reference paste', () => {
  it('turns a uniquely matched plain @ alias into a bound mention without requiring whitespace', async () => {
    const onTextChange = vi.fn();
    const onResolvePastedMentions = vi.fn(mentions => mentions);
    render(
      <RichPromptEditor
        referenceItems={[]}
        pasteReferenceItems={[{
          id: 'character-node',
          label: '角色1',
          thumbnail: 'data:image/png;base64,AA==',
          elementType: 'image',
        }]}
        onResolvePastedMentions={onResolvePastedMentions}
        onTextChange={onTextChange}
      />,
    );

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        getData: (type: string) => type === 'text/plain' ? '@角色1向左走' : '',
      },
    });

    await waitFor(() => expect(onTextChange).toHaveBeenCalled());
    expect(onResolvePastedMentions).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'character-node', label: '角色1' }),
    ]);
    const [plainText, document] = onTextChange.mock.calls.at(-1)!;
    expect(plainText).toBe('@角色1向左走');
    expect(document).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'mediaMention', attrs: expect.objectContaining({ id: 'character-node', label: '角色1' }) },
          { type: 'text', text: '向左走' },
        ],
      }],
    });
  });

  it('restores the hidden source identity from Flovart clipboard data and rebinds it for the target node', async () => {
    const onTextChange = vi.fn();
    const sourceDocument = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mediaMention',
          attrs: {
            id: 'source-character-node',
            assetId: 'asset-character-a',
            label: '角色1',
            thumbnail: '',
            elementType: 'image',
            sourceType: 'assetLibrary',
          },
        }],
      }],
    };
    render(
      <RichPromptEditor
        referenceItems={[]}
        onResolvePastedMentions={mentions => mentions.map(mention => ({ ...mention, id: 'target-character-node' }))}
        onTextChange={onTextChange}
      />,
    );

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        getData: (type: string) => type === FLOVART_PROMPT_CLIPBOARD_MIME
          ? encodePromptClipboard(sourceDocument)
          : type === 'text/plain' ? '@角色1' : '',
      },
    });

    await waitFor(() => expect(onTextChange).toHaveBeenCalled());
    const [, document] = onTextChange.mock.calls.at(-1)!;
    expect(document).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mediaMention',
          attrs: expect.objectContaining({
            id: 'target-character-node',
            assetId: 'asset-character-a',
            label: '角色1',
          }),
        }],
      }],
    });
  });

  it('rejects an invalid structured document before resolving or connecting any references', () => {
    const onResolvePastedMentions = vi.fn();
    render(
      <RichPromptEditor
        referenceItems={[]}
        onResolvePastedMentions={onResolvePastedMentions}
      />,
    );

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        getData: (type: string) => type === FLOVART_PROMPT_CLIPBOARD_MIME
          ? JSON.stringify({
              version: 1,
              plainText: '@角色1',
              document: {
                type: 'doc',
                content: [{
                  type: 'mediaMention',
                  attrs: { id: 'source', label: '角色1', thumbnail: '', elementType: 'image' },
                }],
              },
            })
          : '',
      },
    });

    expect(onResolvePastedMentions).not.toHaveBeenCalled();
  });
});
