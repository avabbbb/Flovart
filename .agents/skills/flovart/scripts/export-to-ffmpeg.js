#!/usr/bin/env node
/**
 * Export Flovart canvas elements to FFmpeg-compatible format.
 *
 * Outputs a concat list or shell script for FFmpeg composition.
 *
 * Usage:
 *   node export-to-ffmpeg.js [--output concat.txt] [--format concat|script]
 *
 * Requires: Chrome with --remote-debugging-port=9222, Flovart open
 */
const { FlovartClient } = require('./flovart-client');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const output = getArg('output') || 'flovart-export.txt';
const format = getArg('format') || 'concat';
const duration = getArg('duration') || '3'; // seconds per image

(async () => {
  const client = new FlovartClient();
  await client.connect();
  const elements = await client.getElements();
  await client.disconnect();

  if (!elements || elements.length === 0) {
    console.log('Canvas is empty, nothing to export.');
    process.exit(0);
  }

  // Filter image elements that have src/name
  const mediaElements = elements.filter(e => e.type === 'image' || e.type === 'video');
  if (mediaElements.length === 0) {
    console.log('No image/video elements found on canvas.');
    process.exit(0);
  }

  // Sort by x position (left to right) as timeline order
  mediaElements.sort((a, b) => a.x - b.x);

  if (format === 'concat') {
    // FFmpeg concat demuxer format
    const lines = mediaElements.map((el, i) => {
      const filename = el.name || `element_${i + 1}`;
      return `file '${filename}'\nduration ${duration}`;
    });
    fs.writeFileSync(output, lines.join('\n') + '\n');
    console.log(`Exported ${mediaElements.length} items to ${output} (FFmpeg concat format)`);
    console.log(`Usage: ffmpeg -f concat -safe 0 -i ${output} -c copy output.mp4`);
  } else if (format === 'script') {
    // Shell script with FFmpeg commands
    const lines = [
      '#!/bin/bash',
      '# Flovart Canvas → FFmpeg composition script',
      `# Generated from ${mediaElements.length} canvas elements`,
      '',
      '# Step 1: Create video from images',
    ];
    mediaElements.forEach((el, i) => {
      const name = el.name || `element_${i + 1}`;
      lines.push(`# Element ${i + 1}: ${el.type} "${name}" at (${Math.round(el.x)}, ${Math.round(el.y)})`);
    });
    lines.push('', '# Concatenate all into final video:');
    lines.push(`ffmpeg -f concat -safe 0 -i ${output.replace('.txt', '_concat.txt')} -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p output.mp4`);
    
    const scriptFile = output.replace('.txt', '.sh');
    fs.writeFileSync(scriptFile, lines.join('\n') + '\n');
    console.log(`Exported script to ${scriptFile}`);
  } else {
    // JSON export of element metadata
    fs.writeFileSync(output, JSON.stringify(mediaElements, null, 2));
    console.log(`Exported ${mediaElements.length} elements as JSON to ${output}`);
  }
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
