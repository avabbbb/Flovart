#!/usr/bin/env node
import { COMMAND_REGISTRY, executeFlovartCommand, formatValue, HELP_TEXT, normalizeCommandName, parseCliArgs, SETUP_TEXT } from './core.js';
import { getCanonicalRegistry } from './registry.js';
import { resolveDirectorBinding } from './host-registry.js';
import { createShadowRuntimeFacade } from './shadow-runtime.js';
import { readFile } from 'node:fs/promises';
import { defaultRuntimeActor, FlovartRuntimeClient, RuntimeClientError } from './runtime-client.js';
import { RUNTIME_COMMANDS, RUNTIME_WRITE_COMMANDS } from './runtime-command-surface.js';
import { WORKSPACE_COMMANDS, WORKSPACE_WRITE_COMMANDS } from './workspace-command-surface.js';
import { CREW_COMMANDS, CREW_WRITE_COMMANDS } from './crew-command-surface.js';
import { RESEARCH_COMMANDS, RESEARCH_WRITE_COMMANDS } from './research-command-surface.js';
import { collectTopicResearch } from './topic-research.js';
import { runSkillCommand, SKILL_COMMAND_NAMES } from './skill-commands.js';
import { getLocalStatus } from './local-status.js';
import { ensureFlovart } from './ensure.js';
import {
  createWorkspaceFacade,
  FlovartWorkspaceClient,
  FlovartCrewClient,
  WorkspaceClientError,
} from './workspace-client.js';

const argv = process.argv.slice(2);

function isResultOk(result) {
  return !(result && typeof result === 'object' && result.ok === false);
}

function printCliResponse(ok, commandName, data = null, error = null, extra = {}) {
  console.log(JSON.stringify({ ok, command: commandName, data, error, ...extra }, null, 2));
  if (!ok) process.exitCode = 1;
}

function normalizeAtomicAlias(rawCommand, parsedArgs) {
  return { command: rawCommand, args: parsedArgs };
}

const LOCAL_COMMANDS = new Set([
  'help', 'setup', 'init', 'doctor', 'host.list',
  'inspiration.search', 'inspiration.get',
  'prompt.enhance', 'batch.plan',
  'preferences.manage', 'models.list',
]);
const CLIENT_REGISTRY_COMMANDS = new Set(['command.list', 'command.schema']);

const FILE_STATE_COMMANDS = new Set([
  'asset.list', 'export.project', 'video.status',
]);

// 旧浏览器 Bridge 文件队列已删除；Workflow 节点运行/停止现在只通过
// Workspace Adapter 转发到浏览器 Authority 的唯一 WorkflowExecutor。
const RETIRED_COMMANDS = new Set([
  'provider.begin-setup', 'provider.select-model', 'provider.test',
  'generate.images-batch',
]);

