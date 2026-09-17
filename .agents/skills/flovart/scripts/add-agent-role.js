#!/usr/bin/env node
/**
 * add-agent-role.js — Add a new Agent role to Flovart's multi-agent orchestrator
 *
 * Usage:
 *   node skills/flovart/scripts/add-agent-role.js \
 *     --id "brand_strategist" \
 *     --name "品牌策略师" \
 *     --emoji "📊" \
 *     --color "#3B82F6" \
 *     --description "从品牌视角审视视觉方案" \
 *     --systemPrompt "你是一位品牌策略师。你的职责是..."
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const id = getArg('--id');
const name = getArg('--name');
const emoji = getArg('--emoji') || '🎯';
const color = getArg('--color') || '#6366F1';
const description = getArg('--description');
const systemPrompt = getArg('--systemPrompt');

if (!id || !name || !description || !systemPrompt) {
  console.error('Usage: node add-agent-role.js --id <role_id> --name <display> --description <desc> --systemPrompt <prompt> [--emoji 🎯] [--color #hex]');
  process.exit(1);
}

if (!/^[a-z_]+$/.test(id)) {
  console.error('Error: --id must be lowercase with underscores (e.g. "brand_strategist")');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..', '..', '..');
const file = path.join(ROOT, 'services', 'agentOrchestrator.ts');
let src = fs.readFileSync(file, 'utf8');

// Check if role already exists
if (src.includes(`id: '${id}'`)) {
  console.log(`⏭️  Role '${id}' already exists in PRESET_ROLES`);
  process.exit(0);
}

// Also need to add to AgentRoleId type in types.ts
const typesFile = path.join(ROOT, 'types.ts');
let typesSrc = fs.readFileSync(typesFile, 'utf8');
const roleIdRe = /export type AgentRoleId\s*=\s*([^;]+);/;
const roleIdMatch = typesSrc.match(roleIdRe);
if (roleIdMatch && !roleIdMatch[1].includes(`'${id}'`)) {
  const newUnion = roleIdMatch[1].trimEnd() + ` | '${id}'`;
  typesSrc = typesSrc.replace(roleIdRe, `export type AgentRoleId = ${newUnion};`);
  fs.writeFileSync(typesFile, typesSrc, 'utf8');
  console.log(`✅ types.ts: added '${id}' to AgentRoleId`);
}

// Insert new role before the closing ]; of PRESET_ROLES
const quote = value => JSON.stringify(String(value));
const roleBlock = `    {
        id: ${quote(id)},
        name: ${quote(name)},
        emoji: ${quote(emoji)},
        color: ${quote(color)},
        description: ${quote(description)},
        systemPrompt: ${quote(systemPrompt)},
    },`;

// Find the last role entry (quality_reviewer) closing brace and insert after
const marker = "description: '审查最终提示词并提出修改',";
const markerIdx = src.indexOf(marker);
if (markerIdx === -1) {
  console.error('❌ Could not find PRESET_ROLES insertion point');
  process.exit(1);
}

// Find the closing },  after the quality_reviewer systemPrompt
const afterMarker = src.indexOf('},', markerIdx + marker.length);
if (afterMarker === -1) {
  console.error('❌ Could not find role closing brace');
  process.exit(1);
}

const insertPoint = afterMarker + 2; // after },
src = src.slice(0, insertPoint) + '\n' + roleBlock + src.slice(insertPoint);
fs.writeFileSync(file, src, 'utf8');

console.log(`✅ agentOrchestrator.ts: added role '${id}' (${emoji} ${name})`);
console.log('\n🎉 Done! Run `npm run build` to verify.');
