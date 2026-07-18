import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as tar from 'tar';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = resolve(SCRIPT_DIR, '..');
const REPO_DIR = resolve(TOOL_DIR, '..', '..');
const TOOL_PACKAGE = JSON.parse(readFileSync(join(TOOL_DIR, 'package.json'), 'utf8'));

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const match = String(arg).match(/^--([^=]+)=(.*)$/);
    if (match) options[match[1]] = match[2];
    else if (arg === '--keep-staging') options.keepStaging = true;
  }
  return options;
}

function safeName(value, label) {
  const name = String(value || '');
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(name)) throw new Error(`Invalid ${label}: ${value}`);
  return name;
}

function run(command, args, options = {}) {
  const npmCli = command === 'npm' ? process.env.npm_execpath : null;
  const executable = npmCli ? process.execPath : process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    encoding: 'utf8',
    shell: process.platform === 'win32' && command === 'npm' && !npmCli,
    ...options,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.error?.message || result.stderr || result.stdout || 'unknown error'}`);
  return result.stdout;
}

export function createBundleMetadata({ version, platform, runtimeName }) {
  const runtimeCommand = `runtime/${runtimeName}`;
  return {
    schemaVersion: 1,
    version,
    protocolVersion: '1',
    platform,
    entrypoints: {
      cli: { command: '$NODE', args: ['{bundle}/cli/node_modules/flovart-cli/cli.js'] },
      runtime: { command: runtimeCommand, args: [] },
      agent: { command: '$NODE', args: ['{bundle}/cli/node_modules/flovart-cli/managed-agent/index.js'] },
    },
  };
}

export function createReleaseManifest({ version, platform, archiveName, sha256, bytes }) {
  return {
    schemaVersion: 1,
    version,
    protocolVersion: '1',
    artifacts: {
      [platform]: {
        url: `./${archiveName}`,
        sha256,
        bytes,
      },
    },
  };
}

export async function buildAgentToolkit(options) {
  const runtimeSource = resolve(String(options.runtime || ''));
  if (!options.runtime || !existsSync(runtimeSource)) throw new Error(`Runtime executable not found: ${options.runtime || '(missing --runtime)'}`);
  const version = safeName(options.version || TOOL_PACKAGE.version, 'version');
  if (version !== TOOL_PACKAGE.version) {
    throw new Error(`Toolkit release version ${version} does not match npm bootstrapper version ${TOOL_PACKAGE.version}`);
  }
  const targetPlatform = safeName(options.platform, 'platform');
  const runtimeName = options.runtimeName || basename(runtimeSource);
  const outputDir = resolve(options.output || join(REPO_DIR, 'dist', 'agent-toolkit'));
  const stagingDir = join(outputDir, `.staging-${targetPlatform}`);
  const packageDir = join(outputDir, '.packages');
  const archiveName = `flovart-agent-toolkit-${targetPlatform}.tar.gz`;
  const archivePath = join(outputDir, archiveName);
  const manifestPath = join(outputDir, 'flovart-agent-toolkit-manifest.json');

  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(join(stagingDir, 'runtime'), { recursive: true });
  mkdirSync(packageDir, { recursive: true });

  const packOutput = JSON.parse(run('npm', ['pack', TOOL_DIR, '--json', '--pack-destination', packageDir], { cwd: REPO_DIR }));
  const packedFile = packOutput?.[0]?.filename;
  if (!packedFile) throw new Error('npm pack did not return a package filename');
  const packageArchive = join(packageDir, packedFile);
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', join(stagingDir, 'cli'), packageArchive], { cwd: REPO_DIR });

  copyFileSync(runtimeSource, join(stagingDir, 'runtime', runtimeName));
  if (process.platform !== 'win32') await chmod(join(stagingDir, 'runtime', runtimeName), 0o755);
  if (options.host) {
    const hostSource = resolve(String(options.host));
    if (!existsSync(hostSource)) throw new Error(`Native host executable not found: ${options.host}`);
    copyFileSync(hostSource, join(stagingDir, 'runtime', basename(hostSource)));
  }

  const bundle = createBundleMetadata({ version, platform: targetPlatform, runtimeName });
  writeFileSync(join(stagingDir, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  rmSync(archivePath, { force: true });
  await tar.c({ gzip: true, file: archivePath, cwd: stagingDir, portable: true }, ['bundle.json', 'cli', 'runtime']);

  const archive = readFileSync(archivePath);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const manifest = createReleaseManifest({ version, platform: targetPlatform, archiveName, sha256, bytes: statSync(archivePath).size });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (!options.keepStaging) {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(packageDir, { recursive: true, force: true });
  }
  return { archivePath, manifestPath, bundle, manifest };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildAgentToolkit(options);
  console.log(JSON.stringify({
    archive: result.archivePath,
    manifest: result.manifestPath,
    version: result.bundle.version,
    platform: result.bundle.platform,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}
