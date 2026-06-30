import React from 'react';

export interface ToolCallLog {
  id: string;
  name: string;
  arguments: string;
  status: 'pending' | 'success' | 'error' | 'confirmed';
  result?: string;
}

export interface ChatLog {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  time: string;
  attachments?: Array<{ url: string; mimeType: string }>;
  toolCalls?: ToolCallLog[];
  isStreaming?: boolean;
}

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const makeLogId = (role: string) => `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export const createLog = (partial: Omit<ChatLog, 'id' | 'time'>): ChatLog => ({
  ...partial,
  id: makeLogId(partial.role),
  time: nowLabel(),
});

const TOOL_LABELS: Record<string, string> = {
  canvas_get_state: '读取画布',
  canvas_get_selection: '读取选区',
  canvas_export_snapshot: '导出快照',
  canvas_create_text: '创建文本',
  canvas_create_image: '创建图片',
  canvas_create_video: '创建视频',
  canvas_update_element: '更新元素',
  canvas_move_elements: '移动元素',
  canvas_delete_elements: '删除元素',
  canvas_select_elements: '选中元素',
  canvas_set_viewport: '设置视口',
  canvas_generate_image: '生成图片',
  canvas_generate_video: '生成视频',
};

const formatArgs = (raw: string): string => {
  try {
    const obj = JSON.parse(raw);
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v.length > 60 ? v.slice(0, 60) + '…' : v}"` : Array.isArray(v) ? `[${v.length}]` : String(v)}`)
      .join('  ');
  } catch {
    return raw.slice(0, 120);
  }
};

const ToolCallCard: React.FC<{ tool: ToolCallLog }> = ({ tool }) => {
  const label = TOOL_LABELS[tool.name] || tool.name;
  const statusColor =
    tool.status === 'success' ? 'var(--isl-mint)' :
    tool.status === 'error' ? 'var(--isl-coral)' :
    tool.status === 'confirmed' ? 'var(--isl-mint)' :
    'var(--isl-ink-ghost)';
  const statusIcon =
    tool.status === 'success' ? '✓' :
    tool.status === 'error' ? '✕' :
    tool.status === 'confirmed' ? '✓' :
    '…';

  return (
    <div className="isl-well rounded-xl px-3 py-2 text-[11px]" style={{ marginTop: 6 }}>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
          style={{ background: statusColor, color: '#fff' }}
        >
          {statusIcon}
        </span>
        <span className="font-bold" style={{ color: 'var(--isl-ink)' }}>{label}</span>
        <span className="ml-auto text-[9px] tabular-nums" style={{ color: 'var(--isl-ink-ghost)' }}>{tool.name}</span>
      </div>
      {tool.arguments && tool.arguments !== '{}' && (
        <div className="mt-1 line-clamp-3 font-mono text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>
          {formatArgs(tool.arguments)}
        </div>
      )}
      {tool.result && (
        <div className="mt-1 line-clamp-4 text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
          {tool.result.length > 200 ? tool.result.slice(0, 200) + '…' : tool.result}
        </div>
      )}
    </div>
  );
};

const AttachmentPreview: React.FC<{ url: string; mimeType: string }> = ({ url, mimeType }) => {
  if (mimeType.startsWith('image/')) {
    return (
      <img
        src={url}
        alt="attachment"
        className="mt-1.5 max-h-32 max-w-[220px] rounded-lg object-cover"
        style={{ border: '1.5px solid var(--isl-border)' }}
      />
    );
  }
  return (
    <div className="mt-1.5 rounded-lg px-2 py-1.5 text-[11px]" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)' }}>
      📎 {mimeType}
    </div>
  );
};

export const ChatMessage: React.FC<{ log: ChatLog }> = ({ log }) => {
  const isUser = log.role === 'user';
  const isError = log.role === 'system';
  const avatar = isUser ? '🧑' : isError ? '⚠️' : '🌱';
  const avatarBg = isUser ? 'var(--isl-surface-2)' : isError ? 'rgba(232,97,90,0.18)' : 'var(--isl-mint)';

  return (
    <div className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <span className="isl-avatar" style={{ background: avatarBg }}>{avatar}</span>
      <div className={`min-w-0 max-w-[82%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className="mb-1 px-1 text-[10px] font-semibold tabular-nums" style={{ color: 'var(--isl-ink-ghost)' }}>{log.time}</div>
        {(log.content || log.isStreaming) && (
          <div className={`isl-bubble px-3.5 py-2.5 text-[13px] leading-relaxed ${isUser ? 'isl-bubble--user' : isError ? 'isl-bubble--error' : 'isl-bubble--agent'}`}>
            {log.content}
            {log.isStreaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse align-middle" style={{ background: 'var(--isl-mint)' }} />}
          </div>
        )}
        {log.attachments?.map((att, i) => (
          <AttachmentPreview key={i} url={att.url} mimeType={att.mimeType} />
        ))}
        {log.toolCalls?.map(tc => (
          <ToolCallCard key={tc.id} tool={tc} />
        ))}
      </div>
    </div>
  );
};

export default ChatMessage;
