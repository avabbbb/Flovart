// Builds the Flovart web app into dsh-plugin/webui, served by src/webui.ts at /flovart-app/.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(pluginDir, '..')
const viteBin = join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(viteBin)) {
  console.error('[dsh-plugin] vite not found at repo root; run npm install in the repo root first')
  process.exit(1)
}
const outDir = join(pluginDir, 'webui')
const result = spawnSync(process.execPath, [viteBin, 'build', '--base', '/flovart-app/', '--outDir', outDir, '--emptyOutDir'], {
  cwd: repoRoot,
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status ?? 1)
if (!existsSync(join(outDir, 'index.html'))) {
  console.error('[dsh-plugin] webui build produced no index.html')
  process.exit(1)
}
console.log('[dsh-plugin] ok webui/ (base /flovart-app/)')
