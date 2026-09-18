import { spawn, execFileSync, execSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { installToolkit, planToolkitStart, startToolkit } from './bundle-manager.js';
import { inspectLocalAgent, probeWebUi, readLocalAgentConnection, redactBootstrapUrl, waitForLocalAgent, waitForWebUi } from './local-agent.js';
import { FlovartRuntimeClient } from './runtime-client.js';
import { FlovartBootstrapCoordinator } from './bootstrap-coordinator.js';
import { clearWebDiscovery, readWebDiscovery, writeWebDiscovery } from './web-discovery.js';
import { clearBrowserLaunchState, isBrowserLaunchPending, readBrowserLaunchState, writeBrowserLaunchState } from './browser-launch-state.js';

const FLOVART_HOME = join(homedir(), '.flovart');
const PROJECT_DIR = join(FLOVART_HOME, 'project');
const PG_CONTAINER = 'flovart-pg';
const PG_USER = 'postgres';
const PG_PASSWORD = 'postgres';
const PG_DB = 'flovart';
const PG_PORT = '5433';
const DOCKER_DEFAULT_PORTS = Object.freeze({ db: 5433, hub: 11452, web: 1635 });

const URLS = {
  web: 'http://localhost:37522',
  hub: 'http://localhost:11452',
  db: `localhost:${PG_PORT}`,
};

const SERVICE_ORDER = ['db', 'hub', 'web'];


export function dockerComposeServices(services = []) {
  const selected = new Set(services);
  if (selected.has('web')) {
    selected.add('db');
    selected.add('hub');
  } else if (selected.has('hub')) {
    selected.add('db');
  }
  return SERVICE_ORDER.filter(name => selected.has(name));
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)));
    proc.on('error', reject);
  });
}

