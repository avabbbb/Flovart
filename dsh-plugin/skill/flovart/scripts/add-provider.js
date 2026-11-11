#!/usr/bin/env node
/**
 * add-provider.js — Automate adding a new AI Provider to Flovart
 *
 * Usage:
 *   node skills/flovart/scripts/add-provider.js \
 *     --name "myProvider" \
 *     --label "My Provider" \
 *     --models "text:model-a,model-b;image:model-img-1;video:model-vid-1" \
 *     --keyPrefix "^mp-" \
 *     --modelPrefix "^myp" \
 *     --baseUrl "https://api.myprovider.com/v1"
 *
 * Required: --name, --label
 * Optional: --models, --keyPrefix, --modelPrefix, --baseUrl
 */

const fs = require('fs');
const path = require('path');

// ── Parse args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const name = getArg('--name');
const label = getArg('--label');
const modelsRaw = getArg('--models') || '';
const keyPrefix = getArg('--keyPrefix') || '';
const modelPrefix = getArg('--modelPrefix') || '';
const baseUrl = getArg('--baseUrl') || '';

if (!name || !label) {
  console.error('Usage: node add-provider.js --name <id> --label <display> [--models "text:a,b;image:c"] [--keyPrefix "^xx-"] [--modelPrefix "^xx"] [--baseUrl "https://..."]');
  process.exit(1);
}

// Validate provider name: lowercase, no special chars
if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
  console.error('Error: --name must be alphanumeric (e.g. "myProvider")');
  process.exit(1);
}

// Parse models string: "text:a,b;image:c;video:d"
const models = { text: [], image: [], video: [] };
if (modelsRaw) {
  for (const part of modelsRaw.split(';')) {
    const [cap, ...rest] = part.split(':');
    const modelList = rest.join(':').split(',').map(m => m.trim()).filter(Boolean);
    if (cap in models) models[cap] = modelList;
  }
}

const ROOT = path.resolve(__dirname, '..', '..', '..');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function writeFile(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
}

let changes = 0;

// ── 1. types.ts — AIProvider union ──────────────────────────────────
{
  const file = 'types.ts';
  let src = readFile(file);
  const re = /export type AIProvider\s*=\s*([^;]+);/;
  const match = src.match(re);
  if (!match) { console.error('❌ Could not find AIProvider type in types.ts'); process.exit(1); }
  if (match[1].includes(`'${name}'`)) {
    console.log(`⏭️  types.ts: '${name}' already in AIProvider`);
  } else {
    const newUnion = match[1].trimEnd() + ` | '${name}'`;
    src = src.replace(re, `export type AIProvider = ${newUnion};`);
    writeFile(file, src);
    console.log(`✅ types.ts: added '${name}' to AIProvider`);
    changes++;
  }
}

// ── 2. aiGateway.ts — PROVIDER_LABELS ───────────────────────────────
{
  const file = 'services/aiGateway.ts';
  let src = readFile(file);

  // Add to PROVIDER_LABELS
  if (src.includes(`${name}:`)) {
    console.log(`⏭️  PROVIDER_LABELS: '${name}' already exists`);
  } else {
    // Insert before the closing }; of PROVIDER_LABELS
    const marker = "custom: '自定义',";
    if (!src.includes(marker)) { console.error('❌ Could not find PROVIDER_LABELS marker'); process.exit(1); }
    src = src.replace(marker, `${name}: '${label}',\n    ${marker}`);
    console.log(`✅ PROVIDER_LABELS: added '${name}'`);
    changes++;
  }

  // ── 3. DEFAULT_PROVIDER_MODELS ────────────────────────────────────
  {
    const modelsBlock = `    ${name}: {\n        text: [${models.text.map(m => `'${m}'`).join(', ')}],\n        image: [${models.image.map(m => `'${m}'`).join(', ')}],\n        video: [${models.video.map(m => `'${m}'`).join(', ')}],\n    },`;
    // Insert before the closing }; of DEFAULT_PROVIDER_MODELS
    // Find the last provider entry before the closing
    const dpMatch = src.match(/export const DEFAULT_PROVIDER_MODELS[\s\S]*?openrouter:\s*\{[\s\S]*?\},/);
    if (dpMatch) {
      const insertPoint = dpMatch.index + dpMatch[0].length;
      src = src.slice(0, insertPoint) + '\n' + modelsBlock + src.slice(insertPoint);
      console.log(`✅ DEFAULT_PROVIDER_MODELS: added '${name}'`);
      changes++;
    } else {
      console.error('⚠️  Could not find DEFAULT_PROVIDER_MODELS insertion point');
    }
  }

  // ── 4. inferProviderFromKey ───────────────────────────────────────
  if (keyPrefix) {
    const keyMarker = 'return null;\n}';
    if (src.includes(keyMarker)) {
      src = src.replace(keyMarker, `if (/${keyPrefix}/i.test(trimmed)) return '${name}';\n    return null;\n}`);
      console.log(`✅ inferProviderFromKey: added pattern ${keyPrefix}`);
      changes++;
    }
  }

  // ── 5. inferProviderFromModel ─────────────────────────────────────
  if (modelPrefix) {
    const modelMarker = "return 'custom';";
    if (src.includes(modelMarker)) {
      src = src.replace(modelMarker, `if (/${modelPrefix}/i.test(model)) return '${name}';\n    return 'custom';`);
      console.log(`✅ inferProviderFromModel: added pattern ${modelPrefix}`);
      changes++;
    }
  }

  writeFile(file, src);
}

// ── 6. baseUrl.ts — normalizeProviderBaseUrl ────────────────────────
if (baseUrl) {
  const file = 'services/baseUrl.ts';
  let src = readFile(file);
  // Add provider-specific base URL normalization before the final return
  const marker = "return `${origin}/v1`;";
  if (src.includes(marker) && !src.includes(`provider === '${name}'`)) {
    src = src.replace(marker, `if (provider === '${name}') {\n        return \`\${origin}${new URL(baseUrl).pathname}\`;\n    }\n    ${marker}`);
    writeFile(file, src);
    console.log(`✅ baseUrl.ts: added URL normalization for '${name}'`);
    changes++;
  }
}

console.log(`\n🎉 Done! ${changes} file(s) modified.`);
if (changes > 0) {
  console.log('Next steps:');
  console.log('  1. npm run build  — verify build passes');
  console.log('  2. npm run test   — verify tests pass');
  console.log(`  3. Add generation routing in aiGateway.ts generateImageWithProvider() / generateVideoWithProvider() if needed`);
}
