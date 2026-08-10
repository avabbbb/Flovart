import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { FlovartAgentKernel } from '../agent/kernel.js';
import { createFlovartAgentTools } from '../agent/mcp.js';
import { createProductionSkillAttachment, getBundledProductionSkill } from '../services/productionSkillCatalog';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { dispatchWorkflowCommand } from '../services/workflowDispatcher';

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

  it('drives the actual visible Workflow Draft authority through the PI tool loop', async () => {
    const directory = await temporaryDirectory();
    const project = createWorkflowProject('真实 Draft 闭环');
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id, hydrated: true });
    const faux = fauxProvider({ tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('flovart_workflow_node_create', {
        projectId: project.id,
        type: 'text',
        title: '画布脚本',
        idempotencyKey: 'real-draft-create-v1',
      }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('节点已写入同一画布。'),
    ]);
    const kernel = new FlovartAgentKernel({
      databasePath: join(directory, 'agent-sessions.db'),
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple,
      tools: createFlovartAgentTools((command, args, source, idempotencyKey) => dispatchWorkflowCommand({
        id: crypto.randomUUID(), command, args, source, idempotencyKey,
      })),
    });

    await kernel.openSession({ projectId: project.id, cwd: directory });
    await kernel.send('在当前画布创建脚本节点');

    const changed = useWorkflowStore.getState().projects[0];
    expect(changed.nodes).toHaveLength(1);
    expect(changed.nodes[0]).toMatchObject({ title: '画布脚本', objectVersion: 1 });
    expect(changed.draftChangeSets).toHaveLength(1);
    expect(changed.draftChangeSets?.[0]).toMatchObject({ actor: 'agent', status: 'completed' });
    await kernel.close();
  });

  it('rejects a tampered Production Skill attachment before calling the model', async () => {
    const directory = await temporaryDirectory();
    const faux = fauxProvider({ tokensPerSecond: 0 });
    faux.setResponses([fauxAssistantMessage('不应调用模型')]);
    const skill = getBundledProductionSkill('community.vox-director');
    expect(skill).not.toBeNull();
    const attachment = await createProductionSkillAttachment(skill!);
    const kernel = new FlovartAgentKernel({
      databasePath: join(directory, 'agent-sessions.db'),
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple,
    });

    await kernel.openSession({ projectId: 'project-skill', cwd: directory });
    try {
      await expect(kernel.send('制作 VOX 视频', [], {
        ...attachment,
        contentHash: `sha256:${'0'.repeat(64)}`,
      })).rejects.toThrow(/contentHash|内容哈希/);
      expect(faux.state.callCount).toBe(0);
    } finally {
      await kernel.close();
    }
  });

  it('groups every tool call of one turn under a shared changeSetId', async () => {
    const directory = await temporaryDirectory();
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    const faux = fauxProvider({ tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('flovart_workflow_node_create', {
        type: 'text',
        title: '节点一',
        idempotencyKey: 'turn-create-v1',
      }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('flovart_workflow_node_update', {
        nodeId: 'node-1',
        patch: { title: '节点一改' },
        idempotencyKey: 'turn-update-v1',
      }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('节点已创建并更新。'),
    ]);
    const kernel = new FlovartAgentKernel({
      databasePath: join(directory, 'agent-sessions.db'),
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple,
      tools: createFlovartAgentTools(async (command, args) => {
        calls.push({ command, args });
        return { ok: true, node: { id: 'node-1', title: '节点一' } };
      }),
    });

    await kernel.openSession({ projectId: 'project-turn', cwd: directory });
    await kernel.send('创建并更新一个节点');

    expect(calls).toHaveLength(2);
    expect(calls[0].args.changeSetId).toBeTypeOf('string');
    expect(calls[1].args.changeSetId).toBe(calls[0].args.changeSetId);
    await kernel.close();
  });

  it('binds a verified Production Skill to the PI context and restores it with the main session', async () => {
    const directory = await temporaryDirectory();
    const databasePath = join(directory, 'agent-sessions.db');
    const prompts: string[] = [];
    const faux = fauxProvider({ tokensPerSecond: 0 });
    faux.setResponses([context => {
      prompts.push(context.systemPrompt);
      return fauxAssistantMessage('先提交节拍和样图候选，等待确认。');
    }]);
    const skill = getBundledProductionSkill('community.vox-director');
    const attachment = await createProductionSkillAttachment(skill!);
    const first = new FlovartAgentKernel({
      databasePath,
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple,
    });

    await first.openSession({ projectId: 'project-skill', cwd: directory });
    const bound = await first.send('制作 VOX 视频', [], attachment);
    expect(bound.boundProductionSkill).toMatchObject(attachment);
    expect(prompts[0]).toContain('Generate and approve the collage keyframe first');
    await first.close();

    const reopened = new FlovartAgentKernel({
      databasePath,
      model: faux.getModel(),
      streamFn: faux.provider.streamSimple,
    });
    const restored = await reopened.openSession({ projectId: 'project-skill', cwd: directory });
    expect(restored.boundProductionSkill).toMatchObject(attachment);
    await reopened.close();
  });

  it('persists an explicit Production Skill removal instead of silently reusing the old binding', async () => {
    const directory = await temporaryDirectory();
    const databasePath = join(directory, 'agent-sessions.db');
    const faux = fauxProvider({ tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage('已按 VOX Skill 规划。'),
      fauxAssistantMessage('已切回通用制作。'),
    ]);
    const attachment = await createProductionSkillAttachment(getBundledProductionSkill('community.vox-director')!);
    const first = new FlovartAgentKernel({ databasePath, model: faux.getModel(), streamFn: faux.provider.streamSimple });

    await first.openSession({ projectId: 'project-unbind-skill', cwd: directory });
    expect((await first.send('使用 VOX', [], attachment)).boundProductionSkill).toMatchObject(attachment);
    expect((await first.send('移除 VOX', [], null)).boundProductionSkill).toBeUndefined();
    await first.close();

    const reopened = new FlovartAgentKernel({ databasePath, model: faux.getModel(), streamFn: faux.provider.streamSimple });
    expect((await reopened.openSession({ projectId: 'project-unbind-skill', cwd: directory })).boundProductionSkill).toBeUndefined();
    await reopened.close();
  });
});
