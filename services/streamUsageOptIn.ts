// L4：Key 级流式 usage opt-in。默认 passive 完全不改请求；
// request 时给 OpenAI 兼容流式请求加 stream_options.include_usage，
// 若网关因该字段返回 400，去掉字段重试一次，并在本会话内对该地址回退 passive。

export type StreamUsageMode = 'passive' | 'request';

const rejectedUrls = new Set<string>();

/** 仅用于测试：清空本会话的降级记忆。 */
export function resetStreamUsageOptIn(): void {
    rejectedUrls.clear();
}

export function withIncludeUsage(body: Record<string, unknown>, mode: StreamUsageMode | undefined): Record<string, unknown> {
    return mode === 'request' ? { ...body, stream_options: { include_usage: true } } : body;
}

const REJECTION_PATTERN = /stream_options|include_usage|unknown (parameter|field|argument)|unrecognized|extra (inputs|fields)|not permitted|additional properties/i;

/** 只有 400 且错误文本指向未知/多余参数时，才认定为 include_usage 导致。 */
export function isIncludeUsageRejection(status: number, bodyText: string): boolean {
    return status === 400 && REJECTION_PATTERN.test(bodyText);
}

export async function fetchStreamWithUsageOptIn(
    url: string,
    init: Omit<RequestInit, 'body'>,
    body: Record<string, unknown>,
    mode: StreamUsageMode | undefined,
    fetchImpl: typeof fetch = fetch,
): Promise<Response> {
    const plain = () => fetchImpl(url, { ...init, body: JSON.stringify(body) });
    if (mode !== 'request' || rejectedUrls.has(url)) return plain();
    const first = await fetchImpl(url, { ...init, body: JSON.stringify(withIncludeUsage(body, mode)) });
    if (first.status !== 400) return first;
    const text = await first.clone().text().catch(() => '');
    if (!isIncludeUsageRejection(first.status, text)) return first;
    rejectedUrls.add(url);
    return plain();
}
