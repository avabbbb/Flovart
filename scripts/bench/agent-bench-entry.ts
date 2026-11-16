// Bench entry: drives the real BrowserAgentKernel (pi-agent-core loop + createBrowserAgentStream)
// against an OpenAI-compatible endpoint. Tools keep their real schemas; execute is canned so the
// bench measures the LLM path, not the canvas. Bundled by scripts/bench-agent.mjs with esbuild.
import { BrowserAgentKernel, createBrowserAgentTools, BROWSER_DEFAULT_SYSTEM_PROMPT } from '../../services/browserAgentKernel';
import type { BrowserAgentTextRoute } from '../../services/browserAgentKernel';

export interface AttemptRecord { status: number | 'network'; ms: number; promptTokens?: number; cachedTokens?: number }
export interface LlmCallRecord {
  session: number;
  turn: number;
  /** 首个可见增量（文本 / 思考 / 工具参数）到达面板的时间；没有增量时等于整段完成时间。 */
  visibleTtftMs: number;
  /** 首个内容 chunk 到达网络层的时间（最后一次尝试）。 */
  wireTtftMs: number | null;
  totalMs: number;
  attempts: AttemptRecord[];
  stopReason: string;
  error?: string;
  streamedDeltas: number;
}
export interface SessionResult { session: number; ok: boolean; failure?: string; steered?: 'accepted' | 'unsupported' | 'lost'; turnMs: number[] }

const CANNED_CANVAS = JSON.stringify({ projectId: 'bench', nodes: [
  { id: 'n1', type: 'image', title: '主视觉', prompt: 'cinematic wide shot, teal and amber', status: 'success' },
  { id: 'n2', type: 'video', title: '镜头 1', prompt: 'slow push in', status: 'idle' },
], edges: [{ from: 'n1', to: 'n2' }] });

interface PendingCall { startedAt: number; firstVisible: number | null; deltas: number; attempts: AttemptRecord[]; wireFirst: number | null }
// 按 Authorization 区分并发会话（mock 每个会话一把假 key；real 模式并发固定为 1）。
const pendingByKey = new Map<string, PendingCall>();
function authOf(init?: RequestInit): string {
  const headers = new Headers(init?.headers);
  return headers.get('authorization') || '';
}
const realFetch = globalThis.fetch;

function usageFrom(json: Record<string, any>) {
  const usage = json?.usage;
  if (!usage || !usage.prompt_tokens) return null;
  return {
    promptTokens: Number(usage.prompt_tokens),
    cachedTokens: Number(usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0),
  };
}

/** 包一层 fetch：按尝试记录状态、首个内容 chunk、usage（含 DeepSeek prompt_cache_hit_tokens / OpenAI cached_tokens）。 */
export function installFetchProbe() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.endsWith('/chat/completions')) return realFetch(input, init);
    const key = authOf(init);
    let call = pendingByKey.get(key);
    if (!call) { call = { startedAt: performance.now(), firstVisible: null, deltas: 0, attempts: [], wireFirst: null }; pendingByKey.set(key, call); }
    const t0 = performance.now();
    const attempt: AttemptRecord = { status: 'network', ms: 0 };
    call.attempts.push(attempt);
    let response: Response;
    try {
      response = await realFetch(input, init);
    } catch (error) {
      attempt.ms = performance.now() - t0;
      throw error;
    }
    attempt.status = response.status;
    if (!response.body) { attempt.ms = performance.now() - t0; return response; }
    const [mine, theirs] = response.body.tee();
    void (async () => {
      const reader = mine.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta;
              if (call!.wireFirst === null && delta && (delta.content || delta.reasoning_content || delta.tool_calls)) call!.wireFirst = performance.now() - call!.startedAt;
              const usage = usageFrom(json);
              if (usage) Object.assign(attempt, usage);
            } catch { /* partial */ }
          }
        }
      } catch { /* aborted */ }
      attempt.ms = performance.now() - t0;
    })();
    return new Response(theirs, { status: response.status, statusText: response.statusText, headers: response.headers });
  }) as typeof fetch;
}

