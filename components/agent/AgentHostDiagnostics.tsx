import { Wrench } from 'lucide-react';

interface AgentHostDiagnosticsProps {
  scanning: boolean;
  diagnostic?: string;
  selectedLabel: string;
  connectionStatus: string;
  projectId: string | null;
  open?: boolean;
}

export function AgentHostDiagnostics({ scanning, diagnostic, selectedLabel, connectionStatus, projectId, open = false }: AgentHostDiagnosticsProps) {
  return (
    <details className="agent-picker__diagnostics" open={open}>
      <summary><Wrench size={12} /> 开发者诊断</summary>
      <div>
        <p>{scanning ? '正在刷新本机协作状态…' : diagnostic || '尚未取得本机状态。'}</p>
        <p>当前选择：{selectedLabel}；服务状态：{connectionStatus}；项目：{projectId || '无'}。</p>
      </div>
    </details>
  );
}