function runtimeInvocation(command, parsed) {
  const definition = COMMAND_REGISTRY[command];
  const commandArgs = {};
  for (const [name, type] of Object.entries(definition?.args || {})) {
    const kebab = name.replace(/([A-Z])/g, '-$1').toLowerCase();
    const raw = parsed[name] ?? parsed[kebab];
    if (raw === undefined) continue;
    const base = type.replace(/\?$/, '');
    if (base === 'number') commandArgs[name] = Number(raw);
    else if (base === 'boolean') commandArgs[name] = raw === true || String(raw).toLowerCase() === 'true';
    else if (['object', 'array', 'string[]'].includes(base) && typeof raw === 'string') {
      try {
        commandArgs[name] = JSON.parse(raw);
      } catch (error) {
        throw new RuntimeClientError(
          'INVALID_ARGUMENT',
          `--${kebab} must be valid JSON (${base}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else commandArgs[name] = raw;
  }
  const idempotencyKey = parsed.idempotencyKey || parsed['idempotency-key'];
  if (RUNTIME_WRITE_COMMANDS.has(command) && !idempotencyKey) {
    throw new RuntimeClientError(
      'INVALID_ARGUMENT',
      `${command} requires --idempotency-key so retries cannot duplicate work.`,
    );
  }
  return { commandArgs, options: { ...(idempotencyKey ? { idempotencyKey } : {}) } };
}

function directorAgentIdentity(parsed, { optional = false } = {}) {
  const identity = parsed.agentIdentity || parsed['agent-identity'] || parsed.host || parsed._?.[0];
  if (!identity && optional) return undefined;
  const binding = resolveDirectorBinding(identity);
  if (!binding) {
    throw new WorkspaceClientError('INVALID_ARGUMENT', `Agent Identity 无可用的 Director Runtime Binding：${identity || '(empty)'}`, { retryable: false });
  }
  return binding.agentIdentityId;
}

const rawCommand = argv[0];

if (rawCommand === '--help' || rawCommand === '-h') {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (rawCommand === 'tui' || rawCommand === 'ui' || rawCommand === 'interactive' || (!rawCommand && process.stdin.isTTY)) {
  const mod = await import('./tui.js');
  await mod.runTui(rawCommand ? argv.slice(1) : []);
  process.exit(0);
}

if (['install', 'start', 'update'].includes(rawCommand)) {
  const mod = await import('./dev-commands.js');
  await mod[rawCommand](argv.slice(1));
} else if (rawCommand === 'agent') {
  await import('./managed-agent/index.js').catch(() => import('../../agent/index.js'));
} else {
  const parsedArgs = parseCliArgs(argv.slice(1));
  const normalizedAtomic = normalizeAtomicAlias(rawCommand, parsedArgs);
  const command = normalizeCommandName(normalizedAtomic.command);
  const args = normalizedAtomic.args;
  let fileReadError = false;

  if (args.file) {
    try {
      const payload = JSON.parse(await readFile(args.file, 'utf8'));
      if (command === 'generate.images-batch' || command === 'generate.video') args.items = payload.items || payload;
      if (command === 'production.dry-run') args.spec = payload;
    } catch (error) {
      printCliResponse(false, command || 'unknown', null, { code: 'FILE_READ_ERROR', message: error instanceof Error ? error.message : String(error) });
      fileReadError = true;
      process.exitCode = 1;
    }
  }

  async function main() {
  if (fileReadError) return;
  if (!command) {
    printCliResponse(true, 'help', { usage: 'flovart  # opens TUI; or flovart <command> --json', setup: SETUP_TEXT, commands: { tui: 'Open slash-command TUI', install: 'Download and verify the versioned Agent Toolkit', start: 'Launch local Runtime/WebUI services', update: 'Install and switch to the latest compatible Toolkit', source: 'Add --source for Vite/Go/Docker contributor services' } });
    return;
  }

  const routingCommand = command;

  if (routingCommand === 'ensure') {
    const result = await ensureFlovart({ open: !(args.noOpen || args['no-open']) });
    printCliResponse(result.ok, command, result, result.ok ? null : result.error, { runtime: 'flovart-link' });
    return;
  }

  // WorkBuddy's CLI connector lifecycle is local-ready semantics, not a second
  // account or OAuth flow. It never revokes Flovart credentials shared by other
  // Hosts when WorkBuddy runs unAuth.
  if (routingCommand === 'workbuddy.status') {
    const result = await getLocalStatus();
    printCliResponse(true, command, { state: result.ready ? 'local-ready' : 'offline', status: result }, null, { runtime: 'workbuddy-connector' });
    return;
  }
  if (routingCommand === 'workbuddy.auth') {
    const result = await ensureFlovart({ open: false });
    printCliResponse(result.ok, command, { state: result.ok ? 'local-ready' : 'offline', ...result }, result.ok ? null : result.error, { runtime: 'workbuddy-connector' });
    return;
  }
  if (routingCommand === 'workbuddy.unAuth') {
    printCliResponse(true, command, {
      state: 'local-ready',
      message: 'Flovart 本地服务不保存 WorkBuddy 账号；此次 unAuth 不会注销或影响其它 Host。',
    }, null, { runtime: 'workbuddy-connector' });
    return;
  }

  if (CLIENT_REGISTRY_COMMANDS.has(routingCommand)) {
    const result = await executeFlovartCommand(command, args, {});
    const ok = isResultOk(result);
    if (args.json) printCliResponse(ok, command, ok ? result : null, ok ? null : result.error || null, { runtime: 'client-registry' });
    else {
      console.log(formatValue(result));
      if (!ok) process.exitCode = 1;
    }
    return;
  }

  if (RUNTIME_COMMANDS.has(routingCommand)) {
    const runtime = new FlovartRuntimeClient();
    try {
      const invocation = runtimeInvocation(routingCommand, args);
      let result;
      if (routingCommand === 'runtime.status') result = await runtime.status();
      else if (routingCommand === 'task.get') result = await runtime.getTask(invocation.commandArgs.taskId);
      else if (routingCommand === 'task.list') result = await runtime.listTasks(invocation.commandArgs);
      else if (routingCommand === 'event.stream') result = await runtime.streamEvents(invocation.commandArgs);
      else {
        result = await runtime.execute(
          routingCommand,
          invocation.commandArgs,
          defaultRuntimeActor('cli'),
          invocation.options,
        );
      }
      if (args.json) printCliResponse(true, command, result, null, { runtime: 'production-runtime' });
      else console.log(formatValue(result));
    } catch (error) {
      const runtimeError = error instanceof RuntimeClientError
        ? error.toJSON()
        : { code: 'RUNTIME_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true };
      printCliResponse(false, command, null, runtimeError, { runtime: 'production-runtime' });
    }
    return;
  }

  if (WORKSPACE_COMMANDS.has(routingCommand)) {
    const idempotencyKey = args.idempotencyKey || args['idempotency-key'];
    if (WORKSPACE_WRITE_COMMANDS.has(routingCommand) && !idempotencyKey) {
      printCliResponse(false, command, null, {
        code: 'INVALID_ARGUMENT',
        message: `${routingCommand} requires --idempotency-key so retries cannot duplicate visible Workflow changes.`,
        retryable: false,
      }, { runtime: 'workspace-adapter' });
      return;
    }
    try {
      const workspace = new FlovartWorkspaceClient();
      const result = routingCommand === 'workspace.status'
        ? await workspace.status()
        : await executeFlovartCommand(command, args, createWorkspaceFacade(workspace));
      const ok = isResultOk(result);
      printCliResponse(ok, command, result, ok ? null : result.error || null, { runtime: 'workspace-adapter' });
    } catch (error) {
      const workspaceError = error instanceof WorkspaceClientError
        ? error.toJSON()
        : { code: 'WORKSPACE_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true };
      printCliResponse(false, command, null, workspaceError, { runtime: 'workspace-adapter' });
    }
    return;
  }

  if (CREW_COMMANDS.has(routingCommand)) {
    const idempotencyKey = args.idempotencyKey || args['idempotency-key'];
    if (CREW_WRITE_COMMANDS.has(routingCommand) && routingCommand === 'crew.intent.submit' && !idempotencyKey) {
      printCliResponse(false, command, null, {
        code: 'INVALID_ARGUMENT',
        message: `${routingCommand} requires --idempotency-key so retries cannot duplicate Crew Intent work.`,
        retryable: false,
      }, { runtime: 'crew' });
      return;
    }
    try {
      const crew = new FlovartCrewClient();
      const protocol = await crew.protocol();
      const registry = getCanonicalRegistry();
      if (protocol.protocolVersion !== registry.protocolVersion || protocol.registryHash !== registry.registryHash) {
        printCliResponse(false, command, null, {
          code: 'PROTOCOL_MISMATCH',
          message: 'Workspace Adapter Crew 协议版本或 Registry Hash 与本地 CLI 不一致；请先升级或 command.list 重新读取。',
          retryable: false,
          details: { protocolVersion: protocol.protocolVersion, registryHash: protocol.registryHash },
        }, { runtime: 'crew' });
        return;
      }
      let result;
      switch (routingCommand) {
        case 'director.bind':
          result = await crew.bindDirector({
            agentIdentity: directorAgentIdentity(args),
            sessionId: args.sessionId || args['session-id'],
            hostInstanceId: args.hostInstanceId || args['host-instance-id'],
            projectId: args.projectId || args['project-id'],
          });
          break;
        case 'director.handoff':
          result = await crew.handoffDirector({
            agentIdentity: directorAgentIdentity(args),
            sessionId: args.sessionId || args['session-id'],
            hostInstanceId: args.hostInstanceId || args['host-instance-id'],
            projectId: args.projectId || args['project-id'],
            expectedBindingId: args.expectedBindingId || args['expected-binding-id'],
          });
          break;
        case 'director.status':
          result = await crew.directorStatus({
            agentIdentity: directorAgentIdentity(args, { optional: true }),
            sessionId: args.sessionId || args['session-id'],
            projectId: args.projectId || args['project-id'],
          });
          break;
        case 'director.unbind':
          result = await crew.unbindDirector({ bindingId: args.bindingId || args['binding-id'] });
          break;
        case 'crew.intent.submit':
          result = await crew.submitIntent({
            intentJson: args.intentJson || args['intent-json'] || args._?.[0],
            projectId: args.projectId || args['project-id'],
            idempotencyKey,
            director: args.director ? JSON.parse(args.director) : null,
          });
          break;
        case 'crew.intent.get':
          result = await crew.getIntent(args.intentId || args['intent-id'] || args._?.[0]);
          break;
        case 'crew.intent.cancel':
          result = await crew.cancelIntent(args.intentId || args['intent-id'] || args._?.[0], args.reason);
          break;
        case 'crew.receipt.get':
          result = await crew.getReceipt(args.intentId || args['intent-id'] || args._?.[0]);
          break;
        case 'crew.event.watch':
          result = await crew.listEvents({
            afterEventId: args.afterEventId ?? args.after ?? args['after-event-id'],
            limit: args.limit,
          });
          break;
      }
      const ok = Boolean(result?.ok);
      if (args.jsonl || args['jsonl']) {
        for (const event of result?.events || []) console.log(JSON.stringify(event));
      } else {
        printCliResponse(ok, command, result, ok ? null : result?.error || null, { runtime: 'crew', protocolVersion: protocol.protocolVersion, registryHash: protocol.registryHash });
      }
    } catch (error) {
      const crewError = error instanceof WorkspaceClientError
        ? error.toJSON()
        : { code: 'CREW_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true };
      printCliResponse(false, command, null, crewError, { runtime: 'crew' });
    }
    return;
  }

  if (RESEARCH_COMMANDS.has(routingCommand)) {
    const idempotencyKey = args.idempotencyKey || args['idempotency-key'];
    if (RESEARCH_WRITE_COMMANDS.has(routingCommand) && !idempotencyKey) {
      printCliResponse(false, command, null, {
        code: 'INVALID_ARGUMENT',
        message: `${routingCommand} requires --idempotency-key so retries replay the same research artifact.`,
        retryable: false,
      }, { runtime: 'research-adapter' });
      return;
    }
    try {
      const result = await collectTopicResearch(args, { idempotencyKey });
      const ok = result.state !== 'failed';
      printCliResponse(ok, command, ok ? result : null, ok ? null : {
        code: 'SOURCE_UNAVAILABLE',
        message: 'No usable topic evidence was collected from the requested sources.',
        retryable: true,
        details: result,
      }, { runtime: 'research-adapter' });
    } catch (error) {
      printCliResponse(false, command, null, {
        code: error?.code || 'RESEARCH_FAILED',
        message: error instanceof Error ? error.message : String(error),
        retryable: error?.code !== 'INVALID_ARGUMENT',
      }, { runtime: 'research-adapter' });
    }
    return;
  }

  if (SKILL_COMMAND_NAMES.has(routingCommand)) {
    try {
      const result = await runSkillCommand(routingCommand, args);
      const ok = Boolean(result && result.ok === true);
      printCliResponse(ok, command, ok ? result : null, ok ? null : result.error || null, { runtime: 'skill-registry' });
    } catch (error) {
      printCliResponse(false, command, null, {
        code: 'CLI_FATAL',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      }, { runtime: 'skill-registry' });
    }
    return;
  }

  if (LOCAL_COMMANDS.has(routingCommand)) {
    const result = await executeFlovartCommand(command, args, {});
    const ok = isResultOk(result);
    if (args.json) printCliResponse(ok, command, result, ok ? null : result.error || null);
    else {
      console.log(formatValue(result.text || result));
      if (!ok) process.exitCode = 1;
    }
    return;
  }

  if (routingCommand === 'status') {
    const result = await getLocalStatus();
    printCliResponse(true, command, result, null, { runtime: 'local-system' });
    return;
  }

  if (FILE_STATE_COMMANDS.has(routingCommand)) {
    const runtime = createShadowRuntimeFacade();
    const result = await executeFlovartCommand(command, args, runtime);
    printCliResponse(isResultOk(result), command, result, isResultOk(result) ? null : result.error || null, { runtime: 'file-state' });
    return;
  }

  if (RETIRED_COMMANDS.has(routingCommand)) {
    printCliResponse(false, command, null, {
      code: 'COMMAND_RETIRED',
      message: `${routingCommand} 已下线：浏览器 Bridge 文件队列已删除且前端不再消费。请使用生产 Runtime 命令（generate.image、generate.video、provider.status、task.list）或 Flovart WebUI。`,
      retryable: false,
    }, { runtime: 'retired' });
    return;
  }

  const result = await executeFlovartCommand(command, args, createShadowRuntimeFacade());
  printCliResponse(isResultOk(result), command, result, isResultOk(result) ? null : result.error || null, { runtime: 'file-state' });
  }

  main().catch(error => {
    printCliResponse(false, command || 'unknown', null, { code: 'CLI_FATAL', message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
