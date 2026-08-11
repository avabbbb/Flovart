import { invoke, isTauri } from '@tauri-apps/api/core';
import { fitWorkflowMediaSize } from '../components/workflow/media';
import type { WorkflowProject } from '../components/workflow/types';
import {
  dispatchWorkflowCommand,
  type WorkflowCommandEnvelope,
  type WorkflowCommandResult,
} from './workflowDispatcher';
import { browserImportHref } from './browserImportArtifacts';

export { browserImportHref } from './browserImportArtifacts';

export interface BrowserImportPairing {
  extensionOrigin: string;
  status: 'pending' | 'approved' | 'rejected';
  protocolVersion: string;
  capabilities: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BrowserImportReceipt {
  importId: string;
  artifactId: string;
  contentHash: string;
  kind: 'image';
  name: string;
  mimeType: string;
  byteSize: number;
  sourceUrl?: string | null;
  sourcePageUrl?: string | null;
  sourceTitle?: string | null;
  naturalWidth?: number | null;
  naturalHeight?: number | null;
  status: 'pending' | 'consumed';
  destinationProjectId?: string | null;
  nodeId?: string | null;
  createdAt: number;
  consumedAt?: number | null;
}

function requireDesktop() {
  if (typeof window === 'undefined' || !isTauri()) {
    throw new Error('Browser Import 只在 Flovart Desktop 中可用');
  }
}

export async function listPendingBrowserImportPairings() {
  requireDesktop();
  return invoke<BrowserImportPairing[]>('browser_import_pairing_list_pending');
}

export async function approveBrowserImportPairing(extensionOrigin: string) {
  requireDesktop();
  return invoke<void>('browser_import_pairing_approve', { extensionOrigin });
}

export async function rejectBrowserImportPairing(extensionOrigin: string) {
  requireDesktop();
  return invoke<void>('browser_import_pairing_reject', { extensionOrigin });
}

export async function setBrowserImportDestination(projectId: string | null) {
  requireDesktop();
  return invoke<void>('browser_import_destination_set', { projectId });
}

export async function listPendingBrowserImports() {
  requireDesktop();
  return invoke<BrowserImportReceipt[]>('browser_import_list_pending');
}

export async function routeBrowserImportToProject(importId: string, projectId: string) {
  requireDesktop();
  return invoke<BrowserImportReceipt>('browser_import_route_to_project', { importId, projectId });
}

export async function markBrowserImportConsumed(importId: string, projectId: string, nodeId: string) {
  requireDesktop();
  return invoke<BrowserImportReceipt>('browser_import_mark_consumed', { importId, projectId, nodeId });
}

function nodeIdForImport(importId: string) {
  return `node-${importId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function createBrowserImportWorkflowMutation(
  receipt: BrowserImportReceipt,
  project: WorkflowProject,
): { nodeId: string; envelope: WorkflowCommandEnvelope } {
  if (receipt.kind !== 'image') throw new Error(`不支持的浏览器导入类型：${receipt.kind}`);
  const nodeId = nodeIdForImport(receipt.importId);
  const { width, height } = fitWorkflowMediaSize(
    'image',
    receipt.naturalWidth || undefined,
    receipt.naturalHeight || undefined,
  );
  const zoom = Math.max(project.viewport.k, 0.12);
  return {
    nodeId,
    envelope: {
      id: `command-${receipt.importId}`,
      command: 'workflow.node.create',
      source: 'ui',
      idempotencyKey: `browser-import:${receipt.importId}`,
      args: {
        projectId: project.id,
        id: nodeId,
        type: 'image',
        title: receipt.name,
        x: (180 - project.viewport.x) / zoom,
        y: (140 - project.viewport.y) / zoom,
        width,
        height,
        metadata: {
          href: browserImportHref(receipt.importId),
          name: receipt.name,
          mimeType: receipt.mimeType,
          bytes: receipt.byteSize,
          naturalWidth: receipt.naturalWidth || undefined,
          naturalHeight: receipt.naturalHeight || undefined,
          status: 'success',
          browserImport: {
            importId: receipt.importId,
            artifactId: receipt.artifactId,
            contentHash: receipt.contentHash,
            sourceUrl: receipt.sourceUrl || undefined,
            sourcePageUrl: receipt.sourcePageUrl || undefined,
            sourceTitle: receipt.sourceTitle || undefined,
          },
        },
      },
    },
  };
}

interface ProjectionDependencies {
  dispatch: (envelope: WorkflowCommandEnvelope) => Promise<WorkflowCommandResult>;
  markConsumed: typeof markBrowserImportConsumed;
}

const defaultProjectionDependencies: ProjectionDependencies = {
  dispatch: dispatchWorkflowCommand,
  markConsumed: markBrowserImportConsumed,
};

export async function projectBrowserImportToWorkflow(
  receipt: BrowserImportReceipt,
  project: WorkflowProject,
  dependencies: ProjectionDependencies = defaultProjectionDependencies,
) {
  const existing = project.nodes.find(node => node.metadata.browserImport?.importId === receipt.importId);
  if (existing) {
    await dependencies.markConsumed(receipt.importId, project.id, existing.id);
    return { nodeId: existing.id, alreadyProjected: true };
  }
  const mutation = createBrowserImportWorkflowMutation(receipt, project);
  const result = await dependencies.dispatch(mutation.envelope);
  if (!result.ok) {
    throw new Error(result.error?.message || '浏览器图片写入 Workflow 失败');
  }
  await dependencies.markConsumed(receipt.importId, project.id, mutation.nodeId);
  return { nodeId: mutation.nodeId, alreadyProjected: false };
}
