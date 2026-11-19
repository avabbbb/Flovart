import { useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { getIrisRuntimeApi } from '../../services/irisRuntime';
import { ProductionProjectionAdapter } from '../../services/productionProjectionAdapter';
import { applyWorkflowMutation, workflowDocumentOperationsFromFrames } from './draftAuthority';
import { useWorkflowStore } from './store';

const PROJECTION_SYNC_INTERVAL_MS = 1_500;

export function useProductionProjectionAdapter(projectId: string | null) {
  const adapter = useRef<ProductionProjectionAdapter | null>(null);
  if (!adapter.current) {
    adapter.current = new ProductionProjectionAdapter({
      runtime: getIrisRuntimeApi(),
      getProject: id => (
        useWorkflowStore.getState().projects.find(project => project.id === id) || null
      ),
      updateProject: (id, patch) => {
        const state = useWorkflowStore.getState();
        const project = state.projects.find(item => item.id === id);
        if (!project) return;
        const ops = workflowDocumentOperationsFromFrames(
          { nodes: project.nodes, connections: project.connections },
          { nodes: patch.nodes, connections: patch.connections },
        );
        if (!ops.length) {
          state.updateProject(id, { selectedNodeIds: patch.selectedNodeIds });
          return;
        }
        const recorded = applyWorkflowMutation(project, {
          projectId: id,
          expectedRevision: project.draftVersion || 1,
          mutationId: nanoid(),
          source: 'dsh',
          intent: '同步 Production Runtime 画布投影',
          ops,
        });
        if (recorded.ok === false) {
          console.warn('Production Projection mutation 被拒绝。', recorded.error);
          return;
        }
        state.updateProject(id, {
          nodes: recorded.project.nodes,
          connections: recorded.project.connections,
          selectedNodeIds: patch.selectedNodeIds,
          draftVersion: recorded.project.draftVersion,
          draftChangeSets: recorded.project.draftChangeSets,
          draftRedoStack: recorded.project.draftRedoStack,
          workflowMutationReceipts: recorded.project.workflowMutationReceipts,
        });
      },
    });
  }

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const sync = async () => {
      try {
        await adapter.current?.sync(projectId);
      } catch (error) {
        if (active) console.warn('Production Projection 同步失败。', error);
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), PROJECTION_SYNC_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId]);
}
