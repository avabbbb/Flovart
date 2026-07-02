import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveCliPath() {
  try { return fileURLToPath(new URL('./cli.js', import.meta.url)); }
  catch { return join(process.cwd(), 'tools', 'flovart', 'cli.js'); }
}

const HELP_TEXT = `
Flovart TUI

Commands:
  /install              install dependencies
  /start                start all services and open browser
  /web                  start frontend only
  /backend              start backend + db
  /db                   start database only
  /docker               docker compose up all
  /docker -d            docker compose up all in background
  /plan [args]          preview start plan, e.g. /plan --web
  /doctor               run doctor check
  /status               show local status
  /models               list models
  /run <cli args>       run any flovart cli command
  /help                 show this help
  /exit                 quit
`;

export function tokenizeTuiLine(line = '') {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of String(line)) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

export function buildTuiCommand(line = '') {
  const tokens = tokenizeTuiLine(line.trim());
  if (tokens.length === 0) return { type: 'empty' };

  const slash = tokens[0].startsWith('/');
  const name = (slash ? tokens[0].slice(1) : tokens[0]).toLowerCase();
  const args = tokens.slice(1);

  if (['q', 'quit', 'exit'].includes(name)) return { type: 'exit' };
  if (['h', 'help', '?'].includes(name)) return { type: 'help' };
  if (name === 'clear') return { type: 'clear' };

  if (name === 'install' || name === 'i') return { type: 'run', args: ['install', ...args] };
  if (name === 'update') return { type: 'run', args: ['update', ...args] };
  if (name === 'start' || name === 's') return { type: 'run', args: ['start', ...(args.length ? args : ['--all', '--open'])] };
  if (name === 'web') return { type: 'run', args: ['start', '--web', '--open', ...args] };
  if (name === 'backend') return { type: 'run', args: ['start', '--backend', ...args] };
  if (name === 'db') return { type: 'run', args: ['start', '--db', ...args] };
  if (name === 'docker') return { type: 'run', args: ['start', '--docker', '--all', '--open', ...args] };
  if (name === 'plan') return { type: 'run', args: ['start', '--plan', '--json', ...(args.length ? args : ['--all'])] };
  if (name === 'doctor') return { type: 'run', args: ['doctor', '--json', ...args] };
  if (name === 'status') return { type: 'run', args: ['status', '--json', ...args] };
  if (name === 'models') return { type: 'run', args: ['models.list', '--json', ...args] };
  if (name === 'run') return { type: 'run', args };

  if (!slash) return { type: 'run', args: tokens };
  return { type: 'unknown', name };
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [resolveCliPath(), ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });
    child.on('close', code => resolve(code ?? 0));
    child.on('error', error => {
      console.error('[flovart] failed:', error.message);
      resolve(1);
    });
  });
}

export async function runTui(argv = []) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP_TEXT.trim());
    return;
  }

  console.log(HELP_TEXT.trim());
  const rl = createInterface({ input, output, prompt: 'flovart> ' });
  rl.prompt();

  for await (const line of rl) {
    const command = buildTuiCommand(line);
    if (command.type === 'empty') {
      rl.prompt();
      continue;
    }
    if (command.type === 'exit') break;
    if (command.type === 'help') {
      console.log(HELP_TEXT.trim());
      rl.prompt();
      continue;
    }
    if (command.type === 'clear') {
      console.clear();
      rl.prompt();
      continue;
    }
    if (command.type === 'unknown') {
      console.log(`[flovart] unknown slash command: /${command.name}`);
      rl.prompt();
      continue;
    }

    rl.pause();
    await runCli(command.args);
    rl.resume();
    rl.prompt();
  }

  rl.close();
}