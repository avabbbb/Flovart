import { afterEach, describe, expect, it } from 'vitest';
import {
  clearCreativeHostResources,
  creativeHostResourceCount,
  loadCreativeHostResource,
  registerCreativeHostResource,
} from '../services/studio/hostResourceRegistry';

afterEach(() => clearCreativeHostResources());

const materialized = (blob: Blob) => ({
  selection: {
    host: 'photoshop' as const,
    selectionId: 'layer-1',
    label: 'Hero',
    kind: 'image' as const,
    locator: { documentId: 'doc-1', layerId: 1 },
  },
  resource: {
    resourceId: 'creative-host:photoshop:layer-1',
    title: 'Hero',
    kind: 'image' as const,
    locator: { kind: 'creative-host' as const, host: 'photoshop', locator: { documentId: 'doc-1', layerId: 1 } },
  },
  reference: {
    id: 'reference-1',
    resourceId: 'creative-host:photoshop:layer-1',
    resourceOrigin: 'creative-host' as const,
    sourceId: 'layer-1',
    kind: 'image' as const,
    source: 'manual' as const,
  },
  blob,
});

describe('Studio host resource registry', () => {
  it('keeps materialized host bytes outside the Workflow document and resolves them by locator', async () => {
    const blob = new Blob(['layer'], { type: 'image/png' });
    registerCreativeHostResource(materialized(blob));

    expect(creativeHostResourceCount()).toBe(1);
    await expect(loadCreativeHostResource({ kind: 'creative-host', host: 'photoshop', locator: { layerId: 1, documentId: 'doc-1' } })).resolves.toBe(blob);
  });

  it('expires resources and rejects locator-only handoffs', async () => {
    const blob = new Blob(['layer'], { type: 'image/png' });
    expect(() => registerCreativeHostResource(materialized(blob), 100)).not.toThrow();
    await expect(loadCreativeHostResource({ kind: 'creative-host', host: 'photoshop', locator: { documentId: 'doc-1', layerId: 1 } }, 100 + 30 * 60 * 1000)).resolves.toBeNull();
    expect(() => registerCreativeHostResource({ ...materialized(blob), blob: undefined })).toThrow('可执行');
  });
});
