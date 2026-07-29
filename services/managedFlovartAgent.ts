import type { ManagedAgentConnection } from './managedAgentConnection';

export interface FlovartAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp?: number;
  error?: string;
}

export interface FlovartAgentSnapshot {
  sessionId: string;
  projectId: string;
  messages: FlovartAgentMessage[];
  running: boolean;
}

export type FlovartAgentTurnEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'snapshot'; snapshot: FlovartAgentSnapshot }
  | { type: 'status'; running: boolean }
  | { type: 'error'; message: string };

function headers(connection: ManagedAgentConnection, body = false) {
  return {
    'X-Flovart-Agent-Token': connection.token,
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return new Error(body?.error?.message || body?.error || `Flovart Agent 请求失败（HTTP ${response.status}）`);
}

function parseSseBlock(block: string) {
  let type = '';
  const data: string[] = [];
  block.split(/\r?\n/).forEach(line => {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  });
  if (!type || !data.length) return undefined;
  return { type, data: JSON.parse(data.join('\n')) };
}

export class ManagedFlovartAgentClient {
  constructor(private connection: ManagedAgentConnection) {}

  async session(projectId: string): Promise<FlovartAgentSnapshot> {
    const response = await fetch(`${this.connection.url}/agent/flovart/session?projectId=${encodeURIComponent(projectId)}`, {
      headers: headers(this.connection),
    });
    if (!response.ok) throw await responseError(response);
    return response.json();
  }

  async turn(
    projectId: string,
    prompt: string,
    emit: (event: FlovartAgentTurnEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch(`${this.connection.url}/agent/flovart/turn`, {
      method: 'POST',
      signal,
      headers: headers(this.connection, true),
      body: JSON.stringify({ projectId, prompt }),
    });
    if (!response.ok) throw await responseError(response);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Flovart Agent 没有返回事件流。');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const event = parseSseBlock(block);
        if (!event) continue;
        if (event.type === 'text-delta') emit({ type: 'text-delta', delta: String(event.data?.delta || '') });
        else if (event.type === 'snapshot') emit({ type: 'snapshot', snapshot: event.data });
        else if (event.type === 'status') emit({ type: 'status', running: Boolean(event.data?.running) });
        else if (event.type === 'error') emit({ type: 'error', message: String(event.data?.message || 'Flovart Agent 运行失败') });
      }
      if (done) break;
    }
  }

  async cancel(projectId: string): Promise<void> {
    const response = await fetch(`${this.connection.url}/agent/flovart/cancel`, {
      method: 'POST',
      headers: headers(this.connection, true),
      body: JSON.stringify({ projectId }),
    });
    if (!response.ok) throw await responseError(response);
  }
}
