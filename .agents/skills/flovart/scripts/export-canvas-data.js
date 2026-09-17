#!/usr/bin/env node
/**
 * Export Flovart canvas data to JSON for use by other skills.
 *
 * Usage:
 *   node export-canvas-data.js [--output canvas.json] [--include-urls]
 *
 * Requires: Chrome with --remote-debugging-port=9222, Flovart open
 */
const { FlovartClient } = require('./flovart-client');
const fs = require('fs');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const output = getArg('output') || 'canvas-export.json';

(async () => {
  const client = new FlovartClient();
  await client.connect();

  const elements = await client.getElements();
  const zoom = await client.execute('view.getZoom');
  const pan = await client.execute('view.getPan');
  const providers = await client.getProviders();

  await client.disconnect();

  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    canvas: { zoom, pan, elementCount: elements?.length || 0 },
    elements: elements || [],
    config: { providers },
  };

  fs.writeFileSync(output, JSON.stringify(exportData, null, 2));
  console.log(`Exported ${exportData.canvas.elementCount} elements to ${output}`);
  console.log(`Canvas: zoom=${zoom}, pan=(${pan?.x}, ${pan?.y})`);
  console.log(`Providers: ${providers?.join(', ')}`);
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
