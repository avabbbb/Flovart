import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_COMMAND_REGISTRY } from '../tools/flovart/registry.js';
import { SKILL_COMMAND_NAMES } from '../tools/flovart/skill-commands.js';

const stableAgentSurface = [
  'ensure',
  'status',
  'workflow.inspect',
  'workflow.selection.get',
  'workflow.apply',
  'workflow.node.run',
];

const skillProjectionPaths = [
  '.agents/skills/flovart/SKILL.md',
  '.claude/skills/flovart/SKILL.md',
  'skills/flovart/SKILL.md',
];
const generatedSkillProjectionPath = 'tools/flovart/skill/SKILL.md';
const packageJson = JSON.parse(fs.readFileSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'package.json'), 'utf8'));
const minimumNodeVersion = String(packageJson.engines?.node || '').match(/\d+\.\d+\.\d+/)?.[0] || '';

const requiredDocPaths = [
  'README.md',
  'README.en.md',
  'README.zh-CN.md',
  'docs/overview/installation.zh-CN.md',
  'docs/overview/quick-start.md',
  'docs/overview/quick-start.en.md',
  'docs/overview/skill-guide.md',
  'docs/content/docs/overview/features.mdx',
  'docs/content/docs/overview/features.en.mdx',
  'docs/design/agent/README.md',
  '.agents/skills/flovart/SKILL.md',
  '.claude/skills/flovart/SKILL.md',
  'skills/flovart/SKILL.md',
  'skills/flovart/scripts/install.md',
];

const compatibilityMarker = /legacy|compatib|diagnos|debug|deprecated|historical|retired|removed|曾|历史|兼容|诊断|调试|旧路径|迁移|仅用于|不再|删除|替换|only for/i;
const pseudoCliCommands = new Set(['install', 'start', 'update']);
const lifecycleCommands = new Set(['ensure']);
const commandInvocation = /(?:npx\s+flovart-cli|npm\s+run\s+flovart:cli\s+--|flovart-cli)\s+([a-z][a-z0-9]*(?:[.-][a-z0-9]+)*)/gi;
const schemaCommand = /--command\s+([a-z][a-z0-9]*(?:[.-][a-z0-9]+)*)/gi;
const publicDocPath = /^(?:README(?:\.en|\.zh-CN)?\.md|docs\/overview\/|docs\/content\/docs\/)/i;
const installerVersion = /Flovart[_ -](\d+\.\d+\.\d+)_x64-setup\.exe/gi;
const tagVersion = /\bgit tag v(\d+\.\d+\.\d+)\b/gi;
const retiredPublicPathPatterns = [
  [/\bcanvas\.inspect\b/i, 'canvas.inspect'],
  [/\.flovart[\\/]command-queue\.json/i, 'file command queue'],
  [/\bfile-state\s+runtime\b/i, 'file-state runtime'],
  [/\binit\s+--host\b/i, 'init --host'],
];

function commandDocs(rootDir) {
  const directory = path.join(rootDir, 'skills/flovart/commands');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => path.join('skills/flovart/commands', name));
}

function gitVisibleDocPaths(rootDir) {
  let paths;
  try {
    paths = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: rootDir })
      .toString().split('\0').filter(Boolean);
  } catch {
    paths = [];
  }
  return paths.filter(relativePath => /\.(?:md|mdx)$/i.test(relativePath));
}

function readDocs(rootDir, relativePaths, errors) {
  return relativePaths.map(relativePath => {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`${relativePath}: documented release surface file is missing`);
      return { relativePath, text: '' };
    }
    return { relativePath, text: fs.readFileSync(absolutePath, 'utf8') };
  });
}

function mentionedCommands(text) {
  const commands = new Set();
  for (const match of text.matchAll(commandInvocation)) commands.add(match[1].toLowerCase());
  for (const match of text.matchAll(schemaCommand)) commands.add(match[1].toLowerCase());
  return [...commands];
}

