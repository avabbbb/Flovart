import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import {
  parseWorkflowProjectFile,
  serializeWorkflowProjects,
  WORKFLOW_EXPORT_APP,
  WORKFLOW_EXPORT_VERSION,
} from '../components/workflow/projectTransfer';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { WorkflowProject } from '../components/workflow/types';

const project = (): WorkflowProject => ({
  id: 'project-1',
  title: '广告镜头',
  nodes: [createWorkflowNode('image-1', 'image', { x: 10, y: 20 }, {
    storageKey: 'local-image',
    name: 'reference.png',
    mimeType: 'image/png',
    bytes: 5,
  })],
  connections: [],
  selectedNodeIds: ['image-1'],
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots',
  agentSessions: [],
  activeAgentSessionId: null,
  createdAt: '2026-06-19T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z',
});

describe('workflow project transfer', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await workflowMediaStorage.clear();
  });

  it('embeds durable media and removes machine-local storage keys', async () => {
    await workflowMediaStorage.set('local-image', new Blob(['image'], { type: 'image/png' }));

    const exported = await serializeWorkflowProjects([project()]);

    expect(exported).toMatchObject({ app: WORKFLOW_EXPORT_APP, version: WORKFLOW_EXPORT_VERSION });
    expect(exported.projects[0].assets[0]).toMatchObject({ nodeId: 'image-1', mimeType: 'image/png', name: 'reference.png' });
    expect(exported.projects[0].assets[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(exported.projects[0].project)).not.toContain('local-image');
    expect(exported.projects[0].project.selectedNodeIds).toEqual([]);
  });

  it('restores embedded media under a fresh durable key', async () => {
    await workflowMediaStorage.set('local-image', new Blob(['image'], { type: 'image/png' }));
    const exported = await serializeWorkflowProjects([project()]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['restored'], { type: 'image/png' }) })));
    const file = new File([JSON.stringify(exported)], 'workflow.json', { type: 'application/json' });

    const [imported] = await parseWorkflowProjectFile(file);

    expect(imported.id).not.toBe('project-1');
    expect(imported.title).toBe('广告镜头（导入）');
    expect(imported.nodes[0].metadata.storageKey).toMatch(/^workflow-media-/);
    expect(imported.nodes[0].metadata.storageKey).not.toBe('local-image');
    expect(await workflowMediaStorage.get(imported.nodes[0].metadata.storageKey!)).toBeInstanceOf(Blob);
  });

  it('rejects invalid graphs before writing any media', async () => {
    const invalid = {
      app: WORKFLOW_EXPORT_APP,
      version: WORKFLOW_EXPORT_VERSION,
      exportedAt: '2026-06-19T00:00:00.000Z',
      projects: [{ project: { ...project(), connections: [{ id: 'bad', fromNodeId: 'missing', toNodeId: 'image-1' }] }, assets: [] }],
    };

    await expect(parseWorkflowProjectFile(new File([JSON.stringify(invalid)], 'bad.json'))).rejects.toThrow('包含无效连线');
    expect(await workflowMediaStorage.keys()).toEqual([]);
  });

  it('fails instead of exporting a missing or temporary local media source', async () => {
    await expect(serializeWorkflowProjects([project()])).rejects.toThrow('本地媒体不存在');
    const temporary = project();
    temporary.nodes[0].metadata = { href: 'blob:current-tab-only', mimeType: 'image/png' };
    await expect(serializeWorkflowProjects([temporary])).rejects.toThrow('临时媒体地址');
  });

  it('rolls back already restored blobs when a later media write fails', async () => {
    const source = project();
    source.nodes.push(createWorkflowNode('image-2', 'image', { x: 400, y: 20 }, { mimeType: 'image/png' }));
    const exported = {
      app: WORKFLOW_EXPORT_APP,
      version: WORKFLOW_EXPORT_VERSION,
      exportedAt: '2026-06-19T00:00:00.000Z',
      projects: [{ project: { ...source, nodes: source.nodes.map(node => ({ ...node, metadata: { ...node.metadata, storageKey: undefined } })) }, assets: source.nodes.map(node => ({ nodeId: node.id, dataUrl: 'data:image/png;base64,aW1hZ2U=', mimeType: 'image/png' })) }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['restored'], { type: 'image/png' }) })));
    const set = vi.spyOn(workflowMediaStorage, 'set');
    set.mockResolvedValueOnce().mockRejectedValueOnce(new Error('storage full'));

    await expect(parseWorkflowProjectFile(new File([JSON.stringify(exported)], 'workflow.json'))).rejects.toThrow('storage full');
    expect(await workflowMediaStorage.keys()).toEqual([]);
  });
});
