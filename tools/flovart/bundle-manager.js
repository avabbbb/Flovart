import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const packageVersion = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')).version;

export const DEFAULT_TOOLKIT_HOME = join(homedir(), '.flovart', 'toolkit');

export function toolkitPaths(homeDir = process.env.FLOVART_TOOLKIT_HOME || DEFAULT_TOOLKIT_HOME) {
  return {
    homeDir,
    versionsDir: join(homeDir, 'versions'),
    downloadsDir: join(homeDir, 'downloads'),
    currentFile: join(homeDir, 'current.json'),
    launcherFile: join(homeDir, 'launcher.mjs'),
    binDir: join(dirname(homeDir), 'bin'),
  };
}

export function platformKey() {
  return `${process.platform}-${process.arch}`;
}

export function defaultManifestUrl(version = packageVersion) {
  return `https://github.com/avabbbb/Flovart/releases/download/v${version}/flovart-agent-toolkit-manifest.json`;
}

function assertManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !manifest.version || !manifest.protocolVersion || !manifest.artifacts) {
    throw new Error('Invalid Flovart Agent Toolkit manifest');
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(String(manifest.version))) {
    throw new Error('Invalid Flovart Agent Toolkit version');
  }
  return manifest;
}

function assertSafeName(value, label) {
  const name = String(value || '');
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(name)) throw new Error(`Invalid ${label}`);
  return name;
}

function assertInside(root, target, label, allowRoot = false) {
  const base = resolve(root);
  const candidate = resolve(target);
  const rel = relative(base, candidate);
  if ((!allowRoot && !rel) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} escapes the toolkit directory`);
  return candidate;
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Manifest download failed (${response.status}): ${url}`);
  return response.json();
}

async function downloadArtifact(url, target, expectedSha256, expectedBytes, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error(`Toolkit download failed (${response.status}): ${url}`);
  await mkdir(dirname(target), { recursive: true });
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(response.body, meter, createWriteStream(target));
  const sha256 = hash.digest('hex');
  if (expectedBytes !== undefined && Number(expectedBytes) !== bytes) throw new Error(`Toolkit size mismatch: expected ${expectedBytes}, got ${bytes}`);
  if (sha256.toLowerCase() !== String(expectedSha256 || '').toLowerCase()) throw new Error('Toolkit SHA-256 mismatch');
  return { bytes, sha256 };
}

function resolveArtifactUrl(manifestUrl, artifactUrl) {
  return new URL(artifactUrl, manifestUrl).toString();
}

function validateBundle(bundle, manifest) {
  if (bundle?.schemaVersion !== 1 || bundle.version !== manifest.version || bundle.protocolVersion !== manifest.protocolVersion) {
    throw new Error('Toolkit bundle metadata does not match its release manifest');
  }
  if (!bundle.entrypoints?.cli || !bundle.entrypoints?.runtime || !bundle.entrypoints?.agent) {
    throw new Error('Toolkit bundle is missing cli/runtime/agent entrypoints');
  }
  for (const name of ['cli', 'runtime', 'agent']) {
    const entry = bundle.entrypoints[name];
    if (typeof entry?.command !== 'string' || !entry.command || (entry.args !== undefined && !Array.isArray(entry.args))) {
      throw new Error(`Toolkit bundle has an invalid ${name} entrypoint`);
    }
    if (entry.command !== '$NODE' && isAbsolute(entry.command)) {
      throw new Error(`Toolkit bundle ${name} entrypoint must be bundle-relative`);
    }
    const commandSegments = String(entry.command).replaceAll('\\', '/').split('/');
    const cwdSegments = String(entry.cwd || '').replaceAll('\\', '/').split('/');
    if (commandSegments.includes('..') || cwdSegments.includes('..') || (entry.cwd && isAbsolute(entry.cwd))) {
      throw new Error(`Toolkit bundle ${name} entrypoint escapes the bundle`);
    }
  }
  return bundle;
}

