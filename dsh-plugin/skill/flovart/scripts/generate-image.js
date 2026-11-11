#!/usr/bin/env node
/**
 * Generate an image on a running Flovart canvas.
 * Usage: node generate-image.js --prompt "a cat" [--source agent]
 * Requires: Chrome with --remote-debugging-port=9222, Flovart open
 */
const { FlovartClient } = require('./flovart-client');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const prompt = getArg('prompt');
if (!prompt) { console.error('Usage: node generate-image.js --prompt "..." [--source agent]'); process.exit(1); }
const source = getArg('source') || 'agent-script';

(async () => {
  const client = new FlovartClient();
  await client.connect();
  console.log(`Generating: "${prompt}"`);
  await client.generateImage(prompt, source);
  console.log('Generation triggered. Check the Flovart canvas.');
  await client.disconnect();
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