function checkCommand(cmd) {
  const flag = cmd === 'go' ? 'version' : '--version';
  try { execSync(`${cmd} ${flag}`, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

function log(msg) { console.log(`\x1b[36m[flovart]\x1b[0m ${msg}`); }
function warn(msg) { console.log(`\x1b[33m[flovart]\x1b[0m ${msg}`); }
function err(msg) { console.error(`\x1b[31m[flovart]\x1b[0m ${msg}`); }

export function resolveProjectDir(cwd = process.cwd()) {
  if (existsSync(join(cwd, 'package.json')) && existsSync(join(cwd, 'backend'))) {
    return cwd;
  }
  return PROJECT_DIR;
}

export function parseDevArgs(argv = []) {
  const options = {
    all: false,
    web: false,
    hub: false,
    backend: false,
    db: false,
    docker: false,
    install: false,
    update: false,
    open: false,
    noOpen: false,
    json: false,
    plan: false,
    detach: false,
    source: false,
    toolkit: false,
    noBrowserAgent: false,
    noAgent: true,
    agent: 'none',
    webPort: undefined,
    agentPort: undefined,
    version: undefined,
    manifestUrl: undefined,
    help: false,
    _: [],
  };

  for (const raw of argv) {
    const arg = String(raw || '').trim();
    if (!arg) continue;
    if (arg === '--help' || arg === '-h' || arg === 'help') options.help = true;
    else if (arg === '--all' || arg === 'all') options.all = true;
    else if (arg === '--web' || arg === '--frontend' || arg === 'web' || arg === 'frontend') options.web = true;
    else if (arg === '--hub' || arg === 'hub') options.hub = true;
    else if (arg === '--backend' || arg === 'backend') options.backend = true;
    else if (arg === '--db' || arg === 'db') options.db = true;
    else if (arg === '--docker' || arg === 'docker') options.docker = true;
    else if (arg === '--install' || arg === '--install-deps' || arg === 'install-deps') options.install = true;
    else if (arg === '--update' || arg === 'pull') options.update = true;
    else if (arg === '--open' || arg === 'open') options.open = true;
    else if (arg === '--no-open') options.noOpen = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--plan' || arg === '--dry-run' || arg === 'plan') options.plan = true;
    else if (arg === '--detach' || arg === '-d') options.detach = true;
    else if (arg === '--source') options.source = true;
    else if (arg === '--toolkit') options.toolkit = true;
    else if (arg === '--no-browser-agent') options.noBrowserAgent = true;
    else if (arg === '--no-agent') {
      options.noAgent = true;
      options.agent = 'none';
    } else if (arg.startsWith('--agent=')) {
      options.agent = arg.slice('--agent='.length) || 'codex';
      options.noAgent = false;
    }
    else if (arg.startsWith('--web-port=')) options.webPort = arg.slice('--web-port='.length).trim() || undefined;
    else if (arg.startsWith('--agent-port=')) options.agentPort = arg.slice('--agent-port='.length).trim() || undefined;
    else if (arg.startsWith('--version=')) options.version = arg.slice('--version='.length) || undefined;
    else if (arg.startsWith('--manifest=')) options.manifestUrl = arg.slice('--manifest='.length) || undefined;
    else options._.push(arg);
  }

  if (options.noOpen) options.open = false;
  return options;
}

function selectedServices(options, fallbackAll = true) {
  const requested = options.all || options.web || options.hub || options.backend || options.db;
  const selected = {
    db: options.db,
    hub: options.hub,
    web: options.web,
  };

  if (options.all || (!requested && fallbackAll)) {
    selected.db = true;
    selected.hub = true;
    selected.web = true;
  }

  if (options.backend) {
    selected.db = true;
    selected.hub = true;
  }

  if (selected.hub) selected.db = true;
  return SERVICE_ORDER.filter(name => selected[name]);
}

export function planStart(argv = [], cwd = process.cwd()) {
  const options = parseDevArgs(inferSourceStartArgs(argv, cwd));
  if (!options.source) {
    return planToolkitStart({ agent: options.agent, noAgent: options.noAgent, open: options.open, json: options.json, detach: options.detach });
  }
  const services = selectedServices(options, true);
  const projectDir = resolveProjectDir(cwd);
  const configuredWebPort = options.webPort ?? process.env.FLOVART_WEB_PORT;
  const plannedWebUrl = String(configuredWebPort || '') === '0'
    ? null
    : configuredWebPort
      ? `http://localhost:${configuredWebPort}`
      : options.docker
        ? `http://localhost:${DOCKER_DEFAULT_PORTS.web}`
        : URLS.web;
  return {
    command: 'start',
    projectDir,
    mode: options.docker ? 'docker' : 'local',
    services,
    installBeforeStart: options.install,
    updateBeforeStart: options.update,
    detach: options.detach,
    openBrowser: options.open && !options.noOpen && services.includes('web'),
    json: options.json,
    browserAgent: !options.docker && services.includes('web') && !options.noBrowserAgent,
    webPort: options.webPort,
    agentPort: options.agentPort,
    urls: Object.fromEntries(services.map(name => [name, name === 'web' ? plannedWebUrl : URLS[name]])),
  };
}

function inferSourceStartArgs(argv, cwd) {
  const options = parseDevArgs(argv);
  if (options.source || options.toolkit || !options.open || options.noOpen) return argv;
  const hasServiceSelection = options.all || options.web || options.hub || options.backend || options.db;
  const projectDir = resolveProjectDir(cwd);
  if (hasServiceSelection || projectDir !== cwd) return argv;
  if (!existsSync(join(projectDir, 'agent', 'index.js')) || !existsSync(join(projectDir, 'vite.config.ts'))) return argv;
  return [...argv, '--source', '--web'];
}

export function planInstall(argv = [], cwd = process.cwd()) {
  const options = parseDevArgs(argv);
  if (!options.source) {
    return { command: 'install', mode: 'toolkit', version: options.version || 'bootstrapper-compatible', manifestUrl: options.manifestUrl || null };
  }
  const services = selectedServices(options, true).filter(name => name !== 'db');
  return {
    command: 'install',
    projectDir: resolveProjectDir(cwd),
    services,
  };
}

function printHelp(command = 'start') {
  if (command === 'install') {
    console.log([
      'Usage: flovart install [--version=x.y.z] [--manifest=https://...]',
      '',
      '普通用户下载并校验版本化 Agent Toolkit，不需要 Git、Go、PostgreSQL 或 Docker。',
      '源码贡献者在仓库内使用 `flovart install --source` 安装开发依赖。',
    ].join('\n'));
    return;
  }
  console.log([
    'Usage: flovart start [options]',
    '',
    'Options:',
    '  --agent=codex   启动 Toolkit 内置 Managed Agent companion（兼容参数；不会启动外部 Codex）',
    '  --no-agent      不额外启动 Managed Agent，由 Desktop Runtime 按需管理（默认）',
    '  --plan          只打印启动计划，不真正启动服务',
    '  --source        在源码仓库运行 Vite/Go 开发服务',
    '  --web-port=0    WebUI 使用随机 loopback 端口；默认端口被占用时也会自动切换',
    '  --agent-port=0  Browser Agent 使用随机 loopback 端口；默认端口被占用时也会自动切换',
    '  --docker        与 --source 搭配运行 SaaS Compose',
    '  --no-browser-agent  不启动源码 Workflow Browser Agent（仅调试用）',
    '',
    'Examples:',
    '  flovart start',
    '  flovart start --no-agent',
    '  flovart start --source --all --open',
  ].join('\n'));
}

function printPlan(plan, json = false) {
  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (plan.mode === 'toolkit') {
    log(`Plan: Agent Toolkit ${plan.version} (protocol ${plan.protocolVersion})`);
    log(`  Bundle: ${plan.bundleDir}`);
    log(`  Processes: ${plan.processes.map(item => item.name).join(', ') || 'none'}`);
    return;
  }
  log(`Plan: ${plan.command} ${plan.mode ? `(${plan.mode})` : ''}`);
  log(`  Project: ${plan.projectDir}`);
  log(`  Services: ${plan.services.join(', ') || 'none'}`);
  if (plan.urls) {
    for (const [name, url] of Object.entries(plan.urls)) {
      const note = name === 'web' && plan.mode === 'local' && plan.webPort === undefined
        ? ' (preferred only; actual URL is resolved after startup)'
        : '';
      log(`  ${name}: ${url || 'dynamic loopback port (actual URL will be reported after startup)'}${note}`);
    }
  }
  if (plan.installBeforeStart) log('  Install dependencies before start: yes');
  if (plan.updateBeforeStart) log('  Pull latest before start: yes');
  if (plan.openBrowser) log(`  Browser: ${plan.urls?.web || 'dynamic loopback port (actual URL will be reported after startup)'}`);
}

function ensureEnvFiles(projectDir) {
  for (const dir of ['backend']) {
    const dirAbs = join(projectDir, dir);
    const envFile = join(dirAbs, '.env');
    const exampleFile = join(dirAbs, '.env.example');
    if (!existsSync(envFile) && existsSync(exampleFile)) {
      copyFileSync(exampleFile, envFile);
      log('Created ' + dir + '/.env from .env.example (edit to customize).');
    }
  }
}

async function installProjectDependencies(projectDir, services) {
  if (services.includes('web')) {
    if (!checkCommand('node')) { err('Node.js is required. Install from https://nodejs.org'); process.exit(1); }
    log('Installing frontend dependencies (npm install)...');
    await run('npm', ['install'], { cwd: projectDir });
  }

  const needsGo = services.includes('hub');
  if (needsGo) {
    ensureEnvFiles(projectDir);
    if (checkCommand('go')) {
      if (services.includes('hub')) {
        log('Downloading Hub Go dependencies...');
        await run('go', ['mod', 'download'], { cwd: join(projectDir, 'backend') });
      }

    } else {
      warn('Go not found, skipping backend dependencies. Install Go from https://go.dev to run the backend.');
    }
  }
}

async function updateProject(projectDir, services) {
  if (!existsSync(join(projectDir, '.git'))) {
    warn('Not a git checkout, skipping git pull.');
  } else {
    log('Pulling latest code...');
    await run('git', ['pull'], { cwd: projectDir });
  }
  await installProjectDependencies(projectDir, services);
}

export async function install(argv = []) {
  const options = parseDevArgs(argv);
  if (options.help) {
    printHelp('install');
    return;
  }

  if (!options.source) {
    log('Downloading the signed-version Agent Toolkit manifest and SHA-256 verified bundle...');
    const result = await installToolkit({ version: options.version, manifestUrl: options.manifestUrl });
    log(`Flovart Agent Toolkit ${result.version} installed in ${result.bundleDir}`);
    log(`Launcher: ${result.launcher}`);
    if (result.path?.changed) warn('PATH updated for future terminals. Open a new terminal before running `flovart`.');
    if (result.path?.supported === false) warn(`Add ${result.path.binDir} to PATH, or keep running it from the repository with \`npm run flovart:cli -- <command>\`.`);
    return;
  }

  log('Installing Source Development Mode dependencies...');
  const plan = planInstall(argv);
  await installProjectDependencies(plan.projectDir, plan.services);
  log('Flovart dependencies are ready in ' + plan.projectDir);
  log('Run `flovart start --source --all --open`.');
}

export async function start(argv = []) {
  const options = parseDevArgs(argv);
  if (options.help) {
    printHelp('start');
    return;
  }

  const plan = planStart(argv);
  if (options.plan) {
    printPlan(plan, options.json);
    return;
  }

  if (plan.mode === 'toolkit') {
    if (!options.json) printPlan(plan);
    const toolkit = startToolkit({ agent: options.agent, noAgent: options.noAgent, open: options.open, json: options.json, detach: options.detach, projectDir: process.cwd() });
    const readiness = await waitForToolkitReady(toolkit);
    if (options.json) {
      console.log(JSON.stringify({ ok: readiness.ok, command: 'start', mode: plan.mode, toolkit: { version: plan.version, protocolVersion: plan.protocolVersion, openRequested: plan.open }, ...readiness }, null, 2));
      if (!readiness.ok) {
        toolkit.close();
        process.exitCode = 1;
      }
    } else if (!readiness.ok) {
      toolkit.close();
      err(readiness.error || 'Flovart Desktop Runtime 启动失败。');
      process.exitCode = 1;
    }
    if (options.json || options.detach) return;
    return;
  }

  const projectDir = plan.projectDir;
  if (!existsSync(projectDir)) {
    err('Flovart not installed. Run `flovart install` first, or run from the project directory.');
    process.exit(1);
  }

  if (plan.updateBeforeStart) await updateProject(projectDir, plan.services);
  else if (plan.installBeforeStart) await installProjectDependencies(projectDir, plan.services);

  if (plan.mode === 'docker') {
    await startDocker(projectDir, plan);
    return;
  }

  await startLocal(projectDir, plan);
}

export async function waitForToolkitReady(toolkit, { timeoutMs = 20_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const runtimeProcess = toolkit?.children?.find(item => item.name === 'runtime')?.child;
  const managedAgentProcess = toolkit?.children?.find(item => item.name === 'agent')?.child;
  const requiresBrowser = toolkit?.open === true;
  const runtime = new FlovartRuntimeClient({ timeoutMs: Math.min(1_000, Math.max(250, intervalMs * 3)) });
  let runtimeStatus = null;
  let runtimeError = '等待 Flovart Desktop Runtime 就绪。';
  let agentStatus = managedAgentProcess || requiresBrowser ? { status: 'starting', url: null } : { status: 'managed-by-desktop', url: null };
  let browser = { status: requiresBrowser ? 'waiting' : 'managed-by-desktop', connected: null, clientId: null, projectId: null, revision: null };
  while (Date.now() <= deadline) {
    if (runtimeProcess?.exitCode !== null && runtimeProcess?.exitCode !== undefined && !runtimeStatus) {
      runtimeError = `Flovart Desktop Runtime 在就绪前退出（code ${runtimeProcess.exitCode}）。`;
      break;
    }
    try {
      runtimeStatus = await runtime.status();
      runtimeError = '';
    } catch (error) {
      runtimeError = error instanceof Error ? error.message : String(error);
    }

    if (managedAgentProcess || requiresBrowser) {
      try {
        const connection = readLocalAgentConnection();
        const inspected = await inspectLocalAgent(connection, { timeoutMs: 800 });
        if (inspected.state === 'ready') agentStatus = { status: 'ready', url: connection.url };
        else if (inspected.state === 'auth_failed') {
          agentStatus = { status: 'auth_failed', url: connection.url, error: inspected.error };
          break;
        }
        const health = inspected.health || {};
        const connected = inspected.state === 'ready' && Number(health.clients || 0) > 0 && Boolean(health.hasWorkflow);
        browser = {
          status: connected ? 'connected' : requiresBrowser ? 'waiting' : 'managed-by-desktop',
          connected: connected || null,
          clientId: health.clientId || null,
          projectId: health.activeProjectId || null,
          revision: numericOrNull(health.revision),
        };
      } catch (error) {
        agentStatus = { status: requiresBrowser || managedAgentProcess ? 'starting' : 'managed-by-desktop', url: null, error: error instanceof Error ? error.message : String(error) };
      }
    }
    const agentReady = !managedAgentProcess || agentStatus.status === 'ready';
    const browserReady = !requiresBrowser || browser.status === 'connected';
    if (runtimeStatus && agentReady && browserReady) {
      return {
        ok: true,
        runtime: { status: 'ready', surface: 'desktop-runtime', version: runtimeStatus.runtimeVersion },
        frontend: { status: 'ready', surface: 'embedded-desktop', url: null },
        agent: agentStatus,
        browser,
      };
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return {
    ok: false,
    runtime: runtimeStatus ? { status: 'ready', surface: 'desktop-runtime', version: runtimeStatus.runtimeVersion } : { status: 'offline', surface: 'desktop-runtime' },
    frontend: runtimeStatus ? { status: 'ready', surface: 'embedded-desktop', url: null } : { status: 'offline', surface: 'embedded-desktop', url: null },
    agent: agentStatus,
    browser,
    error: agentStatus.status === 'auth_failed'
      ? agentStatus.error
      : requiresBrowser && browser.status !== 'connected'
        ? '等待桌面 Workflow 绑定超时。请重新打开 Flovart。'
        : runtimeError,
  };
}

export function shouldKeepStartedServices(bootstrap) {
  return bootstrap?.frontend?.status === 'ready'
    && bootstrap?.agent?.status === 'ready'
    && bootstrap?.browser?.status === 'pending';
}

function numericOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function startDocker(projectDir, plan) {
  if (!checkCommand('docker')) {
    err('Docker is required for --docker mode.');
    process.exit(1);
  }
  const composeServices = dockerComposeServices(plan.services);
  const ports = await resolveDockerPorts({ ...plan, services: composeServices });
  const composeEnv = {
    ...process.env,
    ...Object.fromEntries(Object.entries(ports).map(([name, port]) => [`FLOVART_${name.toUpperCase()}_PORT`, String(port)])),
  };
  const args = ['compose', 'up', '--build'];
  // An attached Compose process cannot open or health-check the WebUI until
  // it exits. Opening the browser therefore implies detached Compose mode.
  if (plan.detach || plan.openBrowser || plan.services.length === 1 && plan.services[0] === 'db') args.push('-d');
  args.push(...plan.services);

  const displayPlan = {
    ...plan,
    urls: Object.fromEntries(Object.entries(plan.urls || {}).map(([name, url]) =>
      name === 'web' && ports.web ? [`${name}`, `http://127.0.0.1:${ports.web}`] : [name, url])),
  };
  printPlan(displayPlan);
  log('Starting with Docker Compose...');
  await run('docker', args, { cwd: projectDir, env: composeEnv });
  if (plan.openBrowser && ports.web) {
    const webUrl = await waitForWebUi(`http://127.0.0.1:${ports.web}`, { timeoutMs: 45_000 });
    openBrowser(webUrl);
  }
}

export async function resolveDockerPorts(plan = {}, env = process.env) {
  const requested = {
    db: env.FLOVART_DB_PORT,
    hub: env.FLOVART_HUB_PORT,
    web: plan.webPort ?? env.FLOVART_WEB_PORT,
  };
  const ports = {};
  const reserved = new Set();
  for (const service of dockerComposeServices(plan.services || [])) {
    const raw = String(requested[service] ?? '').trim();
    const preferred = raw === '0' ? 0 : Number(raw) || DOCKER_DEFAULT_PORTS[service];
    let port = await findAvailablePort(preferred);
    while (reserved.has(port)) port = await findAvailablePort(0);
    ports[service] = port;
    reserved.add(port);
  }
  return ports;
}

async function startLocal(projectDir, plan) {
  if (plan.services.includes('web') && !checkCommand('node')) { err('Node.js is required.'); process.exit(1); }

  const hubDir = join(projectDir, 'backend');
  const needsGo = plan.services.includes('hub');
  const hasGo = checkCommand('go');
  const children = [];
  const detached = plan.detach || plan.json;

  if (plan.services.includes('db')) {
    if (checkCommand('docker')) {
      const pgReady = await ensurePostgres();
      if (!pgReady && needsGo) warn('PostgreSQL not ready. Go backends may fail to connect.');
    } else if (needsGo) {
      warn('Docker not found. Ensure PostgreSQL is running on localhost:' + PG_PORT + ' (db=' + PG_DB + ', user=' + PG_USER + ').');
    }
  }

  const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}?sslmode=disable`,
    JWT_SECRET: process.env.JWT_SECRET || 'flovart-dev-secret-change-in-production',
    JWT_EXP_HOURS: process.env.JWT_EXP_HOURS || '168',
    CORS_ALLOW: process.env.CORS_ALLOW || '*',
    PORT: process.env.PORT || '11452',
  };
  if (plan.webPort !== undefined) env.FLOVART_WEB_PORT = String(plan.webPort);
  if (plan.agentPort !== undefined) env.FLOVART_AGENT_PORT = String(plan.agentPort);

  if (!plan.json) {
    printPlan(plan);
    log('Press Ctrl+C to stop started services.\n');
  }

  let webProcess = null;
  if (plan.services.includes('web')) {
    const configuredWebPort = String(env.FLOVART_WEB_PORT || '').trim();
    const preferredPort = configuredWebPort === '0' ? 0 : Number(configuredWebPort) || Number(new URL(URLS.web).port);
    const existingWebUrl = preferredPort === 0 ? null : await findExistingWebUi({ preferredPort, env });
    if (existingWebUrl) {
      webProcess = { child: null, url: existingWebUrl, reused: true, getUrl: () => existingWebUrl };
      if (!plan.json) log(`Reusing existing Flovart WebUI: ${existingWebUrl}`);
    } else {
      const webPort = await findAvailablePort(preferredPort);
      webProcess = spawnWebUi(projectDir, env, { detached, json: plan.json, port: webPort });
      children.push(webProcess.child);
    }
  }

  let agentConnection = null;
  let agentStartupError = null;
  if (plan.browserAgent) {
    try {
      agentConnection = await ensureSourceAgent(projectDir, children, { detached, json: plan.json, env });
    } catch (error) {
      agentStartupError = error instanceof Error ? error.message : String(error);
    }
  }

  if (needsGo && !hasGo) {
    warn('Go not found. Backend services were skipped.');
  } else {
    if (plan.services.includes('hub')) {
      children.push(spawn('go', ['run', './cmd/server'], { stdio: detached ? 'ignore' : 'inherit', shell: true, cwd: hubDir, env, detached, windowsHide: detached }));
    }
  }

  const bootstrap = await new FlovartBootstrapCoordinator({
    openBrowser: url => {
      const pending = readBrowserLaunchState(env);
      if (isBrowserLaunchPending(pending, { frontendUrl: url, connection: agentConnection })) return false;
      const opened = openBrowser(url, { quiet: plan.json });
      if (opened) {
        try { writeBrowserLaunchState({ frontendUrl: url, connection: agentConnection }, env); } catch {}
      }
      return opened;
    },
  }).start({
    ensureAgent: plan.browserAgent ? async () => {
      if (agentStartupError) throw new Error(agentStartupError);
      return agentConnection;
    } : undefined,
    launchWeb: async () => webProcess,
    open: plan.openBrowser,
    timeoutMs: 45_000,
  });
  if (bootstrap.frontend.url && webProcess?.child) writeWebDiscovery({ url: bootstrap.frontend.url, pid: webProcess.child.pid }, env);
  if (bootstrap.ok) clearBrowserLaunchState(env);
  if (bootstrap.frontend.url && !plan.json) log(`WebUI ready: ${bootstrap.frontend.url}`);

  if (plan.json) {
    console.log(JSON.stringify({ ok: bootstrap.ok, command: 'start', mode: plan.mode, detached, ...bootstrap }, null, 2));
  }

  if (!bootstrap.ok) {
    if (!shouldKeepStartedServices(bootstrap)) {
      for (const child of [...children].reverse()) stopProcessTree(child);
      if (webProcess?.child) clearWebDiscovery(webProcess.child.pid, env);
      clearBrowserLaunchState(env);
    }
    if (!plan.json) err(bootstrap.error || 'Flovart 本地服务未能就绪。');
    process.exitCode = 1;
    return;
  }

  if (detached) {
    children.forEach(child => child.unref());
    return;
  }
  if (children.length === 0) return;

  let stopping = false;
  const cleanup = () => {
    if (stopping) return;
    stopping = true;
    for (const c of children) {
      stopProcessTree(c);
    }
    if (bootstrap.frontend.url && webProcess?.child) clearWebDiscovery(webProcess.child.pid, env);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  for (const c of children) {
    c.on('close', (code) => {
      if (!stopping && code !== 0) warn('A service exited (code ' + code + '). Press Ctrl+C to stop the remaining services.');
    });
  }
}

async function ensureSourceAgent(projectDir, children, options = {}) {
  const env = options.env || process.env;
  let existing = null;
  try { existing = readLocalAgentConnection({ env }); } catch { /* startup below reports the invalid config */ }
  if (existing) {
    const state = await inspectLocalAgent(existing, { timeoutMs: 800 });
    if (state.state === 'ready') return existing;
    if (state.state === 'auth_failed') throw new Error(state.error || 'Flovart Agent Token 无效。');
  }

  const entry = join(projectDir, 'agent', 'index.js');
  if (!existsSync(entry)) throw new Error(`源码 Workflow Agent 不存在：${entry}`);
  const child = spawn(process.execPath, [entry], {
    cwd: projectDir,
    // Reuse the last recorded Agent port when it is free so a browser can
    // reconnect after a supervised restart; agent/index.js falls back to an
    // ephemeral port if an unrelated process owns it.
    env: { ...env },
    stdio: options.detached || options.json ? 'ignore' : 'inherit',
    detached: Boolean(options.detached),
    windowsHide: Boolean(options.detached),
    shell: false,
  });
  children.push(child);
  if (options.detached || options.json) child.unref();
  const result = await waitForLocalAgent({ env, timeoutMs: 15_000 });
  if (result.state === 'auth_failed') throw new Error(result.error || 'Flovart Agent Token 无效。');
  if (result.state !== 'ready' || !result.connection) throw new Error(result.error || 'Flovart Agent 启动超时。');
  return result.connection;
}

function spawnWebUi(projectDir, env, options = {}) {
  let detectedUrl = null;
  const npm = process.platform === 'win32'
    ? [process.execPath, resolveNpmEntrypoint()]
    : ['npm'];
  const captureOutput = !options.detached && !options.json;
  const child = spawn(npm[0], [...npm.slice(1), 'run', 'dev'], {
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    shell: false,
    cwd: projectDir,
    env: { ...env, FLOVART_DYNAMIC_WEB_PORT: env.FLOVART_DYNAMIC_WEB_PORT || '1', FLOVART_WEB_PORT: String(options.port || '') },
    detached: Boolean(options.detached),
    windowsHide: Boolean(options.detached),
  });
  const consume = (chunk, stream) => {
    const output = String(chunk);
    const match = output.match(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/?/i);
    if (match) detectedUrl = new URL(match[0]).origin;
    if (!options.json) stream.write(chunk);
  };
  child.stdout?.on('data', chunk => consume(chunk, process.stdout));
  child.stderr?.on('data', chunk => consume(chunk, process.stderr));
  if (options.detached || options.json) child.unref();
  return { child, url: options.port ? `http://127.0.0.1:${options.port}` : null, getUrl: () => detectedUrl };
}

function resolveNpmEntrypoint() {
  const executableDir = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(executableDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(executableDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js') : null,
  ];
  const entry = candidates.find(candidate => candidate && existsSync(candidate));
  if (!entry) throw new Error('找不到 npm CLI 入口；请确认 Node.js 安装包含 npm。');
  return entry;
}

export function findAvailablePort(preferredPort) {
  const probe = port => new Promise(resolve => {
    const server = createNetServer();
    server.once('error', () => resolve(null));
    server.listen(port || 0, '127.0.0.1', () => {
      const actual = server.address()?.port || null;
      server.close(() => resolve(actual));
    });
  });
  return probe(preferredPort || 0).then(port => port || probe(0));
}

export async function findExistingWebUi({ preferredPort, env = process.env, probe = probeWebUi, discovery = readWebDiscovery } = {}) {
  const candidates = [];
  const discovered = discovery(env);
  if (discovered?.url) candidates.push(discovered.url);
  if (preferredPort) candidates.push(`http://127.0.0.1:${preferredPort}`);
  for (const candidate of [...new Set(candidates)]) {
    try {
      const origin = await probe(candidate, { timeoutMs: 800 });
      if (origin) return origin;
    } catch {
      // A stale discovery entry or an unrelated loopback service is not a startup blocker.
    }
  }
  return null;
}

export function buildBrowserOpenCommand(url, os = platform()) {
  const command = os === 'win32' ? 'rundll32.exe' : os === 'darwin' ? 'open' : 'xdg-open';
  // The Windows shell treats `&` in a bootstrap URL as a command separator;
  // use the OS URL handler directly so the short-lived token arrives intact.
  const args = os === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return { command, args };
}

function openBrowser(url, options = {}) {
  const { command, args } = buildBrowserOpenCommand(url);
  try {
    spawn(command, args, { detached: true, stdio: 'ignore', shell: false }).unref();
    if (!options.quiet) log('Opened browser: ' + redactBootstrapUrl(url));
    return true;
  } catch (e) {
    warn('Could not open browser: ' + (e.message || e));
    return false;
  }
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
    return;
  }
  try { child.kill(); } catch {}
}

async function ensurePostgres() {
  try {
    const running = execSync(`docker ps --filter name=${PG_CONTAINER} --format {{.Names}}`, { encoding: 'utf8' }).trim();
    if (running) {
      log('PostgreSQL container already running.');
      return true;
    }

    const exists = execSync(`docker ps -a --filter name=${PG_CONTAINER} --format {{.Names}}`, { encoding: 'utf8' }).trim();
    if (exists) {
      log('Starting existing PostgreSQL container...');
      await run('docker', ['start', PG_CONTAINER]);
      return true;
    }

    log('Creating PostgreSQL container (postgres:16-alpine)...');
    await run('docker', ['run', '-d', '--name', PG_CONTAINER,
      '-e', `POSTGRES_USER=${PG_USER}`,
      '-e', `POSTGRES_PASSWORD=${PG_PASSWORD}`,
      '-e', `POSTGRES_DB=${PG_DB}`,
      '-p', `${PG_PORT}:5432`,
      'postgres:16-alpine'
    ]);
    log('Waiting for PostgreSQL to be ready...');
    await new Promise(r => setTimeout(r, 3000));
    return true;
  } catch (e) {
    warn('Failed to start PostgreSQL via Docker: ' + (e.message || e));
    return false;
  }
}

export async function update(argv = []) {
  const options = parseDevArgs(argv);
  if (!options.source) {
    const result = await installToolkit({ version: options.version, manifestUrl: options.manifestUrl });
    log(`Flovart Agent Toolkit switched to ${result.version}.`);
    return;
  }
  const projectDir = resolveProjectDir();
  if (!existsSync(projectDir)) {
    err('Flovart not installed. Run `flovart install` first, or run from the project directory.');
    process.exit(1);
  }

  await updateProject(projectDir, selectedServices(options, true).filter(name => name !== 'db'));
  log('Flovart updated successfully.');
}
