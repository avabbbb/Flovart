import { spawn, execSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { installToolkit, planToolkitStart, startToolkit } from './bundle-manager.js';

const FLOVART_HOME = join(homedir(), '.flovart');
const PROJECT_DIR = join(FLOVART_HOME, 'project');
const PG_CONTAINER = 'flovart-pg';
const PG_USER = 'postgres';
const PG_PASSWORD = 'postgres';
const PG_DB = 'flovart';
const PG_PORT = '5433';

const URLS = {
  web: 'http://localhost:11451',
  hub: 'http://localhost:11452',
  enterprise: 'http://localhost:11453',
  db: `localhost:${PG_PORT}`,
};

const SERVICE_ORDER = ['db', 'hub', 'enterprise', 'web'];

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
    enterprise: false,
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
    noAgent: false,
    agent: 'codex',
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
    else if (arg === '--enterprise' || arg === 'enterprise') options.enterprise = true;
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
    else if (arg === '--no-agent') options.noAgent = true;
    else if (arg.startsWith('--agent=')) options.agent = arg.slice('--agent='.length) || 'codex';
    else if (arg.startsWith('--version=')) options.version = arg.slice('--version='.length) || undefined;
    else if (arg.startsWith('--manifest=')) options.manifestUrl = arg.slice('--manifest='.length) || undefined;
    else options._.push(arg);
  }

  if (options.noOpen) options.open = false;
  return options;
}

function selectedServices(options, fallbackAll = true) {
  const requested = options.all || options.web || options.hub || options.enterprise || options.backend || options.db;
  const selected = {
    db: options.db,
    hub: options.hub,
    enterprise: options.enterprise,
    web: options.web,
  };

  if (options.all || (!requested && fallbackAll)) {
    selected.db = true;
    selected.hub = true;
    selected.enterprise = true;
    selected.web = true;
  }

  if (options.backend) {
    selected.db = true;
    selected.hub = true;
    selected.enterprise = true;
  }

  if (selected.hub || selected.enterprise) selected.db = true;
  return SERVICE_ORDER.filter(name => selected[name]);
}

export function planStart(argv = [], cwd = process.cwd()) {
  const options = parseDevArgs(argv);
  if (!options.source) {
    return planToolkitStart({ agent: options.agent, noAgent: options.noAgent });
  }
  const services = selectedServices(options, true);
  const projectDir = resolveProjectDir(cwd);
  return {
    command: 'start',
    projectDir,
    mode: options.docker ? 'docker' : 'local',
    services,
    installBeforeStart: options.install,
    updateBeforeStart: options.update,
    detach: options.detach,
    openBrowser: options.open && !options.noOpen && services.includes('web'),
    urls: Object.fromEntries(services.map(name => [name, URLS[name]])),
  };
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
    '  --agent=codex   启动 Codex Managed Agent（默认）',
    '  --no-agent      只启动本地 Runtime/WebUI',
    '  --plan          只打印启动计划，不真正启动服务',
    '  --source        在源码仓库运行 Vite/Go 开发服务',
    '  --docker        与 --source 搭配运行 SaaS Compose',
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
    for (const [name, url] of Object.entries(plan.urls)) log(`  ${name}: ${url}`);
  }
  if (plan.installBeforeStart) log('  Install dependencies before start: yes');
  if (plan.updateBeforeStart) log('  Pull latest before start: yes');
  if (plan.openBrowser) log(`  Browser: ${URLS.web}`);
}

function ensureEnvFiles(projectDir) {
  for (const dir of ['backend', 'backend/enterprise']) {
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

  const needsGo = services.includes('hub') || services.includes('enterprise');
  if (needsGo) {
    ensureEnvFiles(projectDir);
    if (checkCommand('go')) {
      if (services.includes('hub')) {
        log('Downloading Hub Go dependencies...');
        await run('go', ['mod', 'download'], { cwd: join(projectDir, 'backend') });
      }
      if (services.includes('enterprise')) {
        log('Downloading Enterprise Go dependencies...');
        await run('go', ['mod', 'download'], { cwd: join(projectDir, 'backend', 'enterprise') });
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
    if (result.path?.supported === false) warn(`Add ${result.path.binDir} to PATH, or continue using \`npx flovart-cli\`.`);
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
    printPlan(plan, options.json);
    startToolkit({ agent: options.agent, noAgent: options.noAgent });
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

async function startDocker(projectDir, plan) {
  if (!checkCommand('docker')) {
    err('Docker is required for --docker mode.');
    process.exit(1);
  }
  const args = ['compose', 'up', '--build'];
  if (plan.detach || plan.services.length === 1 && plan.services[0] === 'db') args.push('-d');
  args.push(...plan.services);

  printPlan(plan);
  log('Starting with Docker Compose...');
  await run('docker', args, { cwd: projectDir });
  if (plan.openBrowser) openBrowser(URLS.web);
}

async function startLocal(projectDir, plan) {
  if (plan.services.includes('web') && !checkCommand('node')) { err('Node.js is required.'); process.exit(1); }

  const hubDir = join(projectDir, 'backend');
  const entDir = join(projectDir, 'backend', 'enterprise');
  const needsGo = plan.services.includes('hub') || plan.services.includes('enterprise');
  const hasGo = checkCommand('go');
  const children = [];

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
    ENTERPRISE_PORT: process.env.ENTERPRISE_PORT || '11453',
  };

  printPlan(plan);
  log('Press Ctrl+C to stop started services.\n');

  if (plan.services.includes('web')) {
    children.push(spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true, cwd: projectDir, env }));
  }

  if (needsGo && !hasGo) {
    warn('Go not found. Backend services were skipped.');
  } else {
    if (plan.services.includes('hub')) {
      children.push(spawn('go', ['run', './cmd/server'], { stdio: 'inherit', shell: true, cwd: hubDir, env }));
    }
    if (plan.services.includes('enterprise')) {
      children.push(spawn('go', ['run', './cmd/server'], { stdio: 'inherit', shell: true, cwd: entDir, env }));
    }
  }

  if (plan.openBrowser) setTimeout(() => openBrowser(URLS.web), 1800);
  if (children.length === 0) return;

  let stopping = false;
  const cleanup = () => {
    if (stopping) return;
    stopping = true;
    for (const c of children) {
      try { c.kill(); } catch {}
    }
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

function openBrowser(url) {
  const os = platform();
  const cmd = os === 'win32' ? 'cmd' : os === 'darwin' ? 'open' : 'xdg-open';
  const args = os === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false }).unref();
    log('Opened browser: ' + url);
  } catch (e) {
    warn('Could not open browser: ' + (e.message || e));
  }
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
