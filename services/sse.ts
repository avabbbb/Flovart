// 统一的 SSE 读取（L2 传输层）：按空行分块（兼容 \n\n 与 \r\n\r\n）、跨 read 拼接、容忍 `data:` 无空格、
// 跳过注释行与 [DONE]。只负责切分事件，不认识任何供应商字段。
// 见 docs/design/32-stream-usage.zh-CN.md。

export interface SseEvent {
    event?: string;
    data: string;
}

/** 解析单个 SSE 块；没有 data 字段时返回 null。 */
export function parseSseBlock(block: string): SseEvent | null {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
    }
    if (data.length === 0) return null;
    return { event, data: data.join('\n') };
}

/** 逐个产出 SSE 事件。消费方提前退出（break/throw）时会取消底层流。 */
export async function* readSseEvents(response: Response): AsyncGenerator<SseEvent> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法获取响应流');
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    try {
        while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = done ? '' : blocks.pop() ?? '';
            for (const block of blocks) {
                const event = parseSseBlock(block);
                if (event) yield event;
            }
            if (done) { finished = true; break; }
        }
    } finally {
        if (!finished) await reader.cancel().catch(() => undefined);
    }
}

/** 产出每个事件的 JSON；跳过 [DONE] 与单行损坏的 JSON（与旧实现一致）。 */
export async function* readSseJson(response: Response): AsyncGenerator<unknown> {
    for await (const event of readSseEvents(response)) {
        const payload = event.data.trim();
        if (!payload || payload === '[DONE]') continue;
        let json: unknown;
        try { json = JSON.parse(payload); } catch { continue; }
        yield json;
    }
}
