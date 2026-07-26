import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';

function resolveCliPath() {
  try { return fileURLToPath(new URL('./cli.js', import.meta.url)); }
  catch { return join(process.cwd(), 'tools', 'flovart', 'cli.js'); }
}

export const HELP_TEXT = `
Flovart Terminal Command Center

  /runtime              inspect Production Runtime
  /workspace            inspect visible Workflow connection
  /tasks                list durable Runtime tasks
  /research <topic>     collect Reddit/X topic signals
  /models               list Product Models
  /run <cli args>       run any canonical Flovart command
  /start                start Runtime/WebUI + Codex agent
  /clear                clear command output
  /help                 show command help
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
    } else if (char === '\\') {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
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
  if (name === 'start' || name === 's') return { type: 'run', args: ['start', ...args] };
  if (name === 'web') return { type: 'run', args: ['start', '--source', '--web', '--open', ...args] };
  if (name === 'backend') return { type: 'run', args: ['start', '--source', '--backend', ...args] };
  if (name === 'db') return { type: 'run', args: ['start', '--source', '--db', ...args] };
  if (name === 'docker') return { type: 'run', args: ['start', '--source', '--docker', '--all', '--open', ...args] };
  if (name === 'plan') return { type: 'run', args: ['start', '--plan', '--json', ...args] };
  if (name === 'doctor') return { type: 'run', args: ['doctor', '--json', ...args] };
  if (name === 'status') return { type: 'run', args: ['status', '--json', ...args] };
  if (name === 'runtime') return { type: 'run', args: ['runtime.status', '--json', ...args] };
  if (name === 'workspace') return { type: 'run', args: ['workspace.status', '--json', ...args] };
  if (name === 'tasks') return { type: 'run', args: ['task.list', '--limit', '20', '--json', ...args] };
  if (name === 'models') return { type: 'run', args: ['models.list', '--json', ...args] };
  if (name === 'research') {
    if (!args.length) return { type: 'unknown', name: 'research (topic required)' };
    return {
      type: 'run',
      args: [
        'research.topic.collect',
        '--topic', args.join(' '),
        '--sources', '["reddit","x"]',
        '--idempotency-key', `tui-research-${Date.now()}`,
        '--json',
      ],
    };
  }
  if (name === 'run') return { type: 'run', args };
  if (!slash) return { type: 'run', args: tokens };
  return { type: 'unknown', name };
}

export function runCliCaptured(args, options = {}) {
  return new Promise(resolveRun => {
    const child = spawn(process.execPath, [resolveCliPath(), ...args], {
      cwd: options.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    let out = '';
    let errorOut = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { errorOut += chunk; });
    child.on('close', code => {
      let json = null;
      try { json = JSON.parse(out); } catch {}
      resolveRun({ code: code ?? 0, stdout: out.trim(), stderr: errorOut.trim(), json });
    });
    child.on('error', error => resolveRun({ code: 1, stdout: '', stderr: error.message, json: null }));
  });
}

function stateOf(result, connectedField) {
  if (!result?.json?.ok) return {
    state: result?.json?.error?.code || 'offline',
    detail: result?.json?.error?.message || result?.stderr || 'unavailable',
  };
  const data = result.json.data || {};
  return {
    state: connectedField ? (data[connectedField] ? 'connected' : data.state || 'disconnected') : data.state || 'ready',
    detail: connectedField ? `${data.clients || 0} client(s)` : data.runtimeInstanceId || data.authority || '',
  };
}

export async function readTuiDashboard() {
  const [runtimeResult, workspaceResult, taskResult, eventResult] = await Promise.all([
    runCliCaptured(['runtime.status', '--json']),
    runCliCaptured(['workspace.status', '--json']),
    runCliCaptured(['task.list', '--limit', '12', '--json']),
    runCliCaptured(['event.stream', '--after-event-id', '0', '--limit', '12', '--json']),
  ]);
  const runtime = stateOf(runtimeResult);
  const workspace = stateOf(workspaceResult, 'hasWorkflow');
  const tasks = taskResult?.json?.ok ? taskResult.json.data?.items || taskResult.json.data?.tasks || [] : [];
  const events = eventResult?.json?.ok ? eventResult.json.data?.items || eventResult.json.data?.events || [] : [];
  return {
    capturedAt: new Date().toISOString(),
    runtime,
    workspace,
    tasks,
    events,
  };
}

export function formatTuiSnapshot(model) {
  const lines = [
    '┌ Flovart Terminal Command Center ─────────────────────────────',
    `│ Runtime   ${model.runtime.state} ${model.runtime.detail}`.trimEnd(),
    `│ Workflow  ${model.workspace.state} ${model.workspace.detail}`.trimEnd(),
    `│ Tasks     ${model.tasks.length} recent`,
    `│ Events    ${model.events.length} recent`,
    '└──────────────────────────────────────────────────────────────',
  ];
  for (const task of model.tasks.slice(0, 5)) {
    lines.push(`  ${task.status || 'unknown'}  ${task.kind || task.command || ''}  ${task.id || ''}`.trimEnd());
  }
  return lines.join('\n');
}

function statusColor(state) {
  if (['ready', 'connected', 'completed'].includes(state)) return 'green';
  if (['disconnected', 'working', 'queued'].includes(state)) return 'yellow';
  return 'red';
}

const h = React.createElement;

function StatusPill({ label, value }) {
  return h(Box, { marginRight: 2 },
    h(Text, { dimColor: true }, `${label} `),
    h(Text, { color: statusColor(value), bold: true }, value),
  );
}

function TerminalApp() {
  const { exit } = useApp();
  const [dashboard, setDashboard] = useState({
    runtime: { state: 'checking', detail: '' },
    workspace: { state: 'checking', detail: '' },
    tasks: [],
    events: [],
  });
  const [inputValue, setInputValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState(['Type /help for commands. Runtime state refreshes every 2.5s.']);

  const refresh = useCallback(async () => {
    try { setDashboard(await readTuiDashboard()); }
    catch (error) {
      setDashboard(current => ({ ...current, runtime: { state: 'offline', detail: error instanceof Error ? error.message : String(error) } }));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const tick = async () => { if (active) await refresh(); };
    tick();
    const timer = setInterval(tick, 2_500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);

  useInput((value, key) => {
    if ((key.ctrl && value === 'c') || key.escape) exit();
  });

  const submit = useCallback(async value => {
    const command = buildTuiCommand(value);
    setInputValue('');
    if (command.type === 'empty') return;
    if (command.type === 'exit') return exit();
    if (command.type === 'clear') return setLines([]);
    if (command.type === 'help') return setLines(HELP_TEXT.trim().split('\n'));
    if (command.type === 'unknown') return setLines(current => [...current, `Unknown slash command: /${command.name}`].slice(-18));
    setBusy(true);
    setLines(current => [...current, `› ${value}`].slice(-18));
    const result = await runCliCaptured(command.args);
    const text = result.stdout || result.stderr || `Command exited ${result.code}`;
    setLines(current => [...current, ...text.split(/\r?\n/)].slice(-18));
    setBusy(false);
    await refresh();
  }, [exit, refresh]);

  const taskLines = useMemo(() => dashboard.tasks.slice(0, 6).map(task => ({
    id: task.id || task.taskId || 'unknown',
    status: task.status || 'unknown',
    kind: task.kind || task.command || 'task',
  })), [dashboard.tasks]);

  return h(Box, { flexDirection: 'column', paddingX: 1 },
    h(Box, { justifyContent: 'space-between' },
      h(Text, { bold: true, color: 'cyan' }, 'FLOVART'),
      h(Text, { dimColor: true }, 'Terminal Command Center'),
    ),
    h(Box, null,
      h(StatusPill, { label: 'Runtime', value: dashboard.runtime.state }),
      h(StatusPill, { label: 'Workflow', value: dashboard.workspace.state }),
      h(StatusPill, { label: 'Agent', value: 'external' }),
    ),
    h(Box, { flexDirection: 'row', gap: 1, marginTop: 1 },
      h(Box, { borderStyle: 'round', borderColor: 'gray', flexDirection: 'column', width: '42%', paddingX: 1 },
        h(Text, { bold: true }, `Durable tasks · ${dashboard.tasks.length}`),
        ...(taskLines.length ? taskLines.map(task => h(Text, { key: task.id, color: statusColor(task.status) },
          `${task.status.padEnd(10)} ${task.kind} ${task.id.slice(-10)}`,
        )) : [h(Text, { key: 'empty', dimColor: true }, 'No visible tasks')]),
      ),
      h(Box, { borderStyle: 'round', borderColor: 'gray', flexDirection: 'column', width: '58%', paddingX: 1 },
        h(Text, { bold: true }, `Command output${busy ? ' · running' : ''}`),
        ...lines.map((line, index) => h(Text, { key: `${index}-${line.slice(0, 12)}`, wrap: 'truncate' }, line)),
      ),
    ),
    h(Box, { borderStyle: 'round', borderColor: busy ? 'yellow' : 'cyan', paddingX: 1, marginTop: 1 },
      h(Text, { color: 'cyan', bold: true }, '› '),
      h(TextInput, {
        value: inputValue,
        onChange: setInputValue,
        onSubmit: submit,
        placeholder: busy ? 'command running…' : '/research <topic> or /run <command>',
      }),
    ),
    h(Text, { dimColor: true }, 'Esc/Ctrl+C exit · all production state remains in Desktop Runtime'),
  );
}

export async function runTui(argv = []) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP_TEXT.trim());
    return;
  }
  if (argv.includes('--snapshot') || !stdin.isTTY || !stdout.isTTY) {
    console.log(formatTuiSnapshot(await readTuiDashboard()));
    return;
  }
  const instance = render(h(TerminalApp), { exitOnCtrlC: false });
  await instance.waitUntilExit();
}
