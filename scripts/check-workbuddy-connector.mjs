import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 22: dedicated static validation for the WorkBuddy CLI connector.
// integrations/workbuddy/build.mjs already validates structure while copying;
// this script exists so the connector can be checked without building, and so
// the release gate is reported honestly: a connector whose init installs the
// canonical @flovart/cli package is *structurally valid* but stays gated on
// npm publication — it is not "connector ready" until the package resolves.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const connectorRoot = join(root, 'integrations', 'workbuddy', 'flovart');

const platforms = ['darwin', 'linux', 'win32'];
const lifecycleSections = ['init', 'auth', 'unAuth', 'status'];
const requiredFiles = [
  'connector-meta.json',
  'cli.json',
  'skills/flovart/SKILL.md',
];

// The connector installs the canonical CLI package directly — there is no
// intermediate installer layer. @flovart/workbuddy-installer was retired and
// must never come back; the unscoped flovart-cli name was never published.
const canonicalCliPackage = '@flovart/cli';
const canonicalInit = /npm\s+install\s+-g\s+@flovart\/cli(?:@[\w.-]+)?\s*$/;
// Registry specifiers that must not appear in init: the never-published
// unscoped name and the removed installer indirection.
const forbiddenInitSpecifiers = [/flovart-cli@/, /@flovart\/workbuddy-installer/];

const credentialKey = /"(?:api.?key|provider.?key|secret|token|password|credential)"\s*:/i;
// SKILL.md is user-facing guidance for the WorkBuddy agent; it must not leak
// host connection implementation details (tokens, MCP, ports, agent URLs).
const connectionJargon = /agentUrl|agentToken|x-flovart-agent-token|MCP|端口|Token/i;

function readJson(relativePath, errors) {
  const absolute = join(connectorRoot, relativePath);
  if (!existsSync(absolute)) {
    errors.push(`missing ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    errors.push(`${relativePath} does not parse: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function checkWorkBuddyConnector({ connectorDir = connectorRoot, cliSource = join(root, 'tools', 'flovart', 'cli.js') } = {}) {
  const errors = [];
  const notes = [];
  const dir = connectorDir;
  const read = relativePath => {
    const absolute = join(dir, relativePath);
    if (!existsSync(absolute)) { errors.push(`missing ${relativePath}`); return null; }
    try {
      return JSON.parse(readFileSync(absolute, 'utf8'));
    } catch (error) {
      errors.push(`${relativePath} does not parse: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  for (const file of requiredFiles) {
    if (!existsSync(join(dir, file))) errors.push(`missing ${file}`);
  }

  // --- connector-meta.json ---
  const meta = existsSync(join(dir, 'connector-meta.json')) ? read('connector-meta.json') : null;
  if (meta) {
    if (typeof meta.name !== 'string' || !meta.name) errors.push('connector-meta.json missing required field: name');
    if (meta.type !== 'cli') errors.push(`connector-meta.json type must be 'cli', got ${JSON.stringify(meta.type)}`);
    if (typeof meta.source !== 'string' || !meta.source) errors.push('connector-meta.json missing required field: source');
    if (typeof meta.version !== 'string' || !meta.version) errors.push('connector-meta.json missing required field: version');
  }

  // --- cli.json lifecycle matrix ---
  const cli = existsSync(join(dir, 'cli.json')) ? read('cli.json') : null;
  if (cli) {
    for (const platform of platforms) {
      for (const section of lifecycleSections) {
        if (typeof cli[section]?.[platform] !== 'string' || !cli[section][platform]) {
          errors.push(`cli.json missing ${section}.${platform}`);
        }
      }
    }
    if (typeof cli.statusMatch !== 'string' || !cli.statusMatch) errors.push('cli.json missing statusMatch');

    // Credential-shaped keys anywhere in cli.json.
    const cliText = JSON.stringify(cli);
    if (credentialKey.test(cliText)) errors.push('cli.json contains a credential-shaped config key');

    // --- Phase 22: canonical-package regression ---
    // init must install the canonical CLI package directly. The retired
    // installer indirection and the unscoped flovart-cli name are structural
    // defects; @flovart/cli itself is real but unpublished, so it surfaces as
    // an EXTERNAL_RELEASE_GATE note rather than an error.
    let sawCanonicalInit = false;
    for (const platform of platforms) {
      const initCmd = cli.init?.[platform];
      if (typeof initCmd !== 'string') continue;
      for (const pattern of forbiddenInitSpecifiers) {
        if (pattern.test(initCmd)) {
          errors.push(`cli.json init.${platform} uses a forbidden specifier (${initCmd}) — init must install ${canonicalCliPackage} directly`);
        }
      }
      if (!canonicalInit.test(initCmd)) {
        errors.push(`cli.json init.${platform} must be 'npm install -g ${canonicalCliPackage}@<spec>'; got ${initCmd}`);
      } else {
        sawCanonicalInit = true;
      }
    }
    if (sawCanonicalInit) {
      notes.push('EXTERNAL_RELEASE_GATE: @flovart/cli not yet published to the npm registry');
    }
  }

  // --- SKILL.md ---
  const skillPath = join(dir, 'skills', 'flovart', 'SKILL.md');
  if (existsSync(skillPath)) {
    const skill = readFileSync(skillPath, 'utf8');
    if (connectionJargon.test(skill)) errors.push('skills/flovart/SKILL.md leaks host connection implementation details');

    // Golden ensure UX: the skill must instruct the agent to run
    // `flovart ensure --json` (or `flovart-cli ensure --json`) before workflow
    // operations, and ensure must be a real non-interactive CLI command.
    if (!/flovart(?:-cli)?\s+ensure\s+--json/.test(skill)) {
      errors.push('skills/flovart/SKILL.md does not instruct the agent to run `flovart ensure --json` before workflow ops');
    }
  }

  // --- ensure command exists and is non-interactive ---
  if (existsSync(cliSource)) {
    const source = readFileSync(cliSource, 'utf8');
    if (!/routingCommand === 'ensure'/.test(source) && !/command === 'ensure'/.test(source) && !/'ensure'/.test(source)) {
      errors.push('tools/flovart/cli.js has no `ensure` command — SKILL.md bootstrap instruction would fail');
    } else {
      // ensure must be non-interactive: it must not prompt via readline /
      // process.stdin for confirmation before producing its JSON result.
      const ensureBlock = source.match(/routingCommand === 'ensure'[\s\S]{0,400}?return;/);
      if (ensureBlock && /readline|createInterface|process\.stdin\.on|prompt\(/.test(ensureBlock[0])) {
        errors.push('tools/flovart/cli.js `ensure` command is interactive — WorkBuddy runs it non-interactively and would hang');
      }
    }
  } else {
    errors.push('tools/flovart/cli.js not found — cannot confirm `ensure` exists');
  }

  return {
    ok: errors.length === 0,
    errors,
    notes,
    summary: errors.length === 0
      ? `structurally valid${notes.length ? `; ${notes.join('; ')}` : ''}`
      : `${errors.length} error(s)`,
  };
}

function main() {
  try {
    const report = checkWorkBuddyConnector();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
