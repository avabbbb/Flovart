#!/usr/bin/env node
/**
 * Iris Runtime Client — connects AI Agent scripts to a running Iris instance.
 *
 * Connection modes (tried in order):
 * 1. Direct: window.__irisAPI (when script runs in same page context)
 * 2. Extension: chrome.runtime.sendMessage (when Iris extension is installed)
 * 3. CDP: Chrome DevTools Protocol via --remote-debugging-port (fallback)
 *
 * Usage:
 *   const { IrisClient } = require('./iris-client');
 *   const client = new IrisClient();
 *   await client.connect();
 *   await client.execute('canvas.addElement', { type: 'text', text: 'Hello' });
 */

class IrisClient {
  constructor(options = {}) {
    this.extensionId = options.extensionId || null;
    this.cdpPort = options.cdpPort || 9222;
    this.mode = null; // 'direct' | 'extension' | 'cdp'
    this._ws = null;
    this._cdpId = 0;
    this._pending = new Map();
  }

  /**
   * Connect to a running Iris instance.
   * @returns {Promise<string>} Connection mode used
   */
  async connect() {
    // Try CDP (most common for Agent scripts running in Node.js)
    try {
      await this._connectCDP();
      this.mode = 'cdp';
      console.log(`[IrisClient] Connected via CDP (port ${this.cdpPort})`);
      return 'cdp';
    } catch {
      // CDP not available
    }
    throw new Error(
      'Cannot connect to Iris. Make sure:\n' +
      `  1. Chrome is running with --remote-debugging-port=${this.cdpPort}\n` +
      '  2. Iris is open in a tab\n' +
      'Tip: chrome --remote-debugging-port=9222'
    );
  }

  async _connectCDP() {
    const http = require('http');
    const targets = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${this.cdpPort}/json`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    // Find Iris tab
    const target = targets.find(t =>
      t.url?.includes('iris') || t.url?.includes('localhost:') || t.title?.toLowerCase().includes('iris')
    );
    if (!target?.webSocketDebuggerUrl) throw new Error('No Iris tab found');

    const WebSocket = require('ws');
    this._ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this._ws.on('open', resolve);
      this._ws.on('error', reject);
    });

    this._ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const pending = this._pending.get(msg.id);
      if (pending) {
        this._pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message));
        else pending.resolve(msg.result);
      }
    });
  }

  /**
   * Execute a Iris API method.
   * @param {string} method - e.g. 'canvas.addElement', 'generate.image'
   * @param  {...any} args - Arguments to pass
   * @returns {Promise<any>}
   */
  async execute(method, ...args) {
    if (this.mode === 'cdp') return this._executeCDP(method, args);
    throw new Error('Not connected');
  }

  async _executeCDP(method, args) {
    const id = ++this._cdpId;
    const expression = `
      (async () => {
        const api = window.__irisAPI;
        if (!api) throw new Error('__irisAPI not available');
        const parts = '${method}'.split('.');
        let fn = api;
        for (const p of parts) fn = fn?.[p];
        if (typeof fn !== 'function') throw new Error('Unknown method: ${method}');
        return await fn(${args.map(a => JSON.stringify(a)).join(', ')});
      })()
    `;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve: (r) => {
        if (r?.result?.type === 'undefined') resolve(undefined);
        else if (r?.result?.value !== undefined) resolve(r.result.value);
        else if (r?.exceptionDetails) reject(new Error(r.exceptionDetails.text || 'Execution failed'));
        else resolve(r?.result);
      }, reject });
      this._ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
  }

  // ── Convenience methods ──

  async addElement(partial) { return this.execute('canvas.addElement', partial); }
  async getElements() { return this.execute('canvas.getElements'); }
  async removeElement(id) { return this.execute('canvas.removeElement', id); }
  async updateElement(id, updates) { return this.execute('canvas.updateElement', id, updates); }
  async clearCanvas() { return this.execute('canvas.clear'); }
  async generateImage(prompt, source) { return this.execute('generate.image', prompt, source || 'agent-script'); }
  async getProviders() { return this.execute('config.getProviders'); }

  async disconnect() {
    if (this._ws) { this._ws.close(); this._ws = null; }
    this.mode = null;
  }
}

// CLI mode: run a quick command
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node iris-client.js <method> [argsJson]');
    console.log('  node iris-client.js canvas.getElements');
    console.log('  node iris-client.js canvas.addElement \'{"type":"text","text":"Hello"}\'');
    console.log('  node iris-client.js generate.image "a cute cat"');
    process.exit(0);
  }

  const method = args[0];
  const methodArgs = args.slice(1).map(a => { try { return JSON.parse(a); } catch { return a; } });

  const client = new IrisClient();
  client.connect()
    .then(() => client.execute(method, ...methodArgs))
    .then((result) => { console.log(JSON.stringify(result, null, 2)); return client.disconnect(); })
    .catch((err) => { console.error('Error:', err.message); process.exit(1); });
}

module.exports = { IrisClient };
