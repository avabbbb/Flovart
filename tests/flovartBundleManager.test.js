import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as tar from 'tar';
import { installToolkit, planToolkitStart, readCurrentToolkit, toolkitPaths } from '../tools/flovart/bundle-manager.js';
import { createBundleMetadata } from '../tools/flovart/scripts/build-agent-toolkit.mjs';

const tempDirs = [];

function makeTempDir(name) {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`));
  tempDirs.push(dir);
  return dir;
}

async function makeRelease(options = {}) {
  const root = makeTempDir('flovart-release');
  const source = join(root, 'source');
  const version = options.version || '0.3.0';
  const protocolVersion = '1';
  const bundle = {
    schemaVersion: 1,
    version,
    protocolVersion,
    entrypoints: {
      cli: { command: '$NODE', args: ['{bundle}/cli/cli.js'] },
      runtime: { command: 'runtime/flovart.exe', args: [] },
      agent: { command: '$NODE', args: ['{bundle}/agent/index.js'], cwd: '.' },
      ...options.entrypoints,
    },
  };
  for (const dir of ['cli', 'runtime', 'agent']) mkdirSync(join(source, dir), { recursive: true });
  writeFileSync(join(source, 'bundle.json'), JSON.stringify(bundle, null, 2));
  writeFileSync(join(source, 'cli', 'cli.js'), 'console.log("cli")');
  writeFileSync(join(source, 'runtime', 'flovart.exe'), 'runtime');
  writeFileSync(join(source, 'agent', 'index.js'), 'console.log("agent")');
  const archive = join(root, 'bundle.tar.gz');
  await tar.c({ gzip: true, file: archive, cwd: source }, ['bundle.json', 'cli', 'runtime', 'agent']);
  const bytes = readFileSync(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    schemaVersion: 1,
    version,
    protocolVersion,
    artifacts: {
      'win32-x64': {
        url: './bundle.tar.gz',
        sha256: options.sha256 || sha256,
        bytes: bytes.length,
      },
    },
  };
  const manifestUrl = 'https://downloads.example.test/v0.3.0/manifest.json';
  const fetchImpl = async url => {
    if (String(url) === manifestUrl) return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } });
    if (String(url) === new URL('./bundle.tar.gz', manifestUrl).toString()) return new Response(bytes);
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, manifest, manifestUrl };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Flovart Agent Toolkit bundle manager', () => {
  it('uses the published flovart-cli package for bundled entrypoints', () => {
    const bundle = createBundleMetadata({ version: '0.3.0', platform: 'win32-x64', runtimeName: 'flovart.exe' });

    expect(bundle.entrypoints.cli.args[0]).toBe('{bundle}/cli/node_modules/flovart-cli/cli.js');
    expect(bundle.entrypoints.agent.args[0]).toBe('{bundle}/cli/node_modules/flovart-cli/managed-agent/index.js');
  });

  it('downloads, verifies and activates a platform bundle', async () => {
    const homeDir = makeTempDir('flovart-toolkit-home');
    const release = await makeRelease();
    const brokenVersionDir = join(toolkitPaths(homeDir).versionsDir, release.manifest.version);
    mkdirSync(brokenVersionDir, { recursive: true });
    writeFileSync(join(brokenVersionDir, 'partial-download'), 'broken');

    const result = await installToolkit({
      homeDir,
      manifestUrl: release.manifestUrl,
      platformKey: 'win32-x64',
      fetchImpl: release.fetchImpl,
      addPath: false,
    });

    expect(result).toMatchObject({ ok: true, version: '0.3.0', protocolVersion: '1' });
    expect(existsSync(join(result.bundleDir, 'runtime', 'flovart.exe'))).toBe(true);
    expect(existsSync(join(result.bundleDir, 'partial-download'))).toBe(false);
    expect(existsSync(toolkitPaths(homeDir).currentFile)).toBe(true);
    expect(readCurrentToolkit(homeDir)?.current.version).toBe('0.3.0');
    expect(readFileSync(toolkitPaths(homeDir).launcherFile, 'utf8')).toContain('entrypoints.cli');
    const launch = spawnSync(process.execPath, [toolkitPaths(homeDir).launcherFile, '--help'], { encoding: 'utf8' });
    expect(launch.status).toBe(0);
    expect(launch.stdout).toContain('cli');
  });

  it('refuses a corrupt artifact without activating it', async () => {
    const homeDir = makeTempDir('flovart-toolkit-corrupt');
    const release = await makeRelease({ sha256: '0'.repeat(64) });

    await expect(installToolkit({
      homeDir,
      manifestUrl: release.manifestUrl,
      platformKey: 'win32-x64',
      fetchImpl: release.fetchImpl,
      addPath: false,
    })).rejects.toThrow('SHA-256 mismatch');

    expect(existsSync(toolkitPaths(homeDir).currentFile)).toBe(false);
  });

  it('rejects manifest and entrypoint path traversal', async () => {
    const homeDir = makeTempDir('flovart-toolkit-traversal');
    const badManifestUrl = 'https://downloads.example.test/manifest.json';
    const badManifestFetch = async () => new Response(JSON.stringify({
      schemaVersion: 1,
      version: '../../escape',
      protocolVersion: '1',
      artifacts: {},
    }), { headers: { 'content-type': 'application/json' } });

    await expect(installToolkit({ homeDir, manifestUrl: badManifestUrl, fetchImpl: badManifestFetch, addPath: false }))
      .rejects.toThrow('Invalid Flovart Agent Toolkit version');

    const escapedRelease = await makeRelease({
      entrypoints: { runtime: { command: '../outside.exe', args: [] } },
    });
    await expect(installToolkit({
      homeDir,
      manifestUrl: escapedRelease.manifestUrl,
      platformKey: 'win32-x64',
      fetchImpl: escapedRelease.fetchImpl,
      addPath: false,
    })).rejects.toThrow('entrypoint escapes the bundle');
  });

  it('builds runtime plus agent plans and supports runtime-only startup', async () => {
    const homeDir = makeTempDir('flovart-toolkit-plan');
    const release = await makeRelease();
    await installToolkit({
      homeDir,
      manifestUrl: release.manifestUrl,
      platformKey: 'win32-x64',
      fetchImpl: release.fetchImpl,
      addPath: false,
    });

    const full = planToolkitStart({ homeDir });
    const runtimeOnly = planToolkitStart({ homeDir, noAgent: true });

    expect(full.processes.map(item => item.name)).toEqual(['runtime', 'agent']);
    expect(full.processes[0].command).toBe(join(full.bundleDir, 'runtime', 'flovart.exe'));
    expect(full.processes[1].args[0]).toBe(join(full.bundleDir, 'agent', 'index.js'));
    expect(runtimeOnly.processes.map(item => item.name)).toEqual(['runtime']);
  });
});
