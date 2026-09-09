/**
 * Flovart DeepSeek profile bootstrap + doctor.
 *
 * install:
 *   1. resolve $DSH_HOME (env) / ~/.dsh
 *   2. scaffold $DSH_HOME/profiles/flovart with the profile manifest
 *      (dsh.profile.bundles = base + web-app + @flovart/dsh-plugin) and the
 *      user patch layer template
 *   3. `dsh plugin --profile flovart add <package-or-path>` (pnpm in the
 *      profile dir — the dsh-supported plugin install path)
 *   4. `dsh --profile flovart --dump-config` and verify the flovart row
 *
 * doctor:
 *   - dsh version vs the RC8 compatible set
 *   - bundle + client artifact presence
 *   - flovart CLI reachability (FLOVART_CLI / PATH)
 *   - composed config row presence
 *
 * Run with DSH_HOME=<sandbox> to test without touching the real home.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceSupervisor } from './workspace-supervisor.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = resolve(ROOT, '..')
const TARGET_DSH = '0.1.0-rc.8'
const BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@flovart/dsh-plugin']

const PROFILE_PATCH_TEMPLATE = `# Your patch layer for the flovart profile, applied after every bundle layer.
# Keep provider credentials and browser connection details in Flovart.
# The plugin joins the visible Browser Workflow through its host-side proxy.
[]
`

function dshHome(homeArg) {
  if (homeArg) return resolve(homeArg)
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts })
  if (result.error) {
    console.error(`[flovart] 无法运行 ${cmd}：${result.error.message}`)
    process.exitCode = 1
  }
  return result
}

function resolveNpmEntrypoint() {
  const executableDir = dirname(process.execPath)
  const candidates = [
    process.env.npm_execpath,
    join(executableDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(executableDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js') : null,
  ]
  const entry = candidates.find(candidate => candidate && existsSync(candidate) && candidate.endsWith('npm-cli.js'))
  if (entry) return entry
  throw new Error('找不到 npm CLI 入口；请使用包含 npm 的 Node.js 安装。')
}

function runNpm(args, opts = {}) {
  return run(process.execPath, [resolveNpmEntrypoint(), ...args], opts)
}

function runDsh(args, opts = {}) {
  return run(process.execPath, [resolveDshEntrypoint(), ...args], opts)
}

function cliArguments(value) {
  return [...String(value || '').matchAll(/"([^"]*)"|(\S+)/g)]
    .map(match => match[1] ?? match[2])
    .filter(Boolean)
}

function readProfileManifest(dir) {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

function quoteArg(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`
}

export function harnessEnvironment(config, repositoryRoot = REPOSITORY_ROOT, workspaceDirectory) {
  const workspaceDir = workspaceDirectory || null
  return {
    FLOVART_WORKSPACE_URL: config.url,
    FLOVART_WORKSPACE_TOKEN: config.token,
    FLOVART_CLI: `${quoteArg(process.execPath)} ${quoteArg(join(repositoryRoot, 'tools', 'flovart', 'cli.js'))}`,
    FLOVART_WORKSPACE_MODE: 'browser',
    ...(workspaceDir ? {
      FLOVART_AGENT_HOME: workspaceDir,
      FLOVART_AGENT_CONFIG: join(workspaceDir, 'agent.json'),
      FLOVART_CREW_DIR: join(workspaceDir, 'crew'),
    } : {}),
  }
}

function workspaceConfigFile(file) {
  return file || process.env.FLOVART_AGENT_CONFIG || join(homedir(), '.flovart', 'agent.json')
}

function readWorkspaceConfig(file) {
  try {
    const config = JSON.parse(readFileSync(workspaceConfigFile(file), 'utf8'))
    if (typeof config.url === 'string' && typeof config.token === 'string' && config.url && config.token) return config
  } catch { /* Workspace Operator creates this file on first start. */ }
  return null
}

async function probeWorkspace(config) {
  if (!config) return null
  try {
    const response = await fetch(new URL('/health', `${config.url.replace(/\/+$/, '')}/`), { signal: AbortSignal.timeout(1200) })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

function spawnWorkspaceOperator(workspaceDir) {
  return spawn(process.execPath, [join(REPOSITORY_ROOT, 'agent', 'index.js')], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      FLOVART_WORKSPACE_ONLY: '1',
      FLOVART_AGENT_HOME: workspaceDir,
      FLOVART_AGENT_CONFIG: join(workspaceDir, 'agent.json'),
      FLOVART_CREW_DIR: join(workspaceDir, 'crew'),
    },
    stdio: 'inherit',
    windowsHide: true,
  })
}

