#!/usr/bin/env node
/**
 * Import RunningHub generation results into Flovart canvas.
 *
 * Usage:
 *   node import-from-runninghub.js --task <taskId> [--layout grid|row]
 *
 * Requires:
 *   - RUNNINGHUB_API_KEY env var (or --key flag)
 *   - Chrome with --remote-debugging-port=9222
 *   - Flovart open in a tab
 */
const { FlovartClient } = require('./flovart-client');
const https = require('https');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const taskId = getArg('task');
const apiKey = getArg('key') || process.env.RUNNINGHUB_API_KEY;
const layout = getArg('layout') || 'grid';

if (!taskId || !apiKey) {
  console.error('Usage: node import-from-runninghub.js --task <taskId> [--key <apiKey>] [--layout grid|row]');
  process.exit(1);
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log(`Fetching RunningHub task ${taskId}...`);
  const result = await postJson('https://www.runninghub.cn/api/task/openapi/outputs', {
    taskId, apiKey,
  });

  if (result.code !== 0 || !result.data) {
    console.error('Failed:', result.msg || JSON.stringify(result));
    process.exit(1);
  }

  const outputs = result.data.filter(d => d.fileUrl);
  if (outputs.length === 0) {
    console.log('No output files found. Task may still be running.');
    process.exit(0);
  }

  console.log(`Found ${outputs.length} output(s). Importing to canvas...`);
  const client = new FlovartClient();
  await client.connect();

  const cols = Math.ceil(Math.sqrt(outputs.length));
  for (let i = 0; i < outputs.length; i++) {
    const { fileUrl, fileType } = outputs[i];
    const isVideo = fileType === 'video' || fileUrl.match(/\.(mp4|mov|webm)$/i);
    const x = layout === 'row' ? i * 320 : (i % cols) * 320;
    const y = layout === 'row' ? 0 : Math.floor(i / cols) * 320;
    await client.addElement({
      type: 'image', src: fileUrl, x, y,
      width: isVideo ? 400 : 300, height: isVideo ? 225 : 300,
      name: `RunningHub ${taskId.slice(0, 8)} #${i + 1}`,
    });
    console.log(`  [${i + 1}/${outputs.length}] imported at (${x}, ${y})`);
  }

  console.log('Import complete!');
  await client.disconnect();
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
