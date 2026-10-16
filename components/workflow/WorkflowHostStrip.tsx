import { Clapperboard, Send } from 'lucide-react';
import type { WorkflowHostClip } from './hostLink';

const COPY = {
  en: {
    region: 'Host timeline clips',
    focus: (label: string) => `Show ${label} on the canvas`,
    results: (count: number) => (count === 1 ? '1 result' : `${count} results`),
    sent: (count: number) => `${count} sent`,
    hosts: { resolve: 'Resolve', premiere: 'Premiere', 'after-effects': 'After Effects', photoshop: 'Photoshop' } as Record<string, string>,
  },
  zho: {
    region: '宿主时间线片段',
    focus: (label: string) => `在画布上定位 ${label}`,
    results: (count: number) => `${count} 个结果`,
    sent: (count: number) => `已发送 ${count}`,
    hosts: { resolve: 'Resolve', premiere: 'Premiere', 'after-effects': 'After Effects', photoshop: 'Photoshop' } as Record<string, string>,
  },
} as const;

/**
 * Canvas 底部的宿主片段条：只投影项目中已有的 creative-host 节点；没有宿主片段时不渲染。
 * 点击片段在画布上定位该节点。
 */
export function WorkflowHostStrip({ clips, language = 'zho', onFocusClip }: {
  clips: WorkflowHostClip[];
  language?: 'en' | 'zho';
  onFocusClip: (nodeId: string) => void;
}) {
  if (clips.length === 0) return null;
  const copy = COPY[language];
  return (
    <nav className="workflow-host-strip" aria-label={copy.region} data-workflow-overlay data-testid="workflow-host-strip">
      {clips.map(clip => (
        <button
          key={clip.nodeId}
          type="button"
          className="workflow-host-strip__clip"
          title={copy.focus(clip.label)}
          aria-label={copy.focus(clip.label)}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => onFocusClip(clip.nodeId)}
        >
          <Clapperboard size={12} aria-hidden="true" />
          <span className="workflow-host-strip__host">{copy.hosts[clip.host] || clip.host}</span>
          <span className="workflow-host-strip__label">{clip.label}</span>
          {clip.resultCount > 0 && <span className="workflow-host-strip__meta">{copy.results(clip.resultCount)}</span>}
          {clip.sentCount > 0 && <span className="workflow-host-strip__meta"><Send size={10} aria-hidden="true" />{copy.sent(clip.sentCount)}</span>}
        </button>
      ))}
    </nav>
  );
}
