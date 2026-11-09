// @vitest-environment node

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceProxyHandler, resolveWorkspaceProxyPath } from '../dsh-plugin/src/workspaceProxy';
import { loopbackOrigin } from '../dsh-plugin/src/workspaceTarget';

const servers: http.Server[] = [];

async function listen(server: http.Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not expose a TCP port');
  return address.port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('DeepSeek Harness Workspace proxy', () => {
  it('forwards only the contextual workspace surface and keeps the token host-side', async () => {
    let observed: { url?: string; token?: string; body?: string } = {};
    const workspacePort = await listen(http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        observed = {
          url: request.url,
          token: String(request.headers['x-flovart-agent-token'] || ''),
          body: Buffer.concat(chunks).toString('utf8'),
        };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, result: { ok: true } }));
      });
    }));
    const handler = createWorkspaceProxyHandler({
      workspaceUrl: `http://127.0.0.1:${workspacePort}`,
      workspaceToken: 'host-secret',
    });
    const proxyPort = await listen(http.createServer(handler));

    const response = await fetch(`http://127.0.0.1:${proxyPort}/flovart-workspace/api/tools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'workflow.project.list' }),
    });

    expect(response.status).toBe(200);
    expect(observed).toEqual({
      url: '/api/tools',
      token: 'host-secret',
      body: JSON.stringify({ command: 'workflow.project.list' }),
    });
  });

  it('rejects unrelated paths and non-loopback workspace targets', () => {
    expect(resolveWorkspaceProxyPath('/flovart-workspace/health', 'GET')).toBe('/health');
    expect(resolveWorkspaceProxyPath('/flovart-workspace/api/tools', 'POST')).toBe('/api/tools');
    expect(resolveWorkspaceProxyPath('/flovart-workspace/api/tools', 'GET')).toBeNull();
    expect(resolveWorkspaceProxyPath('/flovart-workspace/director/handoff', 'POST')).toBeNull();
    expect(resolveWorkspaceProxyPath('/flovart-workspace/agent/flovart/turn', 'POST')).toBeNull();
    expect(resolveWorkspaceProxyPath('/other/health', 'GET')).toBeNull();
    expect(loopbackOrigin("http://127.0.0.1:17372")?.hostname).toBe('127.0.0.1');
    expect(loopbackOrigin("https://example.com")).toBeNull();
    expect(loopbackOrigin("http://127.0.0.1:17372@127.0.0.2")).toBeNull();
  });
});