export async function runSession(options: {
  session: number;
  route: BrowserAgentTextRoute;
  prompts: string[];
  steerText?: string;
  turnTimeoutMs: number;
  onCall: (record: LlmCallRecord) => void;
}): Promise<SessionResult> {
  const realTools = createBrowserAgentTools({ projectId: 'bench-' + options.session, confirm: async () => true, activeChangeSetId: '', getApproval: () => ({ mode: 'yolo' }) });
  const tools = realTools.map(tool => ({
    ...tool,
    execute: async () => ({ content: [{ type: 'text' as const, text: tool.name.includes('inspect') ? CANNED_CANVAS : '{"ok":true}' }], details: { ok: true } }),
  }));
  const kernel = new BrowserAgentKernel({
    projectId: 'bench-' + options.session,
    route: options.route,
    tools: tools as never,
    confirm: async () => true,
    systemPrompt: BROWSER_DEFAULT_SYSTEM_PROMPT,
    getThinkingLevel: () => 'off',
  });
  await kernel.openSession();
  const key = 'Bearer ' + options.route.apiKey;
  let turn = 0;
  kernel.subscribe(event => {
    const pending = pendingByKey.get(key);
    if (event.type === 'message_update' && pending) {
      pending.deltas += 1;
      if (pending.firstVisible === null) pending.firstVisible = performance.now() - pending.startedAt;
    }
    if (event.type === 'message_end' && (event.message as { role?: string })?.role === 'assistant') {
      const message = event.message as { stopReason?: string; errorMessage?: string };
      const call = pending;
      pendingByKey.delete(key);
      if (!call) return;
      const totalMs = performance.now() - call.startedAt;
      options.onCall({
        session: options.session, turn,
        visibleTtftMs: call.firstVisible ?? totalMs,
        wireTtftMs: call.wireFirst,
        totalMs,
        attempts: call.attempts,
        stopReason: String(message.stopReason),
        ...(message.errorMessage ? { error: message.errorMessage } : {}),
        streamedDeltas: call.deltas,
      });
    }
  });
  const turnMs: number[] = [];
  let steered: SessionResult['steered'];
  try {
    for (const [index, prompt] of options.prompts.entries()) {
      turn = index;
      const started = performance.now();
      const send = kernel.send(prompt);
      if (index === 0 && options.steerText) {
        await new Promise(resolve => setTimeout(resolve, 30));
        const k = kernel as unknown as { steer?: (text: string) => Promise<unknown> | unknown };
        if (typeof k.steer !== 'function') steered = 'unsupported';
        else { await k.steer(options.steerText); steered = 'accepted'; }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TURN_TIMEOUT')), options.turnTimeoutMs); });
      try {
        await Promise.race([send, timeout]);
      } catch (error) {
        kernel.cancel();
        await send.catch(() => undefined);
        throw error;
      } finally {
        clearTimeout(timer);
      }
      turnMs.push(performance.now() - started);
      const snapshot = await kernel.snapshot();
      const last = snapshot.messages[snapshot.messages.length - 1] as { error?: string } | undefined;
      if (last?.error) return { session: options.session, ok: false, failure: classify(last.error), steered, turnMs };
      if (index === 0 && steered === 'accepted') {
        const users = snapshot.messages.filter(message => message.role === 'user').map(message => String((message as { text?: string }).text || ''));
        if (!users.some(text => text.includes(options.steerText!))) steered = 'lost';
      }
    }
    return { session: options.session, ok: true, steered, turnMs };
  } catch (error) {
    return { session: options.session, ok: false, failure: classify(error instanceof Error ? error.message : String(error)), steered, turnMs };
  } finally {
    pendingByKey.delete(key);
    await kernel.close();
  }
}

export function classify(message: string): string {
  if (/TURN_TIMEOUT/.test(message)) return 'stall';
  if (/aborted|已中止/i.test(message)) return 'aborted';
  if (/无响应|timed? ?out|超时/i.test(message)) return 'timeout';
  if (/HTTP 429|请求过于频繁|限流/.test(message)) return 'http429';
  if (/HTTP 5\d\d|暂时不可用/.test(message)) return 'http5xx';
  if (/fetch failed|ECONNRESET|socket|terminated|network|网络|无法连接/i.test(message)) return 'network';
  return 'other';
}

export { BROWSER_DEFAULT_SYSTEM_PROMPT };
