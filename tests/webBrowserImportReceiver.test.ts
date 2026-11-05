// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { WorkflowProject } from '../components/workflow/types';
import {
  createWebImportReceiver,
  webBrowserImportStorageKey,
  type WebImportDependencies,
} from '../services/webBrowserImportReceiver';

async function hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await new Blob([bytes]).arrayBuffer()));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function setup(activeProject: WorkflowProject | null) {
  const stored = new Map<string, Blob>();
  const projected: string[] = [];
  const dependencies: WebImportDependencies = {
    storeBlob: async (key, blob) => {
      stored.set(key, blob);
    },
    getActiveProject: () => activeProject,
    project: async receipt => {
      projected.push(receipt.importId);
      return { nodeId: 'node-1' };
    },
  };
  return { stored, projected, receiver: createWebImportReceiver(dependencies) };
}

// 测试只用到 project.id；完整 WorkflowProject 由 store 提供。
const fakeProject: WorkflowProject = Object.assign(Object.create(null), { id: 'project-1' });
const bytes = Uint8Array.from([1, 2, 3, 4, 5]);

async function beginPayload(overrides: Record<string, unknown> = {}) {
  return { kind: 'image', name: 'a.png', mimeType: 'image/png', byteSize: bytes.length, sha256: await hex(bytes), ...overrides };
}

describe('web browser import receiver', () => {
  it('stores verified media and projects it into the active workflow', async () => {
    const { stored, projected, receiver } = setup(fakeProject);
    const { transferId } = receiver.begin({ payload: await beginPayload() });
    receiver.chunk({ transferId, sequence: 0, dataBase64: b64(bytes.subarray(0, 3)) });
    receiver.chunk({ transferId, sequence: 1, dataBase64: b64(bytes.subarray(3)) });
    const result = await receiver.commit({ transferId });
    expect(result.destinationProjectId).toBe('project-1');
    expect(result.nodeId).toBe('node-1');
    expect(projected).toEqual([result.importId]);
    const blob = stored.get(webBrowserImportStorageKey(result.importId));
    expect(blob?.size).toBe(bytes.length);
    expect(blob?.type).toBe('image/png');
  });

  it('keeps media without a node when no workflow is active', async () => {
    const { stored, projected, receiver } = setup(null);
    const { transferId } = receiver.begin({ payload: await beginPayload() });
    receiver.chunk({ transferId, sequence: 0, dataBase64: b64(bytes) });
    const result = await receiver.commit({ transferId });
    expect(result).toMatchObject({ destinationProjectId: null, nodeId: null });
    expect(projected).toEqual([]);
    expect(stored.size).toBe(1);
  });

  it('rejects out-of-order chunks', async () => {
    const { receiver } = setup(fakeProject);
    const { transferId } = receiver.begin({ payload: await beginPayload() });
    expect(() => receiver.chunk({ transferId, sequence: 1, dataBase64: b64(bytes) })).toThrow('分块序号');
  });

  it('rejects content whose hash does not match', async () => {
    const { stored, receiver } = setup(fakeProject);
    const { transferId } = receiver.begin({ payload: await beginPayload({ sha256: '0'.repeat(64) }) });
    receiver.chunk({ transferId, sequence: 0, dataBase64: b64(bytes) });
    await expect(receiver.commit({ transferId })).rejects.toThrow('校验失败');
    expect(stored.size).toBe(0);
  });

  it('rejects unsupported or mismatched media types', async () => {
    const { receiver } = setup(fakeProject);
    expect(() => receiver.begin({ payload: { kind: 'image', mimeType: 'image/svg+xml', byteSize: 5, sha256: '0'.repeat(64) } })).toThrow('不支持');
    expect(() => receiver.begin({ payload: { kind: 'image', mimeType: 'video/mp4', byteSize: 5, sha256: '0'.repeat(64) } })).toThrow('不支持');
  });
});