function createWorkspaceSupervisor(workspaceDir) {
  const configFile = join(workspaceDir, 'agent.json')
  return new WorkspaceSupervisor({
    readConfig: () => readWorkspaceConfig(configFile),
    probe: probeWorkspace,
    spawnWorkspace: () => spawnWorkspaceOperator(workspaceDir),
    onEvent: event => {
      if (event.kind === 'borrowed') console.log('[flovart] 复用现有 Workspace Operator（不会由 Harness 接管其进程）。')
      if (event.kind === 'recovering') console.warn(`[flovart] Workspace Operator 已断开，正在自动恢复：${event.error?.message || '未知原因'}`)
      if (event.kind === 'restarted') console.log('[flovart] Workspace Operator 已恢复，Harness 会话连接保持不变。')
    },
  })
}

/** Ensure the DSH profile joins the same visible Browser Workflow authority. */
export function ensureVisibleWorkflow(env = process.env, runner = spawnSync) {
  if (env.FLOVART_DSH_NO_BROWSER === '1') return { ok: true, skipped: true }
  const repositoryCli = join(REPOSITORY_ROOT, 'tools', 'flovart', 'cli.js')
  const cli = env.FLOVART_CLI ?? (existsSync(repositoryCli) ? `${quoteArg(process.execPath)} ${quoteArg(repositoryCli)}` : 'flovart')
  const argv = cliArguments(cli)
  const result = runner(argv[0], [...argv.slice(1), 'ensure', '--json'], {
    cwd: REPOSITORY_ROOT,
    env,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    return { ok: false, message: `Flovart ensure 失败（${result.error?.message ?? `退出码 ${result.status}`}）。` }
  }
  try {
    const parsed = JSON.parse(result.stdout ?? '')
    if (!parsed.ok || parsed.data?.ok !== true) return { ok: false, message: parsed.error?.message || parsed.data?.error?.message || '可见 Browser Workflow 尚未就绪。' }
    return { ok: true, result: parsed.data }
  } catch {
    return { ok: false, message: 'Flovart ensure 输出不是有效 JSON。' }
  }
}

function resolveDshEntrypoint() {
  const roots = []
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, 'npm', 'node_modules'))
  if (process.env.npm_config_prefix) {
    roots.push(join(process.env.npm_config_prefix, 'node_modules'))
    roots.push(join(process.env.npm_config_prefix, 'lib', 'node_modules'))
  }
  roots.push(join(dirname(process.execPath), 'node_modules'))
  roots.push(resolve(dirname(process.execPath), '..', 'lib', 'node_modules'))
  for (const root of roots) {
    const entry = join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(entry)) return entry
  }
  throw new Error('找不到 DeepSeek Harness。请先安装兼容版本：npm i -g @deepseek-ai/dsh@0.1.0-rc.8')
}

