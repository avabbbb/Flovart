import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { FlovartAgentKernel } from '../agent/kernel.js';

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
});
