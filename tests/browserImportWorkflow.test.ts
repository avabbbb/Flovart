import { describe, expect, it, vi } from 'vitest';
import { createWorkflowProject } from '../components/workflow/store';
import {
  browserImportHref,
  createBrowserImportWorkflowMutation,
  projectBrowserImportToWorkflow,
  type BrowserImportReceipt,
} from '../services/browserImports';

const receipt: BrowserImportReceipt = {
  importId: 'browser-import-1',
  artifactId: `sha256:${'a'.repeat(64)}`,
  contentHash: 'a'.repeat(64),
  kind: 'image',
  name: 'reference.png',
  mimeType: 'image/png',
  byteSize: 2048,
  sourceUrl: 'https://cdn.example.com/reference.png',
  sourcePageUrl: 'https://example.com/article',
  sourceTitle: 'Example article',
  naturalWidth: 1280,
  naturalHeight: 720,
  status: 'pending',
  destinationProjectId: 'workflow-1',
  nodeId: null,
  createdAt: 1,
  consumedAt: null,
};

describe('Browser Import Workflow projection', () => {
  it('builds an existing image node with an Artifact reference and complete web provenance', () => {
    const project = {
      ...createWorkflowProject('Browser Import'),
      id: 'workflow-1',
      viewport: { x: -80, y: -40, k: 2 },
    };
    const mutation = createBrowserImportWorkflowMutation(receipt, project);

    expect(mutation.nodeId).toBe('node-browser-import-1');
    expect(mutation.envelope).toMatchObject({
      command: 'workflow.node.create',
      source: 'ui',
      idempotencyKey: 'browser-import:browser-import-1',
      args: {
        projectId: 'workflow-1',
        id: 'node-browser-import-1',
        type: 'image',
        title: 'reference.png',
        x: 130,
        y: 90,
        width: 420,
        height: 236,
        metadata: {
          href: browserImportHref('browser-import-1'),
          mimeType: 'image/png',
          naturalWidth: 1280,
          naturalHeight: 720,
          browserImport: {
            importId: 'browser-import-1',
            artifactId: receipt.artifactId,
            contentHash: receipt.contentHash,
            sourceUrl: receipt.sourceUrl,
            sourcePageUrl: receipt.sourcePageUrl,
            sourceTitle: receipt.sourceTitle,
          },
        },
      },
    });
  });

  it('commits through the public Workflow dispatcher and records a durable receipt', async () => {
    const project = { ...createWorkflowProject('Browser Import'), id: 'workflow-1' };
    const dispatch = vi.fn().mockResolvedValue({ ok: true, commandId: 'command-1' });
    const markConsumed = vi.fn().mockResolvedValue({ ...receipt, status: 'consumed' });

    await expect(projectBrowserImportToWorkflow(receipt, project, { dispatch, markConsumed }))
      .resolves.toEqual({ nodeId: 'node-browser-import-1', alreadyProjected: false });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(markConsumed).toHaveBeenCalledWith('browser-import-1', 'workflow-1', 'node-browser-import-1');
  });

  it('is idempotent after the node exists and only repairs the Desktop receipt', async () => {
    const project = {
      ...createWorkflowProject('Browser Import'),
      id: 'workflow-1',
      nodes: [{
        id: 'existing-node',
        type: 'image' as const,
        title: 'reference.png',
        position: { x: 0, y: 0 },
        width: 420,
        height: 236,
        metadata: { browserImport: { importId: 'browser-import-1', artifactId: receipt.artifactId, contentHash: receipt.contentHash } },
      }],
    };
    const dispatch = vi.fn();
    const markConsumed = vi.fn().mockResolvedValue({ ...receipt, status: 'consumed' });

    await expect(projectBrowserImportToWorkflow(receipt, project, { dispatch, markConsumed }))
      .resolves.toEqual({ nodeId: 'existing-node', alreadyProjected: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(markConsumed).toHaveBeenCalledWith('browser-import-1', 'workflow-1', 'existing-node');
  });
});
