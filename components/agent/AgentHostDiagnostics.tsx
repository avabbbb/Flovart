import { Wrench } from 'lucide-react';

interface AgentHostDiagnosticsProps {
  scanning: boolean;
  diagnostic?: string;
  selectedLabel: string;
  connectionStatus: string;
  projectId: string | null;
  open?: boolean;
  language?: 'en' | 'zho';
}

export function AgentHostDiagnostics({ scanning, diagnostic, selectedLabel, connectionStatus, projectId, open = false, language = 'zho' }: AgentHostDiagnosticsProps) {
  const copy = language === 'zho'
    ? { title: '高级诊断', scanning: '正在刷新本机协作状态…', missing: '尚未取得本机状态。', selection: '当前选择', service: '服务状态', project: '项目', none: '无' }
    : { title: 'Advanced diagnostics', scanning: 'Refreshing local agent status…', missing: 'No local status has been reported.', selection: 'Selected agent', service: 'Service status', project: 'Project', none: 'None' };
  return (
    <details className="agent-picker__diagnostics" open={open}>
      <summary><Wrench size={12} /> {copy.title}</summary>
      <div>
        <p>{scanning ? copy.scanning : diagnostic || copy.missing}</p>
        <p>{copy.selection}: {selectedLabel}; {copy.service}: {connectionStatus}; {copy.project}: {projectId || copy.none}.</p>
      </div>
    </details>
  );
}
