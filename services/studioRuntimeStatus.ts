export type AgentRuntimeState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'web' }
  | { kind: 'error'; message: string };

export interface StudioRuntimeStatus {
  tone: 'ready' | 'warning';
  label: string;
  detail: string;
}

export function getStudioRuntimeStatus(language: 'en' | 'zho', state: AgentRuntimeState): StudioRuntimeStatus {
  const isChinese = language === 'zho';
  if (state.kind === 'ready') return {
    tone: 'ready',
    label: isChinese ? '就绪' : 'Ready',
    detail: isChinese ? 'Desktop Runtime 与 Flovart Agent 可用' : 'Desktop Runtime and Flovart Agent are available',
  };
  if (state.kind === 'web') return {
    tone: 'warning',
    label: isChinese ? 'Web 模式' : 'Web mode',
    detail: isChinese ? 'Agent 仅桌面端可用；Workflow 与 Table 仍可使用' : 'Agent requires Desktop; Workflow and Table remain available',
  };
  if (state.kind === 'error') return {
    tone: 'warning',
    label: isChinese ? 'Agent 不可用' : 'Agent unavailable',
    detail: isChinese ? `Desktop Runtime 连接失败：${state.message}` : `Desktop Runtime connection failed: ${state.message}`,
  };
  return {
    tone: 'warning',
    label: isChinese ? '连接中' : 'Connecting',
    detail: isChinese ? '正在检查 Desktop Runtime 与 Flovart Agent' : 'Checking Desktop Runtime and Flovart Agent',
  };
}
