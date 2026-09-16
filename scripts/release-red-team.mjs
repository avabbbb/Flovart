import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const failures = [];
const observations = [];

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function walk(directory) {
  const result = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(path));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) result.push(path);
  }
  return result;
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

const workflowCoreFiles = [
  ...walk('components/workflow'),
  ...readdirSync(join(root, 'services')).filter(name => /^workflow.*\.(?:ts|tsx|js|mjs)$/.test(name)).map(name => join('services', name)),
];
for (const path of workflowCoreFiles) {
  const source = read(path);
  requireCondition(!source.includes('NativeWorkflowStore'), `${path}: Workflow Core references NativeWorkflowStore`);
  requireCondition(!/\b(?:host|hostKind|agentIdentity|activeHostIdentity)\s*={2,3}\s*['"](?:codex|deepseek|claude|opencode|codebuddy|pi|workbuddy)['"]|['"](?:codex|deepseek|claude|opencode|codebuddy|pi|workbuddy)['"]\s*={2,3}\s*(?:host|hostKind|agentIdentity|activeHostIdentity)\b/i.test(source), `${path}: Workflow Core contains Host-specific literal branching`);
}
observations.push(`workflow-core-files=${workflowCoreFiles.length}`);

const publicSurface = read('tools/flovart/agent-surface.js');
const publicSurfaceBlock = publicSurface.match(/AGENT_PUBLIC_COMMANDS[\s\S]*?Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] || '';
const publicCommands = [...publicSurfaceBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);
requireCondition(
  JSON.stringify(publicCommands) === JSON.stringify(['status', 'workflow.inspect', 'workflow.selection.get', 'workflow.apply', 'workflow.node.run']),
  `Agent public surface changed unexpectedly: ${publicCommands.join(', ')}`,
);
observations.push(`agent-public-commands=${publicCommands.length}`);

const agentKit = read('tools/flovart/agent-kit.js');
requireCondition(
  !/file-state runtime|command-queue\.json/i.test(agentKit) && agentKit.includes('status --json, then start --open'),
  'Packaged Agent setup guidance still points at the retired file-state/command-queue path',
);

const skillProjectionPaths = [
  '.agents/skills/flovart/SKILL.md',
  '.claude/skills/flovart/SKILL.md',
  'skills/flovart/SKILL.md',
];
const canonicalSkill = read(skillProjectionPaths[0]);
for (const path of skillProjectionPaths.slice(1)) {
  requireCondition(read(path) === canonicalSkill, `${path}: Skill projection drifted from ${skillProjectionPaths[0]}`);
}
const generatedSkillPath = 'tools/flovart/skill/SKILL.md';
if (existsSync(join(root, generatedSkillPath))) {
  requireCondition(read(generatedSkillPath) === canonicalSkill, `${generatedSkillPath}: generated Skill drifted from ${skillProjectionPaths[0]}`);
  observations.push('generated-skill=present-and-aligned');
} else {
  observations.push('generated-skill=absent-until-npm-pack');
}
observations.push(`skill-projections=${skillProjectionPaths.length}`);

try {
  const help = execFileSync(process.execPath, ['tools/flovart/cli.js', '--help'], { cwd: root, encoding: 'utf8' });
  requireCondition(
    help.includes('Bootstrap/admin:') && help.includes('Stable operations:') && help.includes('workflow.inspect'),
    'CLI --help did not return canonical help output',
  );
} catch (error) {
  requireCondition(false, `CLI --help failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const setup = execFileSync(process.execPath, ['tools/flovart/cli.js', 'setup'], { cwd: root, encoding: 'utf8' });
  requireCondition(
    !/npx flovart-cli/.test(setup),
    'CLI setup output advertises `npx flovart-cli`, which is not published in the npm registry',
  );
} catch (error) {
  requireCondition(false, `CLI setup failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  execFileSync(process.execPath, ['scripts/release-secret-audit.mjs'], { cwd: root, encoding: 'utf8' });
} catch (error) {
  requireCondition(false, `Tracked secret audit failed: ${error instanceof Error ? error.message : String(error)}`);
}

const trackedSecrets = execFileSync('git', ['ls-files', 'src-tauri/.tauri_private_key', 'src-tauri/.tauri_private_key.pub'], { cwd: root, encoding: 'utf8' }).trim();
requireCondition(!trackedSecrets, 'Signing private/public key files are tracked by Git');
requireCondition(read('.gitignore').includes('src-tauri/.tauri_private_key'), 'Signing private key is not ignored');

const desktopWorkflow = read('.github/workflows/build-desktop.yml');
const desktopWorkflowConfig = YAML.parse(desktopWorkflow);
for (const marker of [
  'release-gate:',
  'releaseDraft: true',
  'publish-release:',
  'needs: build',
  'anchore/sbom-action@v0',
  'actions/attest@v4',
  'check-release-artifacts.mjs',
  'check-updater-artifacts.mjs',
  'Stage signed updater metadata',
  'Verify signed updater artifacts',
  'SHA256SUMS.txt',
  'dist/release-artifacts/installers',
]) {
  requireCondition(desktopWorkflow.includes(marker), `Desktop release workflow is missing ${marker}`);
}
requireCondition(desktopWorkflow.includes('Verify release versions') && desktopWorkflow.includes('npm run version:check'), 'Desktop release workflow lacks the version parity gate');
const publishJobMarker = desktopWorkflow.indexOf('\n  publish-release:');
const updaterVerificationMarker = desktopWorkflow.indexOf('      - name: Verify signed updater artifacts');
requireCondition(
  publishJobMarker >= 0 && updaterVerificationMarker > publishJobMarker &&
    desktopWorkflow.includes('Download draft updater assets') &&
    desktopWorkflow.includes('releases/${release_id}/assets?per_page=100'),
  'Complete updater feed verification must run in publish-release after the matrix downloads draft assets',
);
requireCondition(
  desktopWorkflow.includes('Require production updater signing key for stable tags') &&
    desktopWorkflow.includes('TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}') &&
    desktopWorkflow.includes('Stable tag builds require TAURI_SIGNING_PRIVATE_KEY') &&
    /if:\s*startsWith\(github\.ref, ['"]refs\/tags\/v['"]\)/.test(desktopWorkflow),
  'Stable tag release path does not fail closed when the updater signing key is missing',
);
requireCondition(desktopWorkflow.includes('tauri_config=src-tauri/tauri.local.conf.json') && desktopWorkflow.includes('tauri_config=src-tauri/tauri.conf.json'), 'Desktop release workflow does not separate unsigned dry-run and signed tag configs');
requireCondition(desktopWorkflow.includes('--config ${{ steps.meta.outputs.tauri_config }}'), 'Desktop release workflow does not pass the selected Tauri config to the build');
requireCondition(/id-token:\s*write/.test(desktopWorkflow) && /attestations:\s*write/.test(desktopWorkflow), 'Desktop release workflow lacks attestation permissions');
requireCondition(desktopWorkflow.includes(`export TAURI_CONFIG='{"bundle":{"externalBin":[]}}'`), 'Desktop sidecar build does not disable the circular externalBin check');
requireCondition(desktopWorkflow.includes('Expected sidecar was not built') && desktopWorkflow.includes('Sidecar copy is empty or missing'), 'Desktop sidecar build lacks a hard output verification');

const legacyReleaseWorkflow = read('.github/workflows/release.yml');
requireCondition(!legacyReleaseWorkflow.includes('tauri-apps/tauri-action'), 'Retired release workflow can still publish artifacts');

const securityWorkflow = read('.github/workflows/security.yml');
for (const marker of ['workflow_call:', 'release:secret-audit', 'github/codeql-action/init@v4', 'github/codeql-action/analyze@v4', 'actions/dependency-review-action@v4']) {
  requireCondition(securityWorkflow.includes(marker), `Security workflow is missing ${marker}`);
}
requireCondition(desktopWorkflow.includes('security-gate:') && desktopWorkflow.includes('./.github/workflows/security.yml'), 'Desktop release workflow does not call the hosted security gate');
requireCondition(desktopWorkflow.includes('pull-requests: read'), 'Desktop hosted security gate does not pass pull request read permission to dependency review');
requireCondition(desktopWorkflow.includes('artifact-metadata: write'), 'Desktop release workflow lacks artifact metadata permission for attestations');
requireCondition(desktopWorkflow.includes("publish:") && desktopWorkflow.includes('default: false'), 'Manual release workflow lacks the default-false publish gate');
requireCondition(desktopWorkflow.includes('inputs.publish == true'), 'Release finalizer is not protected by explicit publish approval');
requireCondition(
  desktopWorkflowConfig.permissions?.contents === 'read' && Object.keys(desktopWorkflowConfig.permissions).length === 1,
  'Desktop workflow grants write permissions globally instead of scoping them to release jobs',
);
requireCondition(
  desktopWorkflowConfig.jobs?.['release-gate']?.permissions?.contents === 'read' &&
    desktopWorkflowConfig.jobs?.build?.permissions?.contents === 'write' &&
    desktopWorkflowConfig.jobs?.build?.permissions?.['id-token'] === 'write' &&
    desktopWorkflowConfig.jobs?.build?.permissions?.attestations === 'write' &&
    desktopWorkflowConfig.jobs?.build?.permissions?.['artifact-metadata'] === 'write' &&
    desktopWorkflowConfig.jobs?.['publish-release']?.permissions?.contents === 'write',
  'Desktop release write/attestation permissions are not scoped to the jobs that need them',
);

try {
  execFileSync(process.execPath, ['scripts/check-release-version.mjs'], { cwd: root, encoding: 'utf8' });
} catch (error) {
  requireCondition(false, `Release identity/version check failed: ${error instanceof Error ? error.message : String(error)}`);
}

const diagnostics = read('services/supportDiagnostics.ts');
for (const forbidden of ['apiKey', 'Authorization', 'bootstrapToken', 'rawToken', 'credential']) {
  requireCondition(!diagnostics.includes(forbidden), `Support diagnostics source contains forbidden secret field ${forbidden}`);
}
requireCondition(diagnostics.includes('loopbackOrigin'), 'Support diagnostics does not reduce connection endpoints');

const privateKeyPaths = ['src-tauri/.tauri_private_key', 'src-tauri/.tauri_private_key.pub'];
observations.push(`local-signing-files-present=${privateKeyPaths.filter(path => existsSync(join(root, path))).length}`);
observations.push(`workflow-core-relative-scan=${workflowCoreFiles.map(path => relative(root, join(root, path))).length}`);

const report = { ok: failures.length === 0, failures, observations };
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
