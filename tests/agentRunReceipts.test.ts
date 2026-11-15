import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendRunArtifactReceipts, ReceiptStore, runArtifactReceipts } from '../agent/receipts.js';
import { WorkflowAgentSession } from '../agent/session.js';

/**
 * 回归：评测中 node.run 成功后 receipts.list 仍是空的。
 * 根因：只有显式 POST /receipts 或 batch.pick 才写回执，node.run 成功路径从不写。
 */
const ORIGIN = 'http' + '://127.0.0.1:5173';
const dirs: string[] = [];
const makeStore = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flovart-run-receipts-'));
  dirs.push(root);
  return new ReceiptStore({ dirFor: (projectId: string) => {
    const dir = path.join(root, projectId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } });
};
afterEach(() => { dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })); });

const connect = (session: WorkflowAgentSession) => {
  let events = '';
  const response = { writeHead() {}, write(value: string) { events += value; }, on() {} };
  session.openEvents(new URL(ORIGIN + '/events?clientId=browser-1'), response as never);
  session.updateSnapshot({ id: 'project-1' } as never, 'browser-1');
  return () => [...events.matchAll(/event: tool_call\ndata: (.+)\n\n/g)].map(match => JSON.parse(match[1]));
};

describe('auto artifact receipt after node.run', () => {
  it('builds one artifact receipt per successful run with a runId', () => {
    expect(runArtifactReceipts({ ok: true, result: { projectId: 'p1', nodeId: 'n1', runId: 'run_1', artifact: { artifactId: 'run_1', kind: 'image', mimeType: 'image/png' } } }))
      .toEqual([expect.objectContaining({ projectId: 'p1', kind: 'artifact', externalRef: 'run:run_1', nodeIds: ['n1'] })]);
    expect(runArtifactReceipts({ ok: true, result: { projectId: 'p1', runs: [
      { nodeId: 'a', ok: true, runId: 'run_a' }, { nodeId: 'b', ok: false, error: { code: 'RUN_FAILED' } },
    ] } }).map(item => item.externalRef)).toEqual(['run:run_a']);
    expect(runArtifactReceipts({ ok: false })).toEqual([]);
    expect(runArtifactReceipts({ ok: true, confirmation: { required: true } })).toEqual([]);
  });

  it('writes the receipt after a successful node.run and dedupes by runId', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000, webUrl: () => ORIGIN });
    const store = makeStore();
    (session as unknown as { receiptStore: ReceiptStore }).receiptStore = store;
    const calls = connect(session);
    const browserResult = { ok: true, result: { projectId: 'project-1', nodeId: 'node-1', runId: 'run_same', artifact: { artifactId: 'run_same', kind: 'image', mimeType: 'image/png' } } };

    const first = session.callCommand('workflow.node.run', { projectId: 'project-1', nodeId: 'node-1' }, 'cli', 'idem-1', undefined, { agentIdentity: 'codex' });
    session.resolveResult({ requestId: calls().at(-1).requestId, clientId: 'browser-1', result: browserResult, error: undefined });
    await expect(first).resolves.toMatchObject({ ok: true });

    // 幂等键重放拿到同一个 runId：不再追加回执。
    const replay = session.callCommand('workflow.node.run', { projectId: 'project-1', nodeId: 'node-1' }, 'cli', 'idem-1', undefined, { agentIdentity: 'codex' });
    const pending = calls();
    if (pending.length > 1) session.resolveResult({ requestId: pending.at(-1).requestId, clientId: 'browser-1', result: browserResult, error: undefined });
    await replay;

    // 另一个调用方上报同一个 runId 也不重复（去重键只看 runId）。
    await appendRunArtifactReceipts(store, browserResult, {}, { agentIdentity: 'claude' });

    const receipts = await store.list('project-1');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ kind: 'artifact', externalRef: 'run:run_same', nodeIds: ['node-1'], agentIdentity: 'codex' });
  });

  it('does not write a receipt when node.run fails', async () => {
    const session = new WorkflowAgentSession({ timeoutMs: 1000, webUrl: () => ORIGIN });
    const store = makeStore();
    (session as unknown as { receiptStore: ReceiptStore }).receiptStore = store;
    const calls = connect(session);
    const call = session.callCommand('workflow.node.run', { projectId: 'project-1', nodeId: 'node-1' }, 'cli', 'idem-2', undefined, {});
    session.resolveResult({ requestId: calls().at(-1).requestId, clientId: 'browser-1', result: { ok: false, error: { code: 'RUN_FAILED', message: 'x' } }, error: undefined });
    await call;
    expect(await store.list('project-1')).toEqual([]);
  });
});
