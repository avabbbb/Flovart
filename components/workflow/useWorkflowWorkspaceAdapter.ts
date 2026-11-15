import { useEffect, useRef } from 'react';
import { getBrowserWorkflowBinding, subscribeBrowserWorkflowBinding } from '../../services/browserWorkflowBinding';
import { bootstrapLocalAgentConnection } from '../../services/agentConnectionBootstrap';
import { isDshEmbed, requestDshRebootstrap } from '../../services/dshEmbedBridge';
import { WorkflowWorkspaceAdapter } from '../../services/workflowWorkspaceAdapter';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import type { WorkflowProject } from './types';

const EMPTY_WORKFLOW_SNAPSHOT = {
  id: null,
  title: 'Workflow',
  nodes: [],
  connections: [],
  selectedNodeIds: [],
};

type WorkspaceAdapter = Pick<WorkflowWorkspaceAdapter, 'start' | 'update' | 'stop'>;
// In the DSH embed an expired / reset credential is recovered by asking the
// host for a fresh one-time token instead of ending on "credential expired".
const createWorkspaceAdapter = (): WorkspaceAdapter => new WorkflowWorkspaceAdapter({
  onCredentialRejected: () => requestDshRebootstrap(),
});

/**
 * Reconnect = refresh the credential where one can be refreshed, then restart
 * the adapter. Re-running bootstrap matters: when the Agent was not up at page
 * load the binding was never created, so restarting the adapter alone would
 * only rediscover "nothing configured".
 */
async function reconnect(restart: () => void) {
  if (isDshEmbed() && requestDshRebootstrap()) {
    useAgentConnectionStore.getState().setStatus('connecting', { error: null });
    return;
  }
  const before = getBrowserWorkflowBinding();
  await bootstrapLocalAgentConnection({ force: true }).catch(() => undefined);
  // A changed binding already restarted the adapter through its subscription.
  if (getBrowserWorkflowBinding() === before) restart();
}

export function useWorkflowWorkspaceAdapter(
  project: WorkflowProject | null,
  createAdapter: () => WorkspaceAdapter = createWorkspaceAdapter,
) {
  const adapter = useRef<WorkspaceAdapter | null>(null);
  const snapshot = project || EMPTY_WORKFLOW_SNAPSHOT;
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;

  useEffect(() => {
    const current = createAdapter();
    adapter.current = current;
    const start = () => current.start(latestSnapshot.current).catch(error => {
      console.warn('Managed Agent auto-connect unavailable.', error);
    });
    const restart = () => {
      current.stop();
      void start();
    };
    void start();
    const unsubscribe = subscribeBrowserWorkflowBinding(restart);
    let nonce = useAgentConnectionStore.getState().reconnectNonce;
    const unsubscribeReconnect = useAgentConnectionStore.subscribe(state => {
      if (state.reconnectNonce === nonce) return;
      nonce = state.reconnectNonce;
      void reconnect(restart);
    });
    return () => {
      unsubscribe();
      unsubscribeReconnect();
      current.stop();
      if (adapter.current === current) adapter.current = null;
    };
  }, []);

  useEffect(() => {
    adapter.current?.update(snapshot);
  }, [snapshot]);
}
