import { describe, expect, it, vi } from 'vitest';

import { apply } from '../dsh-plugin/src/client/index';

describe('DeepSeek Harness client registration', () => {
  it('registers the Flovart iframe view, sidebar entry, main pane and status overlay once each', () => {
    const injected: string[] = [];
    const scopedServices: string[][] = [];
    const registered: Array<{ name: string; id?: string; key?: string }> = [];
    const register = vi.fn((options: { name: string; id?: string; key?: string }) => {
      registered.push(options);
      return () => undefined;
    });
    const ctx = {
      inject(services: string[]) {
        scopedServices.push(services);
      },
      effect() {
        return () => undefined;
      },
      slots: {
        inject(name: string, callback: () => void) {
          injected.push(name);
          callback();
        },
        register,
      },
    };

    apply(ctx as never);

    expect(scopedServices).toEqual([['uiWorkspace'], ['locale'], ['theme']]);
    expect(injected).toEqual(['conversation.view', 'sidebar.panellist', 'main', 'shell.overlay']);
    expect(registered.map(({ name, id, key }) => ({ name, id: id ?? key }))).toEqual([
      { name: 'conversation.view', id: 'flovart' },
      { name: 'sidebar.panellist', id: 'flovart' },
      { name: 'main', id: 'flovart' },
      { name: 'shell.overlay', id: 'flovart-status' },
    ]);
  });
});
