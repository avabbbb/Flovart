// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWorkspaceFacade,
  FlovartWorkspaceClient,
  WorkspaceClientError,
  workspaceConfigMissingMessage,
} from '../tools/flovart/workspace-client.js';

const config = {
  url: 'http://127.0.0.1:17372',
  token: 'local-control-token',
};
const cleanup: Array<() => Promise<void>> = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()));
});

describe('Flovart Workspace Adapter client', () => {
  it('rejects non-loopback adapter URLs', () => {
    expect(() => new FlovartWorkspaceClient({
      config: { ...config, url: 'https://example.com' },
      fetch: vi.fn(),
    })).toThrow('loopback');
  });

  it('gives WSL-specific setup guidance without changing the loopback security boundary', () => {
    expect(workspaceConfigMissingMessage('linux', { WSL_DISTRO_NAME: 'Ubuntu' })).toContain('mirrored networking');
    expect(workspaceConfigMissingMessage('darwin', {})).not.toContain('WSL');
  });

  it('reports whether a visible Workflow snapshot is connected', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      hasWorkflow: true,
      clients: 1,
      pending: 0,
      activeProjectId: 'project-1',
      snapshotUpdatedAt: '2026-07-24T00:00:00.000Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new FlovartWorkspaceClient({ config, fetch });

    await expect(client.status()).resolves.toMatchObject({
      authority: 'browser-workspace',
      state: 'ready',
      activeProjectId: 'project-1',
    });
  });

  it('forwards one typed command envelope with its idempotency key', async () => {
    const fetch = vi.fn(async (_input, init) => new Response(JSON.stringify({
      ok: true,
      result: { ok: true, commandId: 'command-1', result: { nodeId: 'node-1' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new FlovartWorkspaceClient({ config, fetch });
    const facade = createWorkspaceFacade(client);

    await expect(facade.workflow.dispatch({
      id: 'command-1',
      command: 'workflow.node.create',
      args: { id: 'node-1', type: 'text' },
      source: 'cli',
      idempotencyKey: 'create-node-1',
    })).resolves.toMatchObject({ ok: true });

    const [, init] = fetch.mock.calls[0];
    expect(init?.headers).toMatchObject({ 'x-flovart-agent-token': config.token });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      command: 'workflow.node.create',
      source: 'cli',
      idempotencyKey: 'create-node-1',
    });
  });

  it('returns a stable unavailable error instead of falling back to shadow state', async () => {
    const client = new FlovartWorkspaceClient({
      config,
      fetch: vi.fn(async () => {
        throw new Error('offline');
      }),
    });

    await expect(client.status()).rejects.toMatchObject({
      code: 'WORKSPACE_UNAVAILABLE',
      retryable: true,
    } satisfies Partial<WorkspaceClientError>);
  });

  it('routes CLI node mutations to the connected Workspace Adapter', async () => {
    const received: unknown[] = [];
    const server: Server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
        received.push(body);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          ok: true,
          result: {
            ok: true,
            commandId: 'command-1',
            result: { projectId: 'project-1', nodeId: 'node-1' },
          },
        }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    const directory = await mkdtemp(join(tmpdir(), 'flovart-workspace-cli-'));
    const configPath = join(directory, 'agent.json');
    await writeFile(configPath, JSON.stringify({
      url: `http://127.0.0.1:${address.port}`,
      token: config.token,
    }));
    cleanup.push(async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    });

    const { stdout } = await execFileAsync(process.execPath, [
      join(process.cwd(), 'tools', 'flovart', 'cli.js'),
      'workflow.node.create',
      '--id',
      'node-1',
      '--type',
      'text',
      '--title',
      '可见节点',
      '--metadata-json',
      '{"content":"需要细修的镜头"}',
      '--idempotency-key',
      'create-node-1',
      '--json',
    ], {
      env: { ...process.env, FLOVART_AGENT_CONFIG: configPath },
      windowsHide: true,
    });
    const output = JSON.parse(stdout);

    expect(output).toMatchObject({
      ok: true,
      command: 'workflow.node.create',
      runtime: 'workspace-adapter',
      data: { result: { projectId: 'project-1', nodeId: 'node-1' } },
    });
    expect(received[0]).toMatchObject({
      command: 'workflow.node.create',
      source: 'cli',
      idempotencyKey: 'create-node-1',
      args: {
        id: 'node-1',
        type: 'text',
        title: '可见节点',
        metadata: { content: '需要细修的镜头' },
      },
    });
  });
});
