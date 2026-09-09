import { spawnSync } from 'node:child_process';
import { extname } from 'node:path';
import { getHostRegistry, listAgentIdentities } from './host-registry.js';

const DEFAULT_TIMEOUT_MS = 1500;

function text(value) {
  return String(value || '').trim();
}

function locateExecutable(binary, platform, runner) {
  const finder = platform === 'win32' ? 'where.exe' : 'which';
  const result = runner(finder, [binary], {
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: true,
    shell: false,
  });
  if (result?.status !== 0) return null;
  const candidates = text(result.stdout).split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (platform !== 'win32') return candidates[0] || null;
  return candidates.sort((left, right) => windowsExecutableRank(left) - windowsExecutableRank(right))[0] || null;
}

function windowsExecutableRank(value) {
  const extension = extname(value).toLowerCase();
  return extension === '.exe' ? 0 : extension === '.cmd' ? 1 : extension === '.bat' ? 2 : 3;
}

function runVersion(path, platform, runner) {
  const args = ['--version'];
  if (platform === 'win32' && ['.cmd', '.bat'].includes(extname(path).toLowerCase())) {
    return runner(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', path, ...args], {
      encoding: 'utf8',
      timeout: DEFAULT_TIMEOUT_MS,
      windowsHide: true,
      shell: false,
    });
  }
  return runner(path, args, {
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
    windowsHide: true,
    shell: false,
  });
}

function probeExecutable(identity, { platform, runner, includeVersion = true }) {
  for (const executable of [identity.executable, ...(identity.aliases || [])]) {
    if (!executable) continue;
    const path = locateExecutable(executable, platform, runner);
    if (!path) continue;
    const versionResult = includeVersion ? runVersion(path, platform, runner) : null;
    return {
      available: true,
      executable,
      path,
      version: text(versionResult?.stdout || versionResult?.stderr).split(/\r?\n/)[0] || null,
    };
  }
  return { available: false, executable: identity.executable, path: null, version: null };
}

function normalizeProbeResult(identity, result) {
  const binding = getHostRegistry().directorBindings.find(item => item.agentIdentityId === identity.id);
  const available = Boolean(result?.available);
  return {
    id: identity.id,
    label: identity.label,
    category: identity.category,
    status: identity.status || (available ? 'available' : 'unavailable'),
    available,
    executable: result?.executable || identity.executable || null,
    path: result?.path || null,
    version: result?.version || null,
    authStatus: 'not-inspected',
    distributionTargets: identity.distributionTargets,
    runtimeSurfaces: identity.runtimeSurfaces,
    directorBinding: binding ? 'supported' : 'not-supported',
    diagnostic: identity.status === 'manual-import'
      ? '通过 WorkBuddy 官方技能页导入 Flovart 技能包；未检测桌面安装或登录状态。'
      : identity.status === 'planned'
      ? '该 Host 只登记为未来 Projection 候选，本次不探测也不参与 Director Binding。'
      : available
        ? '已发现可执行文件；登录状态由 Host 自己管理。'
        : '未在当前 PATH 发现可执行文件。',
  };
}

export function discoverAgentHosts(options = {}) {
  const platform = options.platform || process.platform;
  const runner = options.runner || spawnSync;
  const probe = options.probe || (identity => identity.executable
    ? probeExecutable(identity, { platform, runner, includeVersion: options.includeVersion !== false })
    : { available: false, executable: null, path: null, version: null });
  const agents = listAgentIdentities().map(identity => normalizeProbeResult(identity, identity.status === 'planned'
    ? { available: false, executable: null, path: null, version: null }
    : probe(identity) || { available: false }));

  return {
    ok: true,
    schemaVersion: getHostRegistry().schemaVersion,
    scannedAt: new Date().toISOString(),
    agents,
    directorBindings: getHostRegistry().directorBindings,
  };
}
