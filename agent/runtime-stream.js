import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assertLoopbackEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Flovart Runtime endpoint must use loopback HTTP');
  }
  return url.origin;
}

function runtimeMessage(message) {
  if (message.role === 'user') {
    return { role: 'user', content: message.content, timestamp: message.timestamp };
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      stopReason: message.stopReason,
      timestamp: message.timestamp,
    };
  }
  return {
    role: 'toolResult',
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: message.content,
    isError: message.isError,
    timestamp: message.timestamp,
  };
}

function runtimeContext(context) {
  return {
    ...(context.systemPrompt ? { systemPrompt: context.systemPrompt } : {}),
    messages: context.messages.map(runtimeMessage),
    tools: (context.tools || []).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(tool.constrainedSampling ? { constrainedSampling: tool.constrainedSampling } : {}),
    })),
  };
}

function initialMessage(model) {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function parseSseBlock(block) {
  let event = 'message';
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  return { event, data: JSON.parse(data.join('\n')) };
}

async function* readSse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Flovart Runtime returned an empty agent-text stream');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) yield event;
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    if (event) yield event;
  }
}

function finishWithError(stream, model, error, aborted = false) {
  const message = {
    ...initialMessage(model),
    content: [{ type: 'text', text: '' }],
    stopReason: aborted ? 'aborted' : 'error',
    errorMessage: error instanceof Error ? error.message : String(error),
  };
  stream.push({ type: 'error', reason: message.stopReason, error: message });
  stream.end(message);
}

export function createRuntimeAgentTextStream({
  endpoint = undefined,
  token = undefined,
  connection = undefined,
  fetchFn = fetch,
}) {
  const staticConnection = endpoint || token
    ? { endpoint: assertLoopbackEndpoint(endpoint), token }
    : undefined;
  if (staticConnection && !staticConnection.token) throw new Error('Flovart Runtime token is required');
  if (!staticConnection && typeof connection !== 'function') {
    throw new Error('Flovart Runtime connection is required');
  }

  return (model, context, options = {}) => {
    if (options.apiKey) throw new Error('API Key must never pass through the Flovart Agent');
    const stream = createAssistantMessageEventStream();
    queueMicrotask(async () => {
      let partial = initialMessage(model);
      let text = '';
      let textStarted = false;
      try {
        const resolved = staticConnection || await connection();
        const origin = assertLoopbackEndpoint(resolved.endpoint);
        if (!resolved.token) throw new Error('Flovart Runtime token is required');
        const response = await fetchFn(`${origin}/v1/agent-text/stream`, {
          method: 'POST',
          signal: options.signal,
          headers: {
            Authorization: `Bearer ${resolved.token}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(runtimeContext(context)),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.error?.message || `Flovart Runtime agent-text failed with HTTP ${response.status}`);
        }
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
          throw new Error('Flovart Runtime returned a non-SSE agent-text response');
        }
        for await (const item of readSse(response)) {
          if (item.event === 'start') {
            stream.push({ type: 'start', partial: { ...partial } });
            continue;
          }
          if (item.event === 'text-delta') {
            if (!textStarted) {
              partial = { ...partial, content: [{ type: 'text', text: '' }] };
              stream.push({ type: 'text_start', contentIndex: 0, partial: { ...partial } });
              textStarted = true;
            }
            text += String(item.data?.delta || '');
            partial = { ...partial, content: [{ type: 'text', text }] };
            stream.push({ type: 'text_delta', contentIndex: 0, delta: String(item.data?.delta || ''), partial: { ...partial } });
            continue;
          }
          if (item.event === 'error') throw new Error(item.data?.message || 'Flovart Runtime agent-text failed');
          if (item.event === 'done') {
            if (textStarted) stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: { ...partial } });
            const reason = ['stop', 'length', 'toolUse'].includes(item.data?.finishReason)
              ? item.data.finishReason
              : 'stop';
            const message = { ...partial, stopReason: reason };
            stream.push({ type: 'done', reason, message });
            stream.end(message);
            return;
          }
        }
        throw new Error('Flovart Runtime agent-text stream ended before done');
      } catch (error) {
        finishWithError(stream, model, error, options.signal?.aborted);
      }
    });
    return stream;
  };
}
