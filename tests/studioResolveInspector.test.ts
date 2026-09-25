import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const inspectorSource = readFileSync('integrations/studio/shared/inspector.js', 'utf8');

describe('Resolve shared inspector output target', () => {
  let dom: JSDOM | undefined;

  afterEach(() => {
    dom?.window.close();
    dom = undefined;
  });

  it('exposes, selects, and passes Media Pool as the Resolve output target', async () => {
    dom = new JSDOM('<main id="app"></main>', { runScripts: 'outside-only' });
    dom.window.eval(inspectorSource);

    let receivedTarget: unknown;
    const adapter = {
      id: 'resolve',
      getContext: async () => ({ available: true, documentId: 'project-1', title: 'Resolve project' }),
      getSelection: async () => ({ selectionId: 'clip-1', label: 'Interview_A.mov', kind: 'video' }),
      subscribeContext: () => ({ dispose() {} }),
    };
    const panel = dom.window.FlovartStudioUI.mountInspector({
      root: dom.window.document.getElementById('app'),
      adapter,
      controller: {
        models: [{ label: 'Auto', value: 'auto' }],
        async generate(_prompt, target) {
          receivedTarget = target;
          return { import: { ok: true, message: 'Added' } };
        },
      },
      hostLabel: 'DaVinci Resolve · Clip',
      defaultImportTarget: { kind: 'media-pool' },
    });

    await new Promise(resolve => dom!.window.setTimeout(resolve, 0));
    const output = dom.window.document.querySelector<HTMLSelectElement>('select[aria-label="输出位置"]');
    expect(output).not.toBeNull();
    expect(Array.from(output!.options).map((item: HTMLOptionElement) => [item.textContent, item.value])).toEqual([
      ['Media Pool', 'media-pool'],
    ]);
    expect(output!.value).toBe('media-pool');

    const prompt = dom.window.document.querySelector<HTMLTextAreaElement>('#flovart-studio-prompt')!;
    prompt.value = 'Create a deterministic test candidate';
    prompt.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    dom.window.document.querySelector<HTMLButtonElement>('button.fs-generate')!.click();
    await new Promise(resolve => dom!.window.setTimeout(resolve, 0));
    expect(receivedTarget).toEqual({ kind: 'media-pool' });

    panel.dispose();
  });
});
