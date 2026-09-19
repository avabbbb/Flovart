// Build the self-contained `flovart-agent` sidecar binary bundled into the
// Tauri desktop via `bundle.externalBin` (see src-tauri/tauri.conf.json).
//
// Pipeline (Node SEA — https://nodejs.org/api/single-executable-applications.html):
//   1. esbuild bundles agent/index.js into ONE self-contained ESM file
//      (agent-bundle.mjs). A plugin rewrites the runtime's dynamic
//      `importFlovartModule(name)` / `../tools/flovart/*` specifiers — which
//      cannot read sibling files inside a single executable — to the concrete
//      modules and inlines them.
//   2. A tiny CommonJS trampoline (sea-main.cjs) embeds that ESM source as a
//      base64 string and `import()`s it via a `data:text/javascript` URL. Node
//      SEA can only execute its embedded main as CJS, and the agent's top-level
//      await cannot be lowered to CJS — the trampoline is the supported way to
//      run the ESM core.
//   3. `node --experimental-sea-config` produces sea-prep.blob from the
//      trampoline; postject injects it into a copy of the current node.exe,
//      producing src-tauri/binaries/flovart-agent-<target-triple>[.exe].
//
// The result runs the SAME agent/index.js core as `npm run flovart:agent`
// (dev mode). No agent-desktop.js duplicate exists.
//
// Usage:  node scripts/build-agent-sidecar.mjs [--target <triple>]
//         npm run build:agent-sidecar
//
// --target defaults to the host Rust target triple (only
// x86_64-pc-windows-msvc is currently exercised by release packaging).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(SCRIPT_DIR, '..');
const AGENT_ENTRY = join(REPO_DIR, 'agent', 'index.js');
const STAGE_DIR = join(REPO_DIR, '.tmp', 'agent-sidecar');
const BINARIES_DIR = join(REPO_DIR, 'src-tauri', 'binaries');

const NODE_SEA_SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// Optional dev-only imports reachable through the bundled CLI surface that must
// stay OUT of the agent sidecar. Each is absent from a production install or
// guarded behind a runtime try/catch, so stubbing is safe — the SEA never
// exercises those code paths.
const EXTERNALS = new Set([
  'react-devtools-core', // ink devtools, absent in production installs
]);

// Rust target triples we can name from this build host. Extend as release
// targets are added; Tauri matches externalBin entries by this suffix.
const TARGET_TRIPLES = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

function defaultTargetTriple() {
  return TARGET_TRIPLES[`${process.platform}-${process.arch}`]
    || `${process.arch}-unknown-${process.platform}`;
}

