import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'flovart');
const output = resolve(root, '..', '..', '..', 'dist-workbuddy', 'flovart');
const workspace = resolve(root, '..', '..', '..');
if (!output.startsWith(`${workspace}${sep}`)) throw new Error('WorkBuddy output escaped the workspace');
// The official WorkBuddy CLI-connector pattern installs the CLI from a
// published npm package or a published installer (npx -y @scope/installer),
// never a bundle-local relative path. Because flovart-cli is not yet
// published, the connector is structurally valid but cannot self-install.
// We therefore require init to reference a real package specifier (not a
// missing pinned tarball / nonexistent local file) and surface the release
// dependency explicitly instead of shipping a broken npm install -g line.

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
// init must not reference a registry package name that we know is unpublished
// (flovart-cli@x.y.z was never published) nor a bundled file that does not
// exist. A scoped installer spec is allowed because it is a real, resolvable
// package once published — publication itself is an EXTERNAL_RELEASE_GATE.
for (const platform of ['darwin', 'linux', 'win32']) {
  const initCmd = cli.init[platform];
  if (/npm install -g\s+flovart-cli@/.test(initCmd)) throw new Error(`WorkBuddy cli.json init.${platform} installs unpublished package flovart-cli@ (EXTERNAL_RELEASE_GATE: publish flovart-cli or @flovart/workbuddy-installer)`);
}
if (readFileSync(join(root, 'skills/flovart/SKILL.md'), 'utf8').match(/(?:agentUrl|agentToken|x-flovart-agent-token|MCP|端口|Token)/i)) throw new Error('WorkBuddy Skill leaks connection implementation details');

if (existsSync(resolve(workspace, 'dist-workbuddy'))) rmSync(resolve(workspace, 'dist-workbuddy'), { recursive: true, force: true });
mkdirSync(dirname(output), { recursive: true });
cpSync(root, output, { recursive: true });
console.log(`[workbuddy] validated CLI connector at ${output}`);
