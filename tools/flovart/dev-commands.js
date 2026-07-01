import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO_URL = 'https://github.com/avabbbb/Flovart.git';
const FLOVART_HOME = join(homedir(), '.flovart');
const PROJECT_DIR = join(FLOVART_HOME, 'project');
const PG_CONTAINER = 'flovart-pg';
const PG_USER = 'postgres';
const PG_PASSWORD = 'postgres';
const PG_DB = 'flovart';
const PG_PORT = '5432';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)));
    proc.on('error', reject);
  });
}

function checkCommand(cmd) {
  try { execSync(`${cmd} --version`, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

function log(msg) { console.log(`\x1b[36m[flovart]\x1b[0m ${msg}`); }
function warn(msg) { console.log(`\x1b[33m[flovart]\x1b[0m ${msg}`); }
function err(msg) { console.error(`\x1b[31m[flovart]\x1b[0m ${msg}`); }

function resolveProjectDir() {
  if (existsSync(join(process.cwd(), 'package.json')) && existsSync(join(process.cwd(), 'backend'))) {
    return process.cwd();
  }
  return PROJECT_DIR;
}

export async function install() {
  log('Checking prerequisites...');
  if (!checkCommand('git')) { err('git is required. Install from https://git-scm.com'); process.exit(1); }
  if (!checkCommand('node')) { err('Node.js is required. Install from https://nodejs.org'); process.exit(1); }

  if (!existsSync(FLOVART_HOME)) mkdirSync(FLOVART_HOME, { recursive: true });

  if (existsSync(join(PROJECT_DIR, '.git'))) {
    log('Project already exists, pulling latest...');
    await run('git', ['pull'], { cwd: PROJECT_DIR });
  } else {
    log('Cloning Flovart repository...');
    await run('git', ['clone', REPO_URL, PROJECT_DIR]);
  }

  log('Installing frontend dependencies (npm install)...');
  await run('npm', ['install'], { cwd: PROJECT_DIR });

  for (const dir of ['backend', 'backend/enterprise']) {
    const dirAbs = join(PROJECT_DIR, dir);
    const envFile = join(dirAbs, '.env');
    const exampleFile = join(dirAbs, '.env.example');
    if (!existsSync(envFile) && existsSync(exampleFile)) {
      copyFileSync(exampleFile, envFile);
      log('Created ' + dir + '/.env from .env.example (edit to customize).');
    }
  }

  if (checkCommand('go')) {
    log('Downloading Go dependencies...');
    await run('go', ['mod', 'download'], { cwd: join(PROJECT_DIR, 'backend') });
    await run('go', ['mod', 'download'], { cwd: join(PROJECT_DIR, 'backend', 'enterprise') });
  } else {
    warn('Go not found, skipping backend dependencies. Install Go from https://go.dev to run the backend.');
  }

  log('Flovart installed to ' + PROJECT_DIR);
  log('Run `flovart start` to launch the development environment.');
}

export async function start() {
  const projectDir = resolveProjectDir();
  if (!existsSync(projectDir)) {
    err('Flovart not installed. Run `flovart install` first, or run from the project directory.');
    process.exit(1);
  }

  if (!checkCommand('node')) { err('Node.js is required.'); process.exit(1); }

  const hubDir = join(projectDir, 'backend');
  const entDir = join(projectDir, 'backend', 'enterprise');
  const hasGo = checkCommand('go');

  let pgReady = false;
  if (checkCommand('docker')) {
    pgReady = await ensurePostgres();
  } else {
    warn('Docker not found. Ensure PostgreSQL is running on localhost:' + PG_PORT + ' (db=' + PG_DB + ', user=' + PG_USER + ').');
  }

  const env = { ...process.env };

  log('Starting development servers...');
  log('  Frontend (vite):       http://localhost:3217');
  if (hasGo) {
    log('  Hub backend (go):      http://localhost:8080  (auth/prompts/uploads)');
    log('  Enterprise backend:    http://localhost:8081  (org/dept/role)');
  } else {
    warn('Go not found. Only frontend will start. Install Go from https://go.dev to run backends.');
  }
  if (pgReady) log('  PostgreSQL:            localhost:' + PG_PORT);
  if (!pgReady && hasGo) {
    warn('PostgreSQL not ready. Go backends will start but may fail to connect.');
  }
  log('  Press Ctrl+C to stop all servers.\n');

  let viteChild = null;
  const backendChildren = [];

  viteChild = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true, cwd: projectDir, env });

  if (hasGo) {
    backendChildren.push(spawn('go', ['run', 'cmd/server/main.go'], { stdio: 'inherit', shell: true, cwd: hubDir, env }));
    backendChildren.push(spawn('go', ['run', 'cmd/server/main.go'], { stdio: 'inherit', shell: true, cwd: entDir, env }));
  }

  const allChildren = [viteChild, ...backendChildren];

  const cleanup = () => {
    for (const c of allChildren) {
      try { c.kill(); } catch {}
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  viteChild.on('close', cleanup);

  for (const c of backendChildren) {
    c.on('close', (code) => {
      if (code !== 0) warn('A backend process exited (code ' + code + '). Frontend keeps running. Press Ctrl+C to stop all.');
    });
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

export async function update() {
  const projectDir = resolveProjectDir();
  if (!existsSync(projectDir)) {
    err('Flovart not installed. Run `flovart install` first, or run from the project directory.');
    process.exit(1);
  }

  log('Pulling latest code...');
  await run('git', ['pull'], { cwd: projectDir });

  log('Updating frontend dependencies...');
  await run('npm', ['install'], { cwd: projectDir });

  if (checkCommand('go')) {
    log('Updating Go dependencies...');
    await run('go', ['mod', 'download'], { cwd: join(projectDir, 'backend') });
    await run('go', ['mod', 'download'], { cwd: join(projectDir, 'backend', 'enterprise') });
  }

  log('Flovart updated successfully.');
}