async function writeLauncher(paths) {
  const source = `import { readFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nimport { isAbsolute, resolve } from 'node:path';\nconst currentFile = ${JSON.stringify(paths.currentFile)};\nconst current = JSON.parse(readFileSync(currentFile, 'utf8'));\nconst bundleDir = current.bundleDir;\nconst bundle = JSON.parse(readFileSync(resolve(bundleDir, 'bundle.json'), 'utf8'));\nconst entry = bundle.entrypoints.cli;\nconst command = entry.command === '$NODE' ? process.execPath : (isAbsolute(entry.command) ? entry.command : resolve(bundleDir, entry.command));\nconst mapArg = value => { const text = String(value); if (text === '{bundle}') return bundleDir; if (/^\\{bundle\\}[\\\\/]/.test(text)) return resolve(bundleDir, text.slice(9)); return text.replaceAll('{bundle}', bundleDir); };\nconst args = [...(entry.args || []).map(mapArg), ...process.argv.slice(2)];\nconst result = spawnSync(command, args, { stdio: 'inherit', cwd: bundleDir, shell: false });\nprocess.exit(result.status ?? 1);\n`;
  await mkdir(paths.binDir, { recursive: true });
  await writeFile(paths.launcherFile, source, 'utf8');
  const posixLauncher = join(paths.binDir, 'flovart');
  await writeFile(posixLauncher, `#!/bin/sh\nexec "${process.execPath}" "${paths.launcherFile}" "$@"\n`, 'utf8');
  await chmod(posixLauncher, 0o755);
  await writeFile(join(paths.binDir, 'flovart.cmd'), `@echo off\r\n"${process.execPath}" "${paths.launcherFile}" %*\r\n`, 'utf8');
}

function ensureWindowsUserPath(binDir) {
  if (platform() !== 'win32') return { changed: false, supported: false, binDir };
  const script = "$p=[Environment]::GetEnvironmentVariable('Path','User');$b=$env:FLOVART_BIN;$parts=@($p -split ';' | Where-Object { $_ });if($parts -notcontains $b){[Environment]::SetEnvironmentVariable('Path',(($parts+$b)-join ';'),'User');exit 10};exit 0";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, FLOVART_BIN: binDir },
    stdio: 'ignore',
    shell: false,
  });
  return { changed: result.status === 10, supported: true, ok: result.status === 0 || result.status === 10, binDir };
}

export async function installToolkit(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const paths = toolkitPaths(options.homeDir);
  const manifestUrl = options.manifestUrl || process.env.FLOVART_TOOLKIT_MANIFEST_URL || defaultManifestUrl(options.version);
  const manifest = assertManifest(await fetchJson(manifestUrl, fetchImpl));
  const targetPlatform = assertSafeName(options.platformKey || platformKey(), 'Agent Toolkit platform');
  const artifact = manifest.artifacts[targetPlatform];
  if (!artifact?.url || !artifact.sha256) throw new Error(`No Agent Toolkit bundle for ${targetPlatform}`);
  const versionDir = join(paths.versionsDir, manifest.version);
  assertInside(paths.versionsDir, versionDir, 'Toolkit version');
  const bundleFile = join(versionDir, 'bundle.json');
  if (!existsSync(bundleFile)) {
    const stagingDir = `${versionDir}.staging-${process.pid}`;
    assertInside(paths.versionsDir, stagingDir, 'Toolkit staging directory');
    const archiveFile = join(paths.downloadsDir, `${manifest.version}-${targetPlatform}.tar.gz`);
    assertInside(paths.downloadsDir, archiveFile, 'Toolkit download');
    await rm(stagingDir, { recursive: true, force: true });
    try {
      await downloadArtifact(resolveArtifactUrl(manifestUrl, artifact.url), archiveFile, artifact.sha256, artifact.bytes, fetchImpl);
      await mkdir(stagingDir, { recursive: true });
      await tar.x({
        file: archiveFile,
        cwd: stagingDir,
        strict: true,
        preservePaths: false,
        filter(name, entry) {
          const normalized = String(name).replaceAll('\\', '/');
          const segments = normalized.split('/');
          if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || segments.includes('..')) {
            throw new Error(`Unsafe path in toolkit archive: ${name}`);
          }
          if (entry?.type === 'SymbolicLink' || entry?.type === 'Link') {
            throw new Error(`Links are not allowed in toolkit archive: ${name}`);
          }
          return true;
        },
      });
      const bundle = validateBundle(JSON.parse(await readFile(join(stagingDir, 'bundle.json'), 'utf8')), manifest);
      await mkdir(paths.versionsDir, { recursive: true });
      await rm(versionDir, { recursive: true, force: true });
      await rename(stagingDir, versionDir);
      await writeFile(bundleFile, JSON.stringify(bundle, null, 2), 'utf8');
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }
  const bundle = validateBundle(JSON.parse(await readFile(bundleFile, 'utf8')), manifest);
  await mkdir(paths.homeDir, { recursive: true });
  await writeFile(paths.currentFile, JSON.stringify({ version: manifest.version, protocolVersion: manifest.protocolVersion, bundleDir: versionDir, manifestUrl, installedAt: Date.now() }, null, 2), 'utf8');
  await writeLauncher(paths);
  const path = options.addPath === false ? { changed: false, skipped: true, binDir: paths.binDir } : ensureWindowsUserPath(paths.binDir);
  return { ok: true, version: manifest.version, protocolVersion: manifest.protocolVersion, bundleDir: versionDir, launcher: join(paths.binDir, platform() === 'win32' ? 'flovart.cmd' : 'flovart'), path, bundle };
}

