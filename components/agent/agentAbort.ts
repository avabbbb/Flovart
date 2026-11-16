// 用户主动停止不是错误：统一识别各层的中止文案（浏览器 DOMException、Node AbortError、
// 内核写入的「已中止」），面板显示中性的「已中止」，而不是红色错误卡里的
// "signal is aborted without reason"。
const ABORT_PATTERN = /^(?:已中止|signal is aborted without reason|this operation was aborted|the operation was aborted\.?|the user aborted a request\.?|aborted|request aborted|aborterror(?::.*)?)$/i;

export function isAbortMessage(message: unknown): boolean {
  const text = String(message ?? '').trim();
  return Boolean(text) && ABORT_PATTERN.test(text);
}

export function abortedNoticeText(language: 'en' | 'zho'): string {
  return language === 'en' ? 'Stopped' : '已中止';
}

/** 运行中插话 / 排队消息的提示：说明它不会打断当前这一轮。 */
export function queuedNoticeText(kind: 'steer' | 'queue', language: 'en' | 'zho'): string {
  if (kind === 'steer') return language === 'en' ? 'Added to the running turn — applied at the next step.' : '已加入当前任务，下一步生效';
  return language === 'en' ? 'Queued — will run after the current turn.' : '已排队，当前这一轮结束后发送';
}
