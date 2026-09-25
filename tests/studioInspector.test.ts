import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('Resolve Studio shared inspector', () => {
  it('shows Media Pool as the selected output and submits that target', async () => {
    const source = readFileSync(join(process.cwd(), 'integrations', 'studio', 'shared', 'inspector.js'), 'utf8');
    new Function('window', source)(window);
    const generate = vi.fn(async () => ({ import: { ok: true, targetId: 'media-pool' } }));
    const adapter = {
      id: 'resolve',
      getContext: vi.fn(async () => ({ available: true, documentId: 'project-1', title: 'Project 1' })),
      getSelection: vi.fn(async () => ({ host: 'resolve', selectionId: 'clip-1', label: 'Interview_A.mov', kind: 'video' })),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const studioUi = (window as unknown as { FlovartStudioUI: { mountInspector: (options: Record<string, unknown>) => { dispose: () => void } } }).FlovartStudioUI;
    const inspector = studioUi.mountInspector({
      root,
      adapter,
      controller: { models: [{ label: 'Auto', value: 'auto' }], generate },
      hostLabel: 'Resolve',
      defaultImportTarget: { kind: 'media-pool' },
    });
    await vi.waitFor(() => expect(root.querySelector('.fs-source-info strong')?.textContent).toBe('Interview_A.mov'));
    const output = root.querySelector<HTMLSelectElement>('.fs-setting-row select[aria-label="输出位置"]');
    expect(output).not.toBeNull();
    expect(Array.from(output!.options).map(item => [item.textContent, item.value])).toContainEqual(['Media Pool', 'media-pool']);
    expect(output!.value).toBe('media-pool');
    const prompt = root.querySelector<HTMLTextAreaElement>('textarea');
    prompt!.value = 'Generate another variation from the current selected timeline clip';
    prompt!.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('.fs-generate')!.click();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledWith(
      'Generate another variation from the current selected timeline clip',
      { kind: 'media-pool' },
      expect.any(Function),
    ));
    inspector.dispose();
    root.remove();
  });
});
