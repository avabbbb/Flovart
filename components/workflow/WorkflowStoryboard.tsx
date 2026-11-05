// 故事板视图（P2）：由制作圣经的镜头表渲染，点击镜头聚焦画布节点；
// 「引用到 Agent」复用画布已有的 pushAgentGroup，不另起一套上下文通道。
import { Clapperboard, Send, X } from 'lucide-react';
import type { ProductionBible } from './productionBible';
import { planAssembly } from './shotAssembly';

const panelStyle: React.CSSProperties = {
  position: 'absolute', right: 16, top: 72, bottom: 96, width: 300, zIndex: 80,
  display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 12,
  background: 'var(--workflow-panel-bg, rgba(255,255,255,0.97))', color: 'inherit',
  border: '1px solid rgba(127,127,127,0.25)', boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer',
  borderBottom: '1px solid rgba(127,127,127,0.15)',
};
const buttonStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid rgba(127,127,127,0.3)',
  borderRadius: 6, padding: '2px 8px', background: 'transparent', color: 'inherit', fontSize: 12, cursor: 'pointer',
};

export function WorkflowStoryboard({ bible, language = 'zho', onFocus, onReference, onClose }: {
  bible: ProductionBible;
  language?: 'en' | 'zho';
  onFocus: (nodeId: string) => void;
  onReference: (nodeIds: string[]) => void;
  onClose: () => void;
}) {
  const en = language === 'en';
  const plan = planAssembly(bible);
  const referenceLabel = en ? 'Reference to Agent' : '引用到 Agent';
  return (
    <aside
      data-workflow-overlay
      aria-label={en ? 'Storyboard' : '故事板'}
      style={panelStyle}
      onPointerDown={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(127,127,127,0.2)' }}>
        <Clapperboard size={16} />
        <strong style={{ flex: 1 }}>{en ? 'Storyboard' : '故事板'}</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {en ? bible.totals.shotCount + ' shots · ' + bible.totals.durationSec + 's' : bible.totals.shotCount + ' 镜 · ' + bible.totals.durationSec + ' 秒'}
        </span>
        <button type="button" aria-label={en ? 'Close storyboard' : '关闭故事板'} style={{ ...buttonStyle, border: 'none', padding: 2 }} onClick={onClose}><X size={14} /></button>
      </header>
      <div role="status" style={{ padding: '6px 12px', fontSize: 12, opacity: 0.8 }}>
        {plan.ready
          ? (en ? 'Ready to merge ' + plan.sourceNodeIds.length + ' clips in shot order' : '可按镜号拼接 ' + plan.sourceNodeIds.length + ' 段')
          : plan.blockers.join(en ? '; ' : '；')}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {bible.shots.map(shot => (
          <div
            key={shot.nodeId}
            role="button"
            tabIndex={0}
            style={rowStyle}
            title={en ? 'Focus on canvas' : '在画布中定位'}
            onClick={() => onFocus(shot.nodeId)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onFocus(shot.nodeId); } }}
          >
            <span style={{ minWidth: 28, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>#{shot.index}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shot.title}</span>
              <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>
                {[shot.durationSec ? shot.durationSec + (en ? 's' : ' 秒') : '', shot.scene || '', shot.hasMedia ? '' : (en ? 'no video yet' : '尚无视频')].filter(Boolean).join(' · ')}
              </span>
            </span>
            <button
              type="button"
              style={buttonStyle}
              aria-label={referenceLabel + ' #' + shot.index}
              onClick={event => { event.stopPropagation(); onReference([shot.nodeId]); }}
            ><Send size={12} />{en ? 'Agent' : '引用'}</button>
          </div>
        ))}
      </div>
      <footer style={{ padding: '8px 12px', borderTop: '1px solid rgba(127,127,127,0.2)' }}>
        <button type="button" style={{ ...buttonStyle, width: '100%', justifyContent: 'center', padding: '6px 8px' }} onClick={() => onReference(bible.shots.map(shot => shot.nodeId))}>
          <Send size={12} />{en ? 'Reference all shots to Agent' : '全部镜头引用到 Agent'}
        </button>
      </footer>
    </aside>
  );
}
