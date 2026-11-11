#!/usr/bin/env node
/**
 * Batch generate images from a list of prompts.
 * Usage: node batch-generate.js --file prompts.txt [--delay 2000]
 * Each line in prompts.txt = one prompt.
 * Requires: Chrome with --remote-debugging-port=9222, Flovart open
 */
const { FlovartClient } = require('./flovart-client');
const fs = require('fs');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const file = getArg('file');
if (!file) { console.error('Usage: node batch-generate.js --file prompts.txt [--delay 2000]'); process.exit(1); }
const delay = parseInt(getArg('delay') || '3000', 10);

(async () => {
  const prompts = fs.readFileSync(file, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`Loaded ${prompts.length} prompts from ${file}`);

  const client = new FlovartClient();
  await client.connect();

  for (let i = 0; i < prompts.length; i++) {
    console.log(`[${i + 1}/${prompts.length}] "${prompts[i]}"`);
    await client.generateImage(prompts[i], 'batch-script');
    if (i < prompts.length - 1) await new Promise(r => setTimeout(r, delay));
  }

  console.log('All generations triggered.');
  await client.disconnect();
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
