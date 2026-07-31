import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { FlovartAgentKernel } from '../agent/kernel.js';
import { createFlovartAgentTools } from '../agent/mcp.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'flovart-agent-kernel-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('Flovart Agent Kernel', () => {
  it('restores the main production conversation from the PI SQLite session store', async () => {
    const directory = await temporaryDirectory();
    const databasePath = join(directory, 'agent-sessions.db');
    const faux = fauxProvider({ tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage('我已读取项目，先整理制作目标。')]);

    const first = new FlovartAgentKernel({
      databasePath,
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple,
    });
    await first.openSession({ projectId: 'project-one', cwd: directory });
    await first.send('制作一个 30 秒解释视频');
    expect((await first.snapshot()).messages.map(message => [message.role, message.text])).toEqual([
      ['user', '制作一个 30 秒解释视频'],
      ['assistant', '我已读取项目，先整理制作目标。'],
    ]);
    await first.close();

    const reopened = new FlovartAgentKernel({
      databasePath,
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple,
    });
    const restored = await reopened.openSession({ projectId: 'project-one', cwd: directory });
    expect(restored.messages.map(message => [message.role, message.text])).toEqual([
      ['user', '制作一个 30 秒解释视频'],
      ['assistant', '我已读取项目，先整理制作目标。'],
    ]);
    await reopened.close();
  });

  it('executes a typed visible-Workflow tool and persists its result before the final reply', async () => {
    const directory = await temporaryDirectory();
    const calls: unknown[] = [];
    const faux = fauxProvider({ tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('flovart_workflow_node_create', {
        type: 'text',
        title: '脚本大纲',
        x: 120,
        y: 80,
        idempotencyKey: 'agent-create-outline-v1',
      }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('脚本大纲节点已经写入可见 Workflow。'),
    ]);
    const kernel = new FlovartAgentKernel({
      databasePath: join(directory, 'agent-sessions.db'),
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple,
      tools: createFlovartAgentTools(async (command, args, source, idempotencyKey) => {
        calls.push({ command, args, source, idempotencyKey });
        return { ok: true, node: { id: 'outline-1', title: args.title } };
      }),
    });

    await kernel.openSession({ projectId: 'project-tools', cwd: directory });
    await kernel.send('创建一个脚本大纲节点');

    expect(calls).toEqual([expect.objectContaining({
      command: 'workflow.node.create',
      source: 'agent',
      idempotencyKey: 'agent-create-outline-v1',
    })]);
    expect((await kernel.snapshot()).messages.map(message => [message.role, message.toolName, message.text])).toEqual([
      ['user', undefined, '创建一个脚本大纲节点'],
      ['tool', 'flovart_workflow_node_create', expect.stringContaining('"outline-1"')],
      ['assistant', undefined, '脚本大纲节点已经写入可见 Workflow。'],
    ]);
    await kernel.close();
  });
});
