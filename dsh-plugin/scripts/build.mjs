/**
 * Build @flovart/dsh-plugin.
 *
 * Reproduces the RC8 client-bundle contract from packages/client/tsdown.client.ts:
 *   - lib/index.js   → Node/Cordis half (ESM, host Loader entry)
 *   - lib/client.js  → browser half (CJS closure factory registered via
 *                      window.__ModuleLoader__.load({ id, factory }))
 *
 * The client bundle is a classic script executed by the shell; all non-baseline
 * specifiers inline, baseline (react, cordis, ui-slots, client-runtime) stays
 * external through the injected `require`.
 */

import { build } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))

/** Shell-baseline specifiers (mirror of apps/web/src/platform.ts). */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
]
const PRELOADED_EXTERNALS = ['@deepseek-ai/dsh-client-runtime/client']
const CLIENT_EXTERNALS = [...PLATFORM_MODULES, ...PRELOADED_EXTERNALS]

async function buildNodeHalf() {
  await build({
    entryPoints: [resolve(ROOT, 'src/index.ts')],
    outfile: resolve(ROOT, 'lib/index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    jsx: 'automatic',
    // The Node half runs from a real install: cordis/tools stay imports.
    external: ['@deepseek-ai/*'],
    sourcemap: true,
    logLevel: 'info',
  })
}

async function buildClientHalf() {
  await build({
    entryPoints: [resolve(ROOT, 'src/client/index.ts')],
    outfile: resolve(ROOT, 'lib/client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
    external: CLIENT_EXTERNALS,
    banner: { js: `var module = { exports: {} }; var exports = module.exports; window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG.name)}, factory: (require) => {` },
    footer: { js: 'return module.exports; } });' },
    sourcemap: true,
    logLevel: 'info',
  })
}

const out = resolve(ROOT, 'lib')
mkdirSync(out, { recursive: true })
console.log(`[dsh-plugin] building ${PKG.name}@${PKG.version}`)
await buildNodeHalf()
await buildClientHalf()

for (const file of ['lib/index.js', 'lib/client.js']) {
  const path = resolve(ROOT, file)
  if (!existsSync(path)) throw new Error(`build did not emit ${file}`)
  console.log(`[dsh-plugin] ok ${file} (${(readFileSync(path).byteLength / 1024).toFixed(1)} KiB)`)
}

// Prove the module-loader contract on the emitted artifact.
const client = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')
const clientPlain = client.split('//# sourceMappingURL=')[0]
const expectedBanner = `var module = { exports: {} }; var exports = module.exports; window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG.name)}, factory: (require) => {`
if (!clientPlain.startsWith(expectedBanner)) {
  throw new Error('client.js missing the __ModuleLoader__.load banner contract')
}
if (!clientPlain.trimEnd().endsWith('return module.exports; } });')) {
  throw new Error('client.js missing the factory footer contract')
}
console.log('[dsh-plugin] client loader contract verified')