import { useEffect, useRef } from 'react';
import { getFlovartRuntimeApi } from '../../services/flovartRuntime';
import { ProductionProjectionAdapter } from '../../services/productionProjectionAdapter';
import { useWorkflowStore } from './store';

const PROJECTION_SYNC_INTERVAL_MS = 1_500;

export function useProductionProjectionAdapter(projectId: string | null) {
  const adapter = useRef<ProductionProjectionAdapter | null>(null);
  if (!adapter.current) {
    adapter.current = new ProductionProjectionAdapter({
      runtime: getFlovartRuntimeApi(),
      getProject: id => (
        useWorkflowStore.getState().projects.find(project => project.id === id) || null
      ),
      updateProject: (id, patch) => useWorkflowStore.getState().updateProject(id, patch),
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