export function readCurrentToolkit(homeDir) {
  const paths = toolkitPaths(homeDir);
  if (!existsSync(paths.currentFile)) return null;
  const current = JSON.parse(readFileSync(paths.currentFile, 'utf8'));
  const bundle = JSON.parse(readFileSync(join(current.bundleDir, 'bundle.json'), 'utf8'));
  return { paths, current, bundle };
}

function resolveEntrypoint(bundleDir, entry) {
  const command = entry.command === '$NODE' ? process.execPath : assertInside(bundleDir, resolve(bundleDir, entry.command), 'Toolkit entrypoint');
  const args = (entry.args || []).map(value => {
    const text = String(value);
    if (text === '{bundle}') return bundleDir;
    if (/^\{bundle\}[\\/]/.test(text)) {
      return assertInside(bundleDir, resolve(bundleDir, text.slice(9)), 'Toolkit entrypoint argument');
    }
    return text.replaceAll('{bundle}', bundleDir);
  });
  const cwd = entry.cwd ? assertInside(bundleDir, resolve(bundleDir, entry.cwd), 'Toolkit working directory', true) : bundleDir;
  return { command, args, cwd };
}

export function planToolkitStart(options = {}) {
  const installed = readCurrentToolkit(options.homeDir);
  if (!installed) throw new Error('Flovart Agent Toolkit is not installed. Run `npx flovart-cli install` first.');
  const names = ['runtime'];
  if (options.agent !== 'none' && options.noAgent !== true) names.push('agent');
  const processes = names.map(name => ({ name, ...resolveEntrypoint(installed.current.bundleDir, installed.bundle.entrypoints[name]) }));
  return { mode: 'toolkit', version: installed.current.version, protocolVersion: installed.current.protocolVersion, bundleDir: installed.current.bundleDir, processes };
}

export function startToolkit(options = {}) {
  const plan = planToolkitStart(options);
  const children = plan.processes.map(item => ({
    name: item.name,
    child: spawn(item.command, item.args, { cwd: item.cwd, stdio: 'inherit', shell: false, windowsHide: false, env: { ...process.env, FLOVART_TOOLKIT_DIR: plan.bundleDir } }),
  }));
  let stopping = false;
  const close = () => {
    if (stopping) return;
    stopping = true;
    [...children].reverse().forEach(({ child }) => { try { child.kill(); } catch {} });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return { ...plan, children, close };
}
