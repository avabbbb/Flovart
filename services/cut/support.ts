// WebCodecs 能力探测：不引用 mediabunny，可在编辑器 chunk 加载前同步调用。
export interface CutSupport {
  supported: boolean;
  missing: string[];
}

export function detectCutSupport(scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): CutSupport {
  const required = ['VideoDecoder', 'VideoEncoder', 'AudioDecoder', 'AudioEncoder', 'VideoFrame', 'OffscreenCanvas', 'OfflineAudioContext'];
  const missing = required.filter(name => typeof scope[name] !== 'function');
  return { supported: missing.length === 0, missing };
}
