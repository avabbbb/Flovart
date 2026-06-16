export class FlovartRuntimeClient {
  constructor(options = {}) {
    this.cdpPort = options.cdpPort || 9222;
    this._ws = null;
    this._cdpId = 0;
    this._pending = new Map();
  }

  async connect() {
    const res = await fetch(`http://127.0.0.1:${this.cdpPort}/json`);
    if (!res.ok) {
      throw new Error(`Cannot query CDP targets on port ${this.cdpPort}`);
    }

    const targets = await res.json();
    const target = targets.find(t =>
      t.url?.includes('flovart') || t.url?.includes('localhost:') || t.title?.toLowerCase().includes('flovart')
    );
    if (!target?.webSocketDebuggerUrl) {
      throw new Error('No Flovart tab found');
    }

    this._ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this._ws.addEventListener('open', resolve, { once: true });
      this._ws.addEventListener('error', reject, { once: true });
    });

    this._ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      const pending = this._pending.get(msg.id);
      if (!pending) return;
      this._pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    });
  }

  async execute(method, ...args) {
    if (!this._ws) throw new Error('Not connected');
    const id = ++this._cdpId;
    const expression = `
      (async () => {
        const api = window.__flovartAPI;
        if (!api) throw new Error('__flovartAPI not available');
        const parts = '${method}'.split('.');
        let fn = api;
        for (const p of parts) fn = fn?.[p];
        if (typeof fn !== 'function') throw new Error('Unknown method: ${method}');
        return await fn(${args.map(a => JSON.stringify(a)).join(', ')});
      })()
    `;

    return await new Promise((resolve, reject) => {
      this._pending.set(id, {
        resolve: (result) => {
          if (result?.result?.type === 'undefined') resolve(undefined);
          else if (result?.result?.value !== undefined) resolve(result.result.value);
          else if (result?.exceptionDetails) reject(new Error(result.exceptionDetails.text || 'Execution failed'));
          else resolve(result?.result);
        },
        reject,
      });
      this._ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
  }

  async disconnect() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._pending.clear();
  }
}

export function createRuntimeFacade(client) {
  return {
    _version: 'external-cdp',
    status: () => client.execute('status'),
    provider: {
      status: () => client.execute('provider.status'),
      beginSetup: input => client.execute('provider.beginSetup', input),
      selectModel: input => client.execute('provider.selectModel', input),
      test: input => client.execute('provider.test', input),
    },
    canvas: {
      getElements: () => client.execute('canvas.getElements'),
      inspect: () => client.execute('canvas.inspect'),
      addElement: partial => client.execute('canvas.addElement', partial),
      listMedia: () => client.execute('canvas.listMedia'),
      addImage: input => client.execute('canvas.addImage', input),
      addVideo: input => client.execute('canvas.addVideo', input),
      updateElement: (id, updates) => client.execute('canvas.updateElement', id, updates),
      removeElement: id => client.execute('canvas.removeElement', id),
      clearMedia: () => client.execute('canvas.clearMedia'),
      clear: () => client.execute('canvas.clear'),
      select: ids => client.execute('canvas.select', ids),
    },
    element: {
      create: input => client.execute('element.create', input),
      updatePrompt: input => client.execute('element.updatePrompt', input),
      assignSlot: input => client.execute('element.assignSlot', input),
      ignite: input => client.execute('element.ignite', input),
      watch: input => client.execute('element.watch', input),
    },
    session: {
      create: name => client.execute('session.create', name),
    },
    command: {
      list: sessionId => client.execute('command.list', sessionId),
    },
    generate: {
      image: input => client.execute('generate.image', input),
      imagesBatch: input => client.execute('generate.imagesBatch', input),
      video: input => client.execute('generate.video', input),
      videoStatus: input => client.execute('generate.videoStatus', input),
    },
    assets: {
      list: () => client.execute('assets.list'),
    },
    export: {
      project: input => client.execute('export.project', input),
    },
    config: {
      getProviders: () => client.execute('config.getProviders'),
    },
  };
}
