import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkflowResource } from '../services/workflowResourceResolver';
import { getActiveBlobUrls, resetBlobUrls } from './setup';

afterEach(() => resetBlobUrls());

describe('workflow executable resource resolver', () => {
  it('passes a direct URL through without reading canvas state', async () => {
    const resolved = await resolveWorkflowResource({
      resourceId: 'image-a:output:0',
      kind: 'image',
      title: '图片',
      locator: { kind: 'remote-url', href: 'https://cdn.example.com/image.png' },
    }, {}, []);

    expect(resolved).toEqual({
      resourceId: 'image-a:output:0',
      kind: 'image',
      mimeType: undefined,
      executable: { kind: 'remote-url', href: 'https://cdn.example.com/image.png' },
    });
  });

  it('materializes workflow storage through the injected media loader', async () => {
    const cleanup: string[] = [];
    const resolved = await resolveWorkflowResource({
      resourceId: 'image-b:output:0',
      kind: 'image',
      title: '本地图片',
      locator: { kind: 'workflow-storage', storageKey: 'workflow-image-b' },
      mimeType: 'image/png',
    }, { loadMedia: async key => key === 'workflow-image-b' ? new Blob(['image'], { type: 'image/png' }) : null }, cleanup);

    expect(resolved).toMatchObject({
      resourceId: 'image-b:output:0',
      kind: 'image',
      mimeType: 'image/png',
      executable: { kind: 'blob-url', source: 'workflow-storage' },
    });
    expect(cleanup).toHaveLength(1);
    expect(getActiveBlobUrls().size).toBe(1);
    cleanup.splice(0).forEach(url => URL.revokeObjectURL(url));
    expect(getActiveBlobUrls().size).toBe(0);
  });

  it('preserves a runtime artifact locator when desktop hydration is unavailable but allowed', async () => {
    const resolved = await resolveWorkflowResource({
      resourceId: 'image-c:output:0',
      kind: 'image',
      title: '运行时图片',
      locator: {
        kind: 'runtime-artifact',
        artifactRef: { taskId: 'task-c', artifactId: 'artifact-c', outputIndex: 2, kind: 'image', mimeType: 'image/png' },
      },
      mimeType: 'image/png',
    }, {}, [], { allowArtifactReference: true });

    expect(resolved).toEqual({
      resourceId: 'image-c:output:0',
      kind: 'image',
      mimeType: 'image/png',
      executable: { kind: 'runtime-artifact', taskId: 'task-c', artifactId: 'artifact-c', outputIndex: 2 },
    });
  });

  it('returns no executable resource for a declared missing locator', async () => {
    const resolved = await resolveWorkflowResource({
      resourceId: 'image-empty:output:0',
      kind: 'image',
      title: '空图片',
      locator: { kind: 'missing', reason: '节点没有可用媒体' },
    }, {}, []);

    expect(resolved).toBeNull();
  });

  it('materializes a creative-host locator through the injected host adapter', async () => {
    const cleanup: string[] = [];
    const loadCreativeHostResource = async (locator: { kind: 'creative-host'; host: string; locator: Record<string, string | number> }) => {
      expect(locator).toEqual({ kind: 'creative-host', host: 'photoshop', locator: { documentId: 'doc-1', layerId: 7 } });
      return new Blob(['layer'], { type: 'image/png' });
    };
    const resolved = await resolveWorkflowResource({
      resourceId: 'creative-host:photoshop:layer-7',
      kind: 'image',
      title: 'Hero Layer',
      locator: { kind: 'creative-host', host: 'photoshop', locator: { documentId: 'doc-1', layerId: 7 } },
      mimeType: 'image/png',
    }, { loadCreativeHostResource }, cleanup);

    expect(resolved).toMatchObject({ executable: { kind: 'blob-url', source: 'creative-host' } });
    expect(cleanup).toHaveLength(1);
    cleanup.splice(0).forEach(url => URL.revokeObjectURL(url));
  });
});