function parseArgs(argv) {
  const options = { target: defaultTargetTriple() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      index += 1;
      if (!argv[index]) throw new Error('--target requires a Rust target triple.');
      options.target = argv[index];
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_DIR,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

/**
 * The flovart-modules.js loader body used for every copy in the graph. It keeps
 * the same module-name validation as agent/flovart-modules.js but resolves only
 * `flovart-module:<name>` specifier — no `../tools/flovart/**` or repo-root
 * `../<name>.js` glob that esbuild would expand across the whole checkout
 * (scanning volatile .tmp/* dirs) or leave unresolvable inside a SEA. The
 * scheme resolves to tools/flovart/<name>.js via the plugin below.
 */
const FLOVART_MODULE_LOADER = `// Generated loader: every concrete module the agent imports is referenced by a
// STATIC specifier so esbuild inlines it into the single SEA bundle. A dynamic
// import('flovart-module:'+name) cannot be folded and would reach the runtime
// ESM loader as an unsupported scheme — so the map below enumerates the names
// statically and keeps the same name-validation contract as flovart-modules.js.
const MODULES = {
  'agent-kit': () => import('flovart-module:agent-kit'),
  'agent-surface': () => import('flovart-module:agent-surface'),
  'core': () => import('flovart-module:core'),
  'host-discovery': () => import('flovart-module:host-discovery'),
  'host-registry': () => import('flovart-module:host-registry'),
  'registry': () => import('flovart-module:registry'),
};
export async function importFlovartModule(name) {
  const moduleName = String(name || '').trim();
  const loader = MODULES[moduleName];
  if (!loader) throw new Error('Invalid Flovart module name.');
  return loader();
}
`;

/**
 * Resolve the agent's layout-flexible dynamic imports so esbuild inlines the
 * concrete tools/flovart/* modules into a single self-contained ESM bundle.
 * Inside a single executable there is no on-disk module tree, so the runtime's
 * `importFlovartModule(name)` / `../tools/flovart/*` specifiers cannot read
 * sibling files.
 */
function flovartModuleInliningPlugin() {
  return {
    name: 'flovart-module-inlining',
    setup(build) {
      // Replace every flovart-modules.js copy (agent/, managed-agent/) with the
      // sibling-resolving loader above so its dynamic specifier inlines the
      // concrete module instead of emitting a wide `../tools/flovart/**` or
      // repo-root `../<name>.js` glob.
      build.onLoad({ filter: /flovart-modules\.js$/ }, args => (
        { contents: FLOVART_MODULE_LOADER, loader: 'js', resolveDir: dirname(args.path) }
      ));
      // The loader emits `import('flovart-module:<name>')` for the concrete
      // modules the agent needs (host-discovery, host-registry, agent-kit,
      // registry, agent-surface, core). Map the scheme to
      // tools/flovart/<name>.js so each inlines into the single bundle. Without
      // this resolver the scheme is treated as a bare specifier, left external,
      // and the SEA fails at runtime with `Module not found in bundle`.
      build.onResolve({ filter: /^flovart-module:/ }, args => {
        const name = args.path.slice('flovart-module:'.length);
        const local = join(REPO_DIR, 'tools', 'flovart', `${name}.js`);
        if (existsSync(local)) return { path: local };
        return { path: args.path, external: true };
      });

      // The `./<name>.js` specifiers emitted by the loader are template
      // literals esbuild cannot statically analyse; resolve each emitted
      // specifier to the concrete file. A `**` glob is esbuild's approximation
      // of that runtime expression — it can never resolve to a real file, so
      // mark it external. Concrete <name>.js specifiers still inline below.
      build.onResolve({ filter: /\*\*/ }, args => (
        { path: args.path, external: true }
      ));
      build.onResolve({ filter: /^\.\/[a-z0-9._-]+\.js$/ }, args => {
        const local = resolve(args.resolveDir, args.path);
        if (existsSync(local)) return { path: local };
        return { path: args.path, external: true };
      });

      // Static `../tools/flovart/<name>.js` and `../<name>.js` specifiers (e.g.
      // agent/skill-*.js re-exports, agent/runtime-connection.js fallbacks)
      // resolve to concrete files where present; absent managed-agent-layout
      // fallbacks are left external (they sit behind runtime try/catch).
      build.onResolve({ filter: /^\.\.\/.+\.js$/ }, args => {
        const local = resolve(args.resolveDir, args.path);
        if (existsSync(local)) return { path: local };
        return { path: args.path, external: true };
      });

      // Optional bare-specifier externals (dev-only ink/devtools deps) are
      // stubbed to empty modules — the bundle runs under a data: URL where
      // runtime bare-specifier resolution would fail, and these code paths are
      // never exercised in the agent sidecar.
      build.onResolve({ filter: /.*/ }, args => (
        EXTERNALS.has(args.path) ? { path: args.path, namespace: 'stub' } : null
      ));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => (
        { contents: 'export default {};', loader: 'js' }
      ));
    },
  };
}

async function bundleAgentEntry(outfile) {
  await esbuild.build({
    entryPoints: [AGENT_ENTRY],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'bundle',
    plugins: [flovartModuleInliningPlugin()],
    banner: {
      // Bundled CJS deps emit `__require('node:...')` shims that fall back to a
      // dynamic require; under a data: URL no require exists. Provide one via
      // createRequire so those shims resolve node: builtins and real deps.
      js: `// flovart-agent SEA bundle — generated by scripts/build-agent-sidecar.mjs
import { createRequire as __seaCreateRequire } from 'node:module';
const require = __seaCreateRequire(process.execPath);`,
    },
    logLevel: 'warning',
  });
}

/**
 * Emit the CommonJS SEA main. Node SEA executes only CJS, and agent/index.js's
 * top-level await cannot be lowered to CJS — so the trampoline embeds the ESM
 * bundle and `import()`s it through a data: URL (a real module, permitted
 * inside a SEA, unlike eval/fs-based loaders).
 */
function writeSeaTrampoline(trampolinePath) {
  // Node SEA executes only CJS, and agent/index.js's top-level await cannot be
  // lowered to CJS. The trampoline reads the embedded ESM bundle from a SEA
  // asset, writes it to a per-run temp file, and `import()`s that file URL so
  // `import.meta.url` is a real file URL (required by agent/production-skills.js
  // and pi-storage-sqlite-node's migration loader, which fileURLToPath it).
  const code = `// flovart-agent SEA CommonJS entry.
const sea = require('node:sea');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const source = sea.getAsset('agent-bundle.mjs', 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flovart-agent-sea-'));
  const entry = path.join(dir, 'agent-bundle.mjs');
  fs.writeFileSync(entry, source, 'utf8');
  await import(pathToFileURL(entry).href);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
`;
  writeFileSync(trampolinePath, code, 'utf8');
}

function writeSeaConfig(blobPath, mainPath, esmBundlePath) {
  const configPath = join(STAGE_DIR, 'sea-config.json');
  writeFileSync(configPath, JSON.stringify({
    main: mainPath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: { 'agent-bundle.mjs': esmBundlePath },
  }, null, 2), 'utf8');
  return configPath;
}

function injectSeaBlob(nodeBinary, blobPath, outputBinary) {
  copyFileSync(nodeBinary, outputBinary);
  // postject is invoked through the npm exec shim so the build has no hard
  // dependency on a globally installed postject. On Windows `npx` is a .cmd
  // shim, so resolve it the same way the toolkit builder resolves npm.
  const npxExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const postjectArgs = [
    '-y', 'postject@latest',
    outputBinary,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse', NODE_SEA_SENTINEL,
  ];
  if (process.platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  run(npxExecutable, postjectArgs, { shell: process.platform === 'win32' });
}

export async function buildAgentSidecar(options = {}) {
  const target = options.target || defaultTargetTriple();
  const exeSuffix = target.includes('windows') ? '.exe' : '';
  const binaryName = `flovart-agent-${target}${exeSuffix}`;
  const outputBinary = join(BINARIES_DIR, binaryName);
  const bundlePath = join(STAGE_DIR, 'agent-bundle.mjs');
  const trampolinePath = join(STAGE_DIR, 'sea-main.cjs');
  const blobPath = join(STAGE_DIR, 'sea-prep.blob');

  rmSync(STAGE_DIR, { recursive: true, force: true });
  mkdirSync(STAGE_DIR, { recursive: true });
  mkdirSync(BINARIES_DIR, { recursive: true });

  await bundleAgentEntry(bundlePath);
  writeSeaTrampoline(trampolinePath);
  const seaConfig = writeSeaConfig(blobPath, trampolinePath, bundlePath);
  run(process.execPath, ['--experimental-sea-config', seaConfig]);
  if (!existsSync(blobPath)) throw new Error(`SEA prep did not produce ${blobPath}`);

  injectSeaBlob(process.execPath, blobPath, outputBinary);
  return { binary: outputBinary, name: binaryName, target, bundle: bundlePath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/build-agent-sidecar.mjs [--target <rust-triple>]');
    return;
  }
  const result = await buildAgentSidecar(options);
  console.log(JSON.stringify({
    binary: result.binary,
    name: result.name,
    target: result.target,
    externalBin: 'binaries/flovart-agent',
  }, null, 2));
}

const invokedAsScript = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === new URL(`file://${resolve(entry)}`).href;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}
