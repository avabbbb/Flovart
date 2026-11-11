#!/usr/bin/env node
/**
 * Query current canvas state from a running Flovart instance.
 * Usage: node canvas-query.js [--format json|table]
 * Requires: Chrome with --remote-debugging-port=9222, Flovart open
 */
const { FlovartClient } = require('./flovart-client');

const format = process.argv.includes('--format') ? process.argv[process.argv.indexOf('--format') + 1] : 'table';

(async () => {
  const client = new FlovartClient();
  await client.connect();
  const elements = await client.getElements();
  if (format === 'json') {
    console.log(JSON.stringify(elements, null, 2));
  } else {
    if (!elements || elements.length === 0) {
      console.log('Canvas is empty.');
    } else {
      console.log(`Canvas has ${elements.length} element(s):\n`);
      console.table(elements.map(e => ({ id: e.id.slice(0, 8), type: e.type, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height), visible: e.visible })));
    }
  }
  await client.disconnect();
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
