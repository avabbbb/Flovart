// CLI Skill command group + WebUI opener — the coding-agent-facing surface of
// the local Skill ecosystem. All commands are deterministic and print a
// machine-readable result object via the CLI wrapper.
import fs from 'node:fs/promises';
import { platform } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { readSkillPackageEntries, SkillRegistry } from './skill-registry.js';
import { safeSkillPackageName } from './skill-package.js';
import {
  assertInstallableHubUrl,
  fetchHubSkillList,
  fetchHubSkillPackage,
  normalizeHubUrl,
  SkillHubError,
} from './skill-hub.js';
import { readWebDiscovery } from './web-discovery.js';
import { buildBrowserBootstrapUrl, inspectLocalAgent, issueBrowserBootstrapToken, probeWebUi, readLocalAgentConnection } from './local-agent.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Default local WebUI endpoints, in probe order (dev Vite first, then toolkit web).
// Override with FLOVART_WEBUI_PORTS="http://127.0.0.1:8080,http://127.0.0.1:9000".
const DEFAULT_WEBUI_CANDIDATES = [
  'http://127.0.0.1:37522',   // source-mode Vite dev server (vite.config.ts port)
  'http://127.0.0.1:11451',   // toolkit/cloud web service (dev-commands.js URLS.web)
];

function webuiCandidates() {
  const raw = String(process.env.FLOVART_WEBUI_PORTS || '').trim();
  const discovered = readWebDiscovery()?.url;
  if (!raw) return [...new Set([...(discovered ? [discovered] : []), ...DEFAULT_WEBUI_CANDIDATES])];
  const candidates = raw.split(',').map(item => item.trim()).filter(Boolean);
  return candidates.length ? [...new Set([...(discovered ? [discovered] : []), ...candidates])] : DEFAULT_WEBUI_CANDIDATES;
}

const SKILL_COMMAND_NAMES = new Set([
  'skill.list',
  'skill.manifest',
  'skill.install',
  'skill.uninstall',
  'skill.hub.list',
  'web.open',
]);

export { SKILL_COMMAND_NAMES };

function error(code, message) {
  return { ok: false, error: { code, message, retryable: false } };
}

function okResult(result) {
  return { ok: true, ...result };
}

function resolveProjectDir(raw) {
  return path.resolve(String(raw || process.cwd()));
}

export async function runSkillCommand(command, args = {}) {
  const projectDir = resolveProjectDir(args.projectDir ?? args['project-dir']);
  const id = String(args.id || args.skillId || args._?.[0] || '').trim();

  switch (command) {
    case 'skill.list': {
      const registry = new SkillRegistry({ repoRoot: projectDir });
      const skills = await registry.scan();
      const roots = [];
      for (const root of registry.roots) roots.push({ root, exists: await dirExists(root) });
      return okResult({
        command,
        projectDir,
        roots,
        skills,
      });
    }

    case 'skill.manifest': {
      if (!id) return error('INVALID_ARGUMENT', 'skill.manifest 需要 <id>（如 community.demo）。');
      const registry = new SkillRegistry({ repoRoot: projectDir });
      try {
        return okResult({ command, manifest: await registry.manifest(id) });
      } catch (cause) {
        return error('NOT_FOUND', cause instanceof Error ? cause.message : String(cause));
      }
    }

    case 'skill.install': {
      if (!id) return error('INVALID_ARGUMENT', 'skill.install 需要 <id>（如 community.demo）。');
      const registry = new SkillRegistry({ repoRoot: projectDir });
      const hubUrl = String(args.hubUrl ?? args['hub-url'] ?? '').trim();
      const fromDir = String(args.fromDir ?? args['from-dir'] ?? '').trim();
      if (!hubUrl && !fromDir) {
        return error('INVALID_ARGUMENT', 'skill.install 需要 --hub-url <url>（外站 Hub）或 --from-dir <dir>（本地目录）。');
      }
      try {
        let files;
        let version;
        if (fromDir) {
          const entries = await readSkillPackageEntries(path.resolve(fromDir));
          if (!entries.length) return error('PACKAGE_REJECTED', `本地目录没有可读的 Skill 包：${fromDir}`);
          files = entries;
        } else {
          const normalized = assertInstallableHubUrl(hubUrl);
          const pkg = await fetchHubSkillPackage(normalized, id);
          if (pkg.id !== id) return error('PACKAGE_REJECTED', 'Skill 包 id 与请求不一致。');
          version = pkg.version;
          files = pkg.files;
        }
        const skill = await registry.installPackage({ id, version: version ?? undefined, files });
        return okResult({ command, id, skill, installRoot: registry.installRoot });
      } catch (cause) {
        const known = ['INVALID_URL', 'UNREACHABLE', 'PACKAGE_REJECTED'].includes(cause?.code)
          ? cause.code
          : 'REJECTED';
        return error(known, cause instanceof Error ? cause.message : String(cause));
      }
    }

    case 'skill.uninstall': {
      if (!id) return error('INVALID_ARGUMENT', 'skill.uninstall 需要 <id>。');
      const registry = new SkillRegistry({ repoRoot: projectDir });
      try {
        await registry.uninstall(id);
        return okResult({ command, id, installRoot: registry.installRoot });
      } catch (cause) {
        return error('REJECTED', cause instanceof Error ? cause.message : String(cause));
      }
    }

    case 'skill.hub.list': {
      const hubUrl = String(args.hubUrl ?? args['hub-url'] ?? args._?.[0] ?? '').trim();
      if (!hubUrl) return error('INVALID_ARGUMENT', 'skill.hub.list 需要 Hub 地址（位置参数或 --hub-url）。');
      let normalized;
      try {
        normalized = normalizeHubUrl(hubUrl);
      } catch (cause) {
        return error('INVALID_URL', cause instanceof Error ? cause.message : String(cause));
      }
      try {
        const skills = await fetchHubSkillList(normalized);
        return okResult({ command, hubUrl: normalized, skills });
      } catch (cause) {
        return error(cause?.code || 'UNREACHABLE', cause instanceof Error ? cause.message : String(cause));
      }
    }

    case 'web.open': {
      const explicit = String(args.url ?? '').trim();
      try {
        const url = await openWebUi(explicit, { opener: args.opener });
        return okResult({ command, opened: url, method: 'native-opener' });
      } catch (cause) {
        return error(cause?.code || 'NO_WEBUI', cause instanceof Error ? cause.message : String(cause));
      }
    }

    default:
      return error('UNKNOWN_COMMAND', `未知 Skill 命令：${command}`);
  }
}

