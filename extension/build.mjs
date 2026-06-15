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

// Step 4: Copy real icons from extension/icons/ (generated from pic/LOGO.png)
console.log('🎨 Step 4/4: Copying extension icons...');
mkdirSync(resolve(OUT, 'icons'), { recursive: true });
cpSync(resolve(EXT_SRC, 'icons'), resolve(OUT, 'icons'), { recursive: true });
console.log('  → Copied all icons from extension/icons/');

console.log(`\n✅ Extension built successfully!`);
console.log(`📁 Output: ${OUT}`);
console.log(`\n📌 To install in Chrome/Edge:`);
console.log(`   1. Open chrome://extensions (or edge://extensions)`);
console.log(`   2. Enable "Developer mode"`);
console.log(`   3. Click "Load unpacked" → select: ${OUT}`);
console.log(`\n⚠️  Note: Replace placeholder icon PNGs with real PNG files for production.`);
