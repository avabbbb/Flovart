#!/usr/bin/env node
/**
 * Import images/videos from LibTV (libtv-skill) session into Flovart canvas.
 *
 * Workflow: libtv-skill generates content → this script downloads results → places on Flovart canvas.
 *
 * Usage:
 *   node import-from-libtv.js --session <sessionId> [--layout grid|row|stack]
 *
 * Requires:
 *   - LIBTV_ACCESS_KEY env var
 *   - Chrome with --remote-debugging-port=9222
 *   - Flovart open in a tab
 */
const { FlovartClient } = require('./flovart-client');
const https = require('https');
const http = require('http');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const sessionId = getArg('session');
const accessKey = process.env.LIBTV_ACCESS_KEY;
const layout = getArg('layout') || 'grid';
const imBase = process.env.OPENAPI_IM_BASE || process.env.IM_BASE_URL || 'https://im.liblib.tv';

if (!sessionId || !accessKey) {
  console.error('Usage: set LIBTV_ACCESS_KEY first, then run node import-from-libtv.js --session <id> [--layout grid|row|stack]');
  console.error('Or set LIBTV_ACCESS_KEY env var.');
  process.exit(1);
}

async function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function layoutPositions(count, style) {
  const positions = [];
  const size = 300;
  const gap = 20;
  for (let i = 0; i < count; i++) {
    if (style === 'row') {
      positions.push({ x: i * (size + gap), y: 0 });
    } else if (style === 'stack') {
      positions.push({ x: i * 30, y: i * 30 });
    } else { // grid
      const cols = Math.ceil(Math.sqrt(count));
      positions.push({ x: (i % cols) * (size + gap), y: Math.floor(i / cols) * (size + gap) });
    }
  }
  return positions;
}

(async () => {
  // 1. Fetch session messages from LibTV
  console.log(`Fetching session ${sessionId} from LibTV...`);
  const url = `${imBase}/api/open/v2/session/messages/${sessionId}`;
  const data = await fetchJson(url, { 'Access-Key': accessKey });

  if (!data?.data?.messages) {
    console.error('Failed to fetch session messages:', JSON.stringify(data));
    process.exit(1);
  }

  // 2. Extract image/video URLs from messages
  const mediaUrls = [];
  for (const msg of data.data.messages) {
    if (msg.imageUrls) mediaUrls.push(...msg.imageUrls.map(u => ({ url: u, type: 'image' })));
    if (msg.videoUrls) mediaUrls.push(...msg.videoUrls.map(u => ({ url: u, type: 'video' })));
    // Also check content for embedded URLs
    if (msg.content) {
      const urlRegex = /https?:\/\/[^\s"']+\.(png|jpg|jpeg|webp|mp4|mov)/gi;
      const matches = msg.content.match(urlRegex) || [];
      for (const m of matches) {
        if (!mediaUrls.find(u => u.url === m)) {
          mediaUrls.push({ url: m, type: m.match(/\.(mp4|mov)$/i) ? 'video' : 'image' });
        }
      }
    }
  }

  if (mediaUrls.length === 0) {
    console.log('No media found in session. The generation may still be in progress.');
    process.exit(0);
  }

  console.log(`Found ${mediaUrls.length} media item(s). Importing to canvas...`);

  // 3. Connect to Flovart and add elements
  const client = new FlovartClient();
  await client.connect();

  const positions = layoutPositions(mediaUrls.length, layout);
  for (let i = 0; i < mediaUrls.length; i++) {
    const { url: mediaUrl, type } = mediaUrls[i];
    const { x, y } = positions[i];
    if (type === 'image') {
      await client.addElement({ type: 'image', src: mediaUrl, x, y, width: 300, height: 300, name: `LibTV Import ${i + 1}` });
    } else {
      await client.addElement({ type: 'image', src: mediaUrl, x, y, width: 400, height: 225, name: `LibTV Video ${i + 1}` });
    }
    console.log(`  [${i + 1}/${mediaUrls.length}] ${type}: added at (${x}, ${y})`);
  }

  console.log('Import complete!');
  await client.disconnect();
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
