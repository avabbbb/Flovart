// Environment runner.
//
// This runner does not touch the Workflow graph at all. It reproduces a real
// Runtime deployment condition on the real filesystem and then asks the real
// production guard to judge it:
//
//   tools/flovart/runtime-client.js -> verifyDiscoveryPermissions(path)
//
// It exists because the Hosted CI blocker was an environment-layer defect: the
// same discovery record was accepted locally and rejected on a Windows runner.
// A benchmark that cannot reproduce an environment defect cannot protect
// against it coming back.

import { mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { verifyDiscoveryPermissions } from '../../tools/flovart/runtime-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const HOST_PLATFORM = process.platform;
const WINDOWS = HOST_PLATFORM === 'win32';

function platformKind() {
  return WINDOWS ? 'win32' : 'posix';
}

function tempRoot() {
  return process.env.FLOVARTBENCH_TMP_ROOT || join(repoRoot, '.tmp', 'flovartbench-env');
}

function systemExe(name) {
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

/**
 * Failing to build the scenario is an environment problem, not a verdict about
 * the product, so it is coded so the classifier can tell the two apart.
 */
function setupFailure(message) {
  const error = new Error(message);
  error.code = 'ENVIRONMENT_SETUP_FAILED';
  return error;
}

/**
 * Turn an ACL description into a real file. The scenarios mirror the production
 * contract in src-tauri/src/runtime/discovery.rs:
 *   directory: D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;<user>)
 *   file:      D:P(A;;FA;;;SY)(A;;FA;;;<user>)
 * so only the current user and LocalSystem may appear.
 */
async function materialise(sandbox, scenario, acl) {
  const directory = join(sandbox, scenario);
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'control-v1.json');
  await writeFile(file, JSON.stringify({ version: 1, runtime: 'flovartbench', scenario }, null, 2), 'utf8');

  if (WINDOWS) {
    const icacls = systemExe('icacls.exe');
    if (acl.inheritance === 'remove') run(icacls, [file, '/inheritance:r', '/c', '/q']);
    else run(icacls, [file, '/inheritance:e', '/c', '/q']);

    // icacls takes one principal per /grant:r switch; a space-joined list is
    // parsed as a single invalid entry.
    for (const principal of acl.grant ?? []) {
      const applied = run(icacls, [file, '/grant:r', principal, '/c', '/q']);
      if (applied.status !== 0) {
        throw setupFailure(`icacls /grant:r ${principal} failed: ${applied.stderr || applied.stdout}`);
      }
    }
    for (const principal of acl.grantReadOnly ?? []) {
      const applied = run(icacls, [file, '/grant', `${principal}:R`, '/c', '/q']);
      if (applied.status !== 0) {
        throw setupFailure(`icacls /grant ${principal} failed: ${applied.stderr || applied.stdout}`);
      }
    }
  } else {
    await chmod(file, acl.mode ?? 0o600);
  }
  return file;
}

let cachedSid;
/**
 * The production guard identifies its own account by SID, and the record it
 * accepts contains that SID verbatim. The scenario therefore has to grant by
 * SID too, otherwise the ACE carries a resolved name and never matches.
 */
function currentSid() {
  if (cachedSid !== undefined) return cachedSid;
  const { stdout } = run(systemExe('whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
  cachedSid = stdout.match(/S-\d(?:-\d+)+/)?.[0] ?? null;
  return cachedSid;
}

/** `<CURRENT>` becomes the current user's SID; SYSTEM becomes LocalSystem's. */
function expandPrincipal(value) {
  const text = String(value);
  const principal = text.split(':')[0];
  const permission = text.slice(principal.length);
  if (principal === '<CURRENT>') {
    const sid = currentSid();
    if (!sid) throw setupFailure('current SID unavailable');
    return `*${sid}${permission}`;
  }
  if (principal.toUpperCase() === 'SYSTEM') return `*S-1-5-18${permission}`;
  return text;
}

/**
 * @returns a runner whose run(task) executes every runtime.discovery.verify step
 *          and records the verdict of the real guard for each scenario.
 */
export function createEnvironmentRunner(controlled, { trajectory } = {}) {
  return {
    name: 'environment',
    async run(task) {
      const sandbox = join(tempRoot(), `${task.id}-${Date.now().toString(36)}`);
      try {
        for (const step of task.solution?.steps ?? []) {
          if (step.command !== 'runtime.discovery.verify') {
            return { error: { code: 'UNSUPPORTED_COMMAND', message: `environment runner cannot run ${step.command}` }, completedSteps: false };
          }
          const { scenario, acl = {}, expect, platform } = step.args ?? {};
          if (platform && platform !== platformKind()) {
            controlled.recordDiscovery({ scenario, platform, verdict: 'skipped', expect });
            trajectory?.recordToolCall({ surface: 'environment', command: step.command, args: step.args, result: { ok: true, verdict: 'skipped' } });
            continue;
          }

          const grants = (acl.grant ?? []).map(expandPrincipal);
          const file = await materialise(sandbox, scenario, { ...acl, grant: grants });

          let verdict = 'accept';
          let error = null;
          try {
            await verifyDiscoveryPermissions(file);
          } catch (caught) {
            verdict = 'reject';
            error = caught?.message ?? String(caught);
          }

          controlled.recordDiscovery({ scenario, platform: platformKind(), verdict, error, expect });
          trajectory?.recordToolCall({
            surface: 'environment',
            command: step.command,
            args: { scenario, platform: platform ?? platformKind(), acl: { ...acl, grant: grants } },
            result: { ok: verdict === expect, verdict, expect, error },
          });

          if (verdict !== expect && !step.allowFailure) {
            return {
              completedSteps: false,
              error: { code: 'DISCOVERY_VERDICT_MISMATCH', message: `${scenario}: expected ${expect}, got ${verdict}` },
            };
          }
        }
        return { completedSteps: true };
      } finally {
        await rm(sandbox, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
