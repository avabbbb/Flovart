import { useEffect, useRef } from 'react';
import { WorkflowWorkspaceAdapter } from '../../services/workflowWorkspaceAdapter';
import type { WorkflowProject } from './types';

const EMPTY_WORKFLOW_SNAPSHOT = {
  id: null,
  title: 'Workflow',
  nodes: [],
  connections: [],
  selectedNodeIds: [],
};

type WorkspaceAdapter = Pick<WorkflowWorkspaceAdapter, 'start' | 'update' | 'stop'>;
const createWorkspaceAdapter = (): WorkspaceAdapter => new WorkflowWorkspaceAdapter();

export function useWorkflowWorkspaceAdapter(
  project: WorkflowProject | null,
  createAdapter: () => WorkspaceAdapter = createWorkspaceAdapter,
) {
  const adapter = useRef<WorkspaceAdapter | null>(null);
  const snapshot = project || EMPTY_WORKFLOW_SNAPSHOT;

  useEffect(() => {
    const current = createAdapter();
    adapter.current = current;
    void current.start(snapshot).catch(error => {
      console.warn('Managed Agent auto-connect unavailable.', error);
    });
    return () => {
      current.stop();
      if (adapter.current === current) adapter.current = null;
    };
  }, []);

  useEffect(() => {
    adapter.current?.update(snapshot);
  }, [snapshot]);
}
