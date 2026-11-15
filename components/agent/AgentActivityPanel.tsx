import { useEffect } from 'react';
import { AgentReceiptsSection } from './AgentReceiptsSection';
import { AgentPipelineRunsSection } from './AgentPipelineRunsSection';
import { AgentLinkStatus } from './AgentLinkStatus';
import { AgentRunLog } from './AgentRunLog';
import { getManagedAgentConnection } from '../../services/managedAgentConnection';
import { hydrateAgentActivity } from '../../services/agentActivity';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import '../../styles/agentLink.css';

type Lang = 'en' | 'zho';

/**
 * Drawer pages "连接状态" (status) and "运行日志" (log). The status page owns the
 * classified link state and the Reconnect action; the log page merges link
 * transitions with every agent step, then the pipeline runs and receipts.
 */
export function AgentActivityPanel({ language = 'zho', view = 'all' }: { language?: Lang; view?: 'all' | 'status' | 'log' }) {
  const status = useAgentConnectionStore(state => state.status);

  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    void (async () => {
      try {
        const connection = await getManagedAgentConnection();
        if (connection && !cancelled) await hydrateAgentActivity(connection);
      } catch {
        // The status page already shows the classified link problem.
      }
    })();
    return () => { cancelled = true; };
  }, [status]);

  return (
    <div className={`agent-activity agent-activity--${view}`} data-testid="agent-activity-panel">
      {view !== 'log' && <AgentLinkStatus language={language} />}
      {view !== 'status' && <AgentRunLog language={language} />}
      {view !== 'status' && <div className="agent-activity__section"><AgentPipelineRunsSection language={language} /></div>}
      {view !== 'status' && <div className="agent-activity__section"><AgentReceiptsSection language={language} /></div>}
    </div>
  );
}