export async function start(homeArg) {
  const home = dshHome(homeArg)
  const profileDir = join(home, 'profiles', 'flovart')
  const manifest = readProfileManifest(profileDir)
  if (!manifest || !existsSync(join(profileDir, 'node_modules', '@flovart', 'dsh-plugin', 'lib', 'client.js'))) {
    throw new Error('Flovart Harness Profile 尚未安装。请先运行 `npm run dsh:profile:install`。')
  }

  const workspaceDir = join(home, 'workspace')
  const workspace = createWorkspaceSupervisor(workspaceDir)
  const prepared = await workspace.start()
  const env = {
    ...process.env,
    DSH_HOME: home,
    ...harnessEnvironment(prepared.config, REPOSITORY_ROOT, workspaceDir),
  }
  const visibleWorkflow = ensureVisibleWorkflow(env)
  if (!visibleWorkflow.ok) {
    await workspace.stop()
    throw new Error(visibleWorkflow.message)
  }
  const dshArgs = [
    resolveDshEntrypoint(),
    '--profile', 'flovart',
    '--port', process.env.FLOVART_DSH_PORT || '0',
  ]
  if (process.env.FLOVART_DSH_NO_OPEN === '1') dshArgs.push('--no-open')
  const dsh = spawn(process.execPath, dshArgs, {
    cwd: REPOSITORY_ROOT,
    env,
    stdio: 'inherit',
    windowsHide: false,
  })
  const close = () => {
    if (dsh.exitCode === null) dsh.kill()
    void workspace.stop()
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  const dshOutcome = new Promise(resolveExit => {
    dsh.once('error', error => resolveExit({ kind: 'dsh-error', error }))
    dsh.once('exit', code => resolveExit({ kind: 'dsh-exit', code: code ?? 1 }))
  })
  try {
    const outcome = await Promise.race([
      dshOutcome,
      workspace.waitForFailure().then(error => ({ kind: 'workspace-failure', error })),
    ])
    if (outcome.kind === 'workspace-failure') {
      console.error(`[flovart] ${outcome.error.message}`)
      if (dsh.exitCode === null) dsh.kill()
      process.exitCode = 1
    } else if (outcome.kind === 'dsh-error') {
      throw outcome.error
    } else {
      process.exitCode = outcome.code
    }
  } finally {
    process.removeListener('SIGINT', close)
    process.removeListener('SIGTERM', close)
    await workspace.stop()
  }
}

export async function install(homeArg, packageSpec) {
  const home = dshHome(homeArg)
  const profileDir = join(home, 'profiles', 'flovart')
  mkdirSync(profileDir, { recursive: true })

  const manifestPath = join(profileDir, 'package.json')
  const existing = readProfileManifest(profileDir)
  const manifest = existing ?? {
    name: 'dsh-flovart-profile',
    private: true,
    type: 'module',
    dsh: { profile: { bundles: BUNDLES } },
  }
  if (!manifest.dsh) manifest.dsh = {}
  if (!manifest.dsh.profile) manifest.dsh.profile = {}
  manifest.dsh.profile.bundles = BUNDLES
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE)

  console.log(`[flovart] profile: ${profileDir}`)
  // Install the PACKED tarball, not a file: directory: a pnpm `file:` link is a
  // symlink to the repo, and Node resolves imports from the symlink target —
  // peer/deep deps in the profile's node_modules chain would be missed. A real
  // copy is what an npm-registry consumer gets, and it is the verified path.
  const packDir = homeArg ?? process.env.DSH_HOME ?? process.env.TEMP ?? '.'
  const pack = runNpm(['pack', '--pack-destination', packDir], { cwd: ROOT })
  const tarballName = (pack.stdout ?? '').trim().split('\n').pop()
  if (!tarballName || pack.status !== 0) {
    console.error('[flovart] npm pack 失败；请先在 dsh-plugin 目录运行 `npm run build`。')
    process.exitCode = 1
    return
  }
  // Absolute path: `dsh plugin add` forwards to pnpm running in the profile dir.
  const spec = packageSpec ?? join(packDir, tarballName)
  const add = runDsh(['plugin', '--profile', 'flovart', 'add', spec], { env: { ...process.env, DSH_HOME: home } })
  if (add.status !== 0) {
    console.error(`[flovart] dsh plugin add 失败（退出码 ${add.status}）。已生成 profile 清单，可手动执行：
  cd ${profileDir}
  pnpm add ${spec}
然后再运行 doctor。`)
    if (add.stdout) console.log(add.stdout)
    if (add.stderr) console.error(add.stderr)
    return
  }
  console.log('[flovart] dsh plugin add 完成')
  doctor(homeArg)
}

