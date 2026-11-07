import { describe, expect, it, vi } from 'vitest';

import { apply } from '../dsh-plugin/src/client/index';

describe('DeepSeek Harness client registration', () => {
  it('registers contextual additions through the RC8 slot lifecycle only', () => {
    const injected: string[] = [];
    const registered: Array<{ name: string; id: string }> = [];
    const register = vi.fn((options: { name: string; id: string }) => {
      registered.push(options);
      return () => undefined;
    });
    const ctx = {
      slots: {
        inject(name: string, callback: () => void) {
          injected.push(name);
          callback();
        },
        register,
      },
    };

    apply(ctx as never);

    expect(injected).toEqual(['conversation.view', 'shell.overlay']);
    expect(registered.map(({ name, id }) => ({ name, id }))).toEqual([
      { name: 'conversation.view', id: 'flovart' },
      { name: 'shell.overlay', id: 'flovart-status' },
    ]);
  });
});
