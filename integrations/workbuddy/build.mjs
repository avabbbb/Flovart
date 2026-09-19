import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'flovart');
const output = resolve(root, '..', '..', '..', 'dist-workbuddy', 'flovart');
const workspace = resolve(root, '..', '..', '..');
if (!output.startsWith(`${workspace}${sep}`)) throw new Error('WorkBuddy output escaped the workspace');
// The official WorkBuddy CLI-connector pattern installs the CLI directly from
// a published npm package — npm install -g @flovart/cli@latest — with no
// intermediate installer package. Because @flovart/cli is not yet published,
// the connector is structurally valid but cannot self-install; publication is
// an EXTERNAL_RELEASE_GATE. We therefore require init to reference the real
// package specifier (not a missing pinned tarball / nonexistent local file /
// removed @flovart/workbuddy-installer layer) and surface the release
// dependency explicitly.

const required = [
  'connector-meta.json',
  'cli.json',
  'icon.svg',
  'skills/flovart/SKILL.md',
  'skills/flovart/references/workflow.md',
];
const meta = JSON.parse(readFileSync(join(root, 'connector-meta.json'), 'utf8'));
const cli = JSON.parse(readFileSync(join(root, 'cli.json'), 'utf8'));
if (meta.type !== 'cli' || meta.source !== 'flovart') throw new Error('WorkBuddy connector must be a CLI connector with a unique source');
for (const platform of ['darwin', 'linux', 'win32']) {
  for (const section of ['init', 'auth', 'status', 'unAuth']) {
    if (typeof cli[section]?.[platform] !== 'string' || !cli[section][platform]) throw new Error(`WorkBuddy cli.json missing ${section}.${platform}`);
  }
}
for (const file of required) if (!existsSync(join(root, file))) throw new Error(`WorkBuddy connector missing ${file}`);
if (JSON.stringify(cli).match(/(?:api.?key|provider.?key|secret|token)/i)) throw new Error('WorkBuddy connector contains a credential-shaped config key');
// init must install the canonical @flovart/cli package directly. The retired
// @flovart/workbuddy-installer indirection and the never-published flovart-cli
// name are both structural defects, not release gates.
const canonicalInit = /npm\s+install\s+-g\s+@flovart\/cli(?:@[\w.-]+)?\s*$/;
for (const platform of ['darwin', 'linux', 'win32']) {
  const initCmd = cli.init[platform];
  if (/@flovart\/workbuddy-installer/.test(initCmd)) throw new Error(`WorkBuddy cli.json init.${platform} routes through the removed @flovart/workbuddy-installer layer; init must install @flovart/cli directly`);
  if (!canonicalInit.test(initCmd)) throw new Error(`WorkBuddy cli.json init.${platform} must be 'npm install -g @flovart/cli@<spec>' (EXTERNAL_RELEASE_GATE: publish @flovart/cli)`);
}
if (readFileSync(join(root, 'skills/flovart/SKILL.md'), 'utf8').match(/(?:agentUrl|agentToken|x-flovart-agent-token|MCP|端口|Token)/i)) throw new Error('WorkBuddy Skill leaks connection implementation details');

if (existsSync(resolve(workspace, 'dist-workbuddy'))) rmSync(resolve(workspace, 'dist-workbuddy'), { recursive: true, force: true });
mkdirSync(dirname(output), { recursive: true });
cpSync(root, output, { recursive: true });
console.log(`[workbuddy] validated CLI connector at ${output}`);