const dirExists = async dir => {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
};

// ---- WebUI opener (native OS hand-off, same mechanism as deepseek-harness) ----

async function probeCandidate(candidate, timeoutMs = 600) {
  return Boolean(await probeWebUi(candidate, { timeoutMs }).catch(() => null));
}

function isLoopbackUrl(value) {
  try { return LOOPBACK_HOSTS.has(new URL(value).hostname); } catch { return false; }
}

async function openVerifiedWebUi(target, verified = true, opener = openUrlNative) {
  let openTarget = target;
  if (verified) {
    try {
      const connection = readLocalAgentConnection();
      const inspected = await inspectLocalAgent(connection, { timeoutMs: 600 });
      if (inspected.state === 'ready') {
        const bootstrapToken = await issueBrowserBootstrapToken(connection, { timeoutMs: 600 });
        openTarget = buildBrowserBootstrapUrl(target, { ...connection, bootstrapToken });
      }
    } catch {
      // A plain WebUI remains a valid fallback when the optional Browser Agent is offline.
    }
  }
  opener(openTarget);
  return target;
}

export async function openWebUi(explicitUrl = '', options = {}) {
  const opener = typeof options.opener === 'function' ? options.opener : openUrlNative;
  let target = explicitUrl.trim();
  if (target) {
    const url = new URL(target);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new SkillHubError('INVALID_URL', 'web.open 只接受 http(s) 地址。');
    }
    target = url.toString();
    return openVerifiedWebUi(target, isLoopbackUrl(target) && await probeCandidate(target), opener);
  }
  for (const candidate of webuiCandidates()) {
    if (await probeCandidate(candidate)) {
      return openVerifiedWebUi(candidate, true, opener);
    }
  }
  throw Object.assign(new Error('没有发现运行中的 Flovart WebUI。请先运行 `flovart start --source --web --open`；源码仓库可使用 `npm run flovart:cli -- start --source --web --open`，不要单独运行 `npm run dev` 来建立 Agent 连接。'), { code: 'NO_WEBUI' });
}

/** Open a URL with the OS default browser without shell-parsing bootstrap query strings. */
export function openUrlNative(url) {
  const { cmd, args } = buildNativeOpenCommand(url);
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    child.on('error', () => { /* openers are best-effort */ });
    child.unref();
  } catch {
    // best-effort: opener failure surfaces as NO_WEBUI only when probing found nothing
  }
}

export function buildNativeOpenCommand(url, os = platform()) {
  return os === 'win32'
    ? { cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
    : { cmd: os === 'darwin' ? 'open' : 'xdg-open', args: [url] };
}