export function checkDocsContract({ rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') } = {}) {
  const errors = [];
  const currentVersion = fs.readFileSync(path.join(rootDir, 'VERSION'), 'utf8').trim();
  const discoveredDocs = [
    ...gitVisibleDocPaths(rootDir),
    ...requiredDocPaths,
    ...commandDocs(rootDir),
    ...(fs.existsSync(path.join(rootDir, generatedSkillProjectionPath)) ? [generatedSkillProjectionPath] : []),
  ];
  const docs = readDocs(rootDir, [...new Set(discoveredDocs)], errors);

  for (const { relativePath, text } of docs) {
    for (const command of mentionedCommands(text)) {
      if (command.startsWith('<') || pseudoCliCommands.has(command) || lifecycleCommands.has(command) || command === 'tui' || SKILL_COMMAND_NAMES.has(command)) continue;
      const definition = CANONICAL_COMMAND_REGISTRY[command];
      if (!definition) {
        errors.push(`${relativePath}: command ${command} is not in the canonical registry`);
        continue;
      }
      if (definition.availability === 'legacy-only' && !compatibilityMarker.test(text)) {
        errors.push(`${relativePath}: legacy-only command ${command} needs a compatibility/diagnostic marker`);
      }
    }
  }

  for (const relativePath of docs.map(doc => doc.relativePath)) {
    const text = docs.find(doc => doc.relativePath === relativePath)?.text || '';
    if (mentionedCommands(text).some(command => command === 'command.list' || command === 'command.schema') && !compatibilityMarker.test(text)) {
      errors.push(`${relativePath}: command.list/schema must be described as bootstrap, compatibility, diagnostic, or debug only`);
    }
    for (const [pattern, label] of [
      [/\binit\s+--host\b/i, 'init --host'],
      [/\bcanvas\.inspect\b/i, 'canvas.inspect'],
      [/\.flovart[\\/]command-queue\.json/i, 'file command queue'],
    ]) {
      if (pattern.test(text) && !compatibilityMarker.test(text)) errors.push(`${relativePath}: removed path ${label} is still documented`);
    }
    if (publicDocPath.test(relativePath)) {
      for (const [pattern, label] of retiredPublicPathPatterns) {
        if (pattern.test(text)) errors.push(`${relativePath}: public documentation still contains retired path ${label}`);
      }
      for (const match of text.matchAll(installerVersion)) {
        if (match[1] !== currentVersion) errors.push(`${relativePath}: installer version ${match[1]} does not match VERSION ${currentVersion}`);
      }
      for (const match of text.matchAll(tagVersion)) {
        if (match[1] !== currentVersion) errors.push(`${relativePath}: release tag version ${match[1]} does not match VERSION ${currentVersion}`);
      }
    }
  }

for (const relativePath of skillProjectionPaths) {
  const text = docs.find(doc => doc.relativePath === relativePath)?.text || '';
  for (const command of stableAgentSurface) {
    if (!text.includes(`\`${command}\``)) errors.push(`${relativePath}: stable Agent command ${command} is missing`);
  }
  if (minimumNodeVersion && !text.includes(`Node.js ${minimumNodeVersion}`)) {
    errors.push(`${relativePath}: minimum Node.js version is not aligned with package.json (${minimumNodeVersion})`);
  }
}

  const canonicalSkill = fs.existsSync(path.join(rootDir, skillProjectionPaths[0]))
    ? fs.readFileSync(path.join(rootDir, skillProjectionPaths[0]), 'utf8') : '';
  for (const relativePath of skillProjectionPaths.slice(1)) {
    const projection = fs.existsSync(path.join(rootDir, relativePath))
      ? fs.readFileSync(path.join(rootDir, relativePath), 'utf8') : '';
    if (projection !== canonicalSkill) errors.push(`${relativePath} has drifted from ${skillProjectionPaths[0]}`);
  }

  if (fs.existsSync(path.join(rootDir, generatedSkillProjectionPath))) {
    const generatedSkill = fs.readFileSync(path.join(rootDir, generatedSkillProjectionPath), 'utf8');
    if (generatedSkill !== canonicalSkill) errors.push(`${generatedSkillProjectionPath} has drifted from ${skillProjectionPaths[0]}`);
  }

  return { errors, files: docs.map(doc => doc.relativePath) };
}

function main() {
  const result = checkDocsContract();
  if (result.errors.length) {
    console.error(result.errors.map(error => `- ${error}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`Docs contract OK: ${result.files.length} files checked.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
