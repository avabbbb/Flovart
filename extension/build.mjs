/**
 * Flovart Extension Build Script
 *
 * 1. Runs `vite build` to produce dist/ (the full app)
 * 2. Copies dist/ → dist-extension/app/
 * 3. Copies extension manifest, popup, background, content → dist-extension/
 * 4. Generates placeholder icons
 *
 * Usage: node extension/build.mjs
 */

import { execSync } from 'child_process';
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const EXT_SRC = resolve(ROOT, 'extension');
const OUT = resolve(ROOT, 'dist-extension');

console.log('🔨 [Flovart] Building extension...\n');

// Step 1: Build the main app
console.log('📦 Step 1/4: Building main app with Vite...');
execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });

// Step 2: Clean and create output dir
console.log('\n📂 Step 2/4: Preparing extension output...');
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Step 3: Copy files
console.log('📋 Step 3/4: Assembling extension...');

// Copy app build output
cpSync(DIST, resolve(OUT, 'app'), { recursive: true });

// Clean index.html: remove CDN scripts and importmap (CSP-incompatible)
const htmlPath = resolve(OUT, 'app', 'index.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*/g, '');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/g, '');
html = html.replace(/<title>Making<\/title>/, '<title>Flovart</title>');
writeFileSync(htmlPath, html);
console.log('  → Cleaned index.html (removed CDN scripts, updated title)');

// Copy manifest
cpSync(resolve(EXT_SRC, 'manifest.json'), resolve(OUT, 'manifest.json'));

// Copy _locales (i18n)
const localesSrc = resolve(EXT_SRC, '_locales');
if (existsSync(localesSrc)) {
  cpSync(localesSrc, resolve(OUT, '_locales'), { recursive: true });
}

// Copy popup
mkdirSync(resolve(OUT, 'popup'), { recursive: true });
cpSync(resolve(EXT_SRC, 'popup'), resolve(OUT, 'popup'), { recursive: true });

// Copy background
mkdirSync(resolve(OUT, 'background'), { recursive: true });
cpSync(resolve(EXT_SRC, 'background'), resolve(OUT, 'background'), { recursive: true });

// Copy content
mkdirSync(resolve(OUT, 'content'), { recursive: true });
cpSync(resolve(EXT_SRC, 'content'), resolve(OUT, 'content'), { recursive: true });

// Step 4: Generate minimal valid PNG icons (1x1 purple pixel, proper for dev loading)
console.log('🎨 Step 4/4: Generating dev icons...');
mkdirSync(resolve(OUT, 'icons'), { recursive: true });

// Minimal valid PNG generator (single-color icon)
function createMinimalPng(size) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);  // width
  ihdrData.writeUInt32BE(size, 4);  // height
  ihdrData.writeUInt8(8, 8);        // bit depth
  ihdrData.writeUInt8(2, 9);        // color type (RGB)
  ihdrData.writeUInt8(0, 10);       // compression
  ihdrData.writeUInt8(0, 11);       // filter
  ihdrData.writeUInt8(0, 12);       // interlace
  const ihdr = createChunk('IHDR', ihdrData);
  
  // IDAT chunk (uncompressed image data with zlib wrapper)
  const rawData = [];
  const radius = Math.max(2, Math.floor(size * 0.22)); // Apple-style corner radius

  for (let y = 0; y < size; y++) {
    rawData.push(0); // filter byte: None
    for (let x = 0; x < size; x++) {
      // Check if inside rounded rect (entire icon area)
      const inRoundedRect = isInRoundedRect(x, y, 0, 0, size, size, radius);

      if (!inRoundedRect) {
        // Transparent (black for RGB PNG — will appear as bg in browser chrome)
        rawData.push(0, 0, 0);
        continue;
      }

      // Gradient background: #FF453A (top) → #FF6961 (bottom)
      const t = y / size;
      const r = Math.round(255);
      const g = Math.round(69 + (105 - 69) * t);   // 69 → 105
      const b = Math.round(58 + (97 - 58) * t);     // 58 → 97

      // Draw white "F" letter and canvas strokes
      const fx = x / size;
      const fy = y / size;
      const sw = Math.max(1, Math.floor(size * 0.07)); // stroke width in px
      const sn = sw / size; // normalized stroke width

      // "F" letter — bold, centered
      const ox = 0.28; // letter offset-x (centered)
      const isVertical = fx >= ox && fx < ox + sn * 1.5 && fy > 0.22 && fy < 0.78;
      const isTopBar = fy >= 0.22 && fy < 0.22 + sn * 1.2 && fx >= ox && fx < 0.72;
      const isMidBar = fy >= 0.47 && fy < 0.47 + sn * 1.2 && fx >= ox && fx < 0.60;

      if (isVertical || isTopBar || isMidBar) {
        rawData.push(255, 255, 255); // white letter
      } else {
        rawData.push(r, g, b); // gradient fill
      }
    }
  }

  function isInRoundedRect(px, py, rx, ry, rw, rh, cr) {
    // Check four corners for rounded rect
    if (px < rx + cr && py < ry + cr) {
      return Math.hypot(px - (rx + cr), py - (ry + cr)) <= cr;
    }
    if (px >= rx + rw - cr && py < ry + cr) {
      return Math.hypot(px - (rx + rw - cr - 1), py - (ry + cr)) <= cr;
    }
    if (px < rx + cr && py >= ry + rh - cr) {
      return Math.hypot(px - (rx + cr), py - (ry + rh - cr - 1)) <= cr;
    }
    if (px >= rx + rw - cr && py >= ry + rh - cr) {
      return Math.hypot(px - (rx + rw - cr - 1), py - (ry + rh - cr - 1)) <= cr;
    }
    return px >= rx && px < rx + rw && py >= ry && py < ry + rh;
  }
  
  // Compress with Node.js zlib
  const rawBuf = Buffer.from(rawData);
  const zlibData = deflateSync(rawBuf);
  const idat = createChunk('IDAT', zlibData);
  
  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const png = createMinimalPng(size);
  writeFileSync(resolve(OUT, `icons/icon${size}.png`), png);
  console.log(`  → icons/icon${size}.png (${png.length} bytes)`);
}

console.log(`\n✅ Extension built successfully!`);
console.log(`📁 Output: ${OUT}`);
console.log(`\n📌 To install in Chrome/Edge:`);
console.log(`   1. Open chrome://extensions (or edge://extensions)`);
console.log(`   2. Enable "Developer mode"`);
console.log(`   3. Click "Load unpacked" → select: ${OUT}`);
console.log(`\n⚠️  Note: Replace placeholder icon PNGs with real PNG files for production.`);
