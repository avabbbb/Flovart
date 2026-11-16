/**
 * 引用回复：纯函数。
 *
 * 被引原文以 Markdown 引用块（每行 `> `）放在用户消息最前面，空一行后接正文；
 * 这样它进入模型上下文，存进会话后再展示时也能原样拆回「引用块 + 正文」。
 */

/** 发给模型的引文上限（字符）：足够带上一整段回答，又不把很长的回答整段塞回上下文。 */
export const QUOTE_SEND_MAX = 2000;
/** 输入框上方引用条的预览长度。 */
export const QUOTE_PREVIEW_MAX = 140;

const ELLIPSIS = '…';

function normalize(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 截到 max 个字符（按码点，不切断表情），超出时末尾加省略号。 */
export function truncateText(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(0, max - 1)).join('').trimEnd() + ELLIPSIS;
}

/** 引用条预览：压成一行再截断。 */
export function quotePreview(text: string, max = QUOTE_PREVIEW_MAX): string {
  return truncateText(normalize(text).replace(/\s*\n\s*/g, ' '), max);
}

/** 发送用的引文：保留换行，过长截断。 */
export function quoteForSend(text: string, max = QUOTE_SEND_MAX): string {
  return truncateText(normalize(text), max);
}

/** 把引文拼到正文前：`> 第一行\n> 第二行\n\n正文`。空引文原样返回正文。 */
export function withQuote(body: string, quote: string | null | undefined, max = QUOTE_SEND_MAX): string {
  const cited = quote ? quoteForSend(quote, max) : '';
  if (!cited) return body;
  const block = cited.split('\n').map(line => (line ? '> ' + line : '>')).join('\n');
  return body ? `${block}\n\n${body}` : block;
}

/** 拆回引用块与正文：只认消息开头连续的 `>` 行。 */
export function splitQuote(text: string): { quote?: string; body: string } {
  if (!text || !text.startsWith('>')) return { body: text };
  const lines = text.split('\n');
  let end = 0;
  while (end < lines.length && lines[end].startsWith('>')) end += 1;
  const quote = lines.slice(0, end).map(line => line.replace(/^> ?/, '')).join('\n').trim();
  const body = lines.slice(end).join('\n').replace(/^\n+/, '');
  return quote ? { quote, body } : { body: text };
}