export function doctor(homeArg) {
  const home = dshHome(homeArg)
  console.log(`[flovart] DSH_HOME: ${home}`)

  const version = runDsh(['--version'])
  const installed = (version.stdout ?? '').trim()
  console.log(`[flovart] dsh 版本：${installed}（兼容集目标：${TARGET_DSH}）`)
  if (installed !== TARGET_DSH) {
    console.error(`[flovart] 已安装版本 ${installed} 与兼容集 ${TARGET_DSH} 不一致。`)
    process.exitCode = 1
  }

  const bundle = join(ROOT, 'lib', 'index.js')
  const client = join(ROOT, 'lib', 'client.js')
  console.log(`[flovart] bundle: ${existsSync(bundle) ? 'ok' : '缺失（先运行 npm run build）'} ${bundle}`)
  console.log(`[flovart] client: ${existsSync(client) ? 'ok' : '缺失（先运行 npm run build）'} ${client}`)
  if (!existsSync(bundle) || !existsSync(client)) process.exitCode = 1

  const cliProbe = runCliProbe()
  console.log(`[flovart] CLI 探测：${cliProbe.ok ? 'ok' : '失败'}`)
  if (!cliProbe.ok) {
    console.error(`  ${cliProbe.message}`)
    process.exitCode = 1
  }

  const profileDir = join(home, 'profiles', 'flovart')
  const manifest = readProfileManifest(profileDir)
  if (!manifest) {
    console.error('[flovart] profile 不存在：先运行 `node scripts/profile.mjs install`')
    process.exitCode = 1
    return
  }
  console.log(`[flovart] profile bundles: ${manifest.dsh?.profile?.bundles?.join(' → ') ?? '(空)'}`)

  const dump = runDsh(['--profile', 'flovart', '--dump-config'], {
    env: { ...process.env, DSH_HOME: home },
    timeout: 60000,
  })
  if (dump.status !== 0) {
    console.error('[flovart] `dsh --profile flovart --dump-config` 失败（退出码 ' + dump.status + '）')
    if (dump.stdout) console.log(dump.stdout)
    if (dump.stderr) console.error(dump.stderr)
    process.exitCode = 1
    return
  }
  const config = dump.stdout ?? ''
  if (!config.includes('@flovart/dsh-plugin')) {
    console.error('[flovart] 合成配置中未找到 @flovart/dsh-plugin 行；检查 bundle 安装与 dsh.profile.bundles。')
    process.exitCode = 1
    return
  }
  console.log('[flovart] 合成配置包含 flovart 插件行：ok')
}

/** Remove only the app-managed Flovart profile; keep DSH_HOME and Workspace data. */
export function uninstall(homeArg) {
  const home = dshHome(homeArg)
  const profileDir = join(home, 'profiles', 'flovart')
  if (!existsSync(profileDir)) {
    console.log(`[flovart] Flovart Harness Profile 不存在：${profileDir}`)
    return { removed: false, profileDir }
  }
  rmSync(profileDir, { recursive: true, force: true })
  console.log(`[flovart] 已移除 Flovart Harness Profile：${profileDir}`)
  return { removed: true, profileDir }
}

function runCliProbe() {
  const repositoryCli = join(REPOSITORY_ROOT, 'tools', 'flovart', 'cli.js')
  const cli = process.env.FLOVART_CLI ?? (existsSync(repositoryCli) ? `${quoteArg(process.execPath)} ${quoteArg(repositoryCli)}` : 'flovart')
  const argv = cliArguments(cli)
  const result = spawnSync(argv[0], [...argv.slice(1), 'command.list', '--json'], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    return { ok: false, message: `${cli} 不可用（${result.error?.message ?? `退出码 ${result.status}`}）。开发模式可设置 FLOVART_CLI="node ${join(ROOT, '..', 'tools', 'flovart', 'cli.js')}"。` }
  }
  try {
    const parsed = JSON.parse(result.stdout)
    if (!parsed.ok) return { ok: false, message: `CLI command.list 返回失败：${JSON.stringify(parsed.error)}` }
    return { ok: true, message: `command.list 返回 ${Object.keys(parsed.data?.commands ?? {}).length} 条命令` }
  } catch {
    return { ok: false, message: 'CLI 输出不是有效 JSON' }
  }
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  const subcommand = process.argv[2] ?? 'doctor'
  const homeIndex = process.argv.indexOf('--home')
  const homeArg = homeIndex >= 0 ? process.argv[homeIndex + 1] : undefined
  if (subcommand === 'install') {
    const specIndex = process.argv.indexOf('--package')
    const packageSpec = specIndex >= 0 ? process.argv[specIndex + 1] : undefined
    await install(homeArg, packageSpec)
  } else if (subcommand === 'doctor') {
    doctor(homeArg)
  } else if (subcommand === 'start') {
    try {
      await start(homeArg)
    } catch (error) {
      console.error(`[flovart] ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  } else if (subcommand === 'uninstall') {
    uninstall(homeArg)
  } else {
    console.error('用法：node scripts/profile.mjs install [--home DIR] [--package SPEC] | doctor [--home DIR] | start [--home DIR] | uninstall [--home DIR]')
    process.exitCode = 1
  }
}
