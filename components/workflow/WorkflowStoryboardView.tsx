// 故事板第二视图（P1-4）：与「工作流」视图并列，内容完全由 buildStoryboardView 从同一份 workflow 推导。
// 每个元素点开即回到画布定位该节点并打开它的 Prompt Bar；成片区复用 video.merge@1。
import { Clapperboard, Film, Image as ImageIcon, Send, Sparkles } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useWorkflowMediaUrl } from './media';
import type { StoryboardMedia, StoryboardView } from './productionBible';

type Lang = 'en' | 'zho';

function Thumb({ media, kind, label }: { media?: StoryboardMedia; kind: 'image' | 'video'; label: string }) {
  const still = useWorkflowMediaUrl(kind === 'video' ? media?.posterStorageKey : media?.storageKey, kind === 'video' ? media?.poster : media?.href);
  const clip = useWorkflowMediaUrl(kind === 'video' && !media?.poster && !media?.posterStorageKey ? media?.storageKey : undefined, kind === 'video' && !media?.poster && !media?.posterStorageKey ? media?.href : undefined);
  if (still.url) return <img className="workflow-storyboard__thumb" src={still.url} alt={label} draggable={false} />;
  if (clip.url) return <video className="workflow-storyboard__thumb" src={clip.url} muted playsInline preload="metadata" aria-label={label} />;
  return <div className="workflow-storyboard__thumb is-empty">{kind === 'video' ? <Film size={18} /> : <ImageIcon size={18} />}</div>;
}

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="workflow-storyboard__section">
      <header><h3>{title}</h3>{extra}</header>
      {children}
    </section>
  );
}

export interface WorkflowStoryboardViewProps {
  view: StoryboardView;
  language?: Lang;
  mergeBusy?: boolean;
  /** 回到画布定位节点并打开它的 Prompt Bar。 */
  onOpenNode: (nodeId: string) => void;
  onReference: (nodeIds: string[]) => void;
  onMerge: (sourceNodeIds: string[]) => void;
}

export function WorkflowStoryboardView({ view, language = 'zho', mergeBusy, onOpenNode, onReference, onMerge }: WorkflowStoryboardViewProps) {
  const en = language === 'en';
  const total = Math.max(view.timeline.reduce((sum, clip) => sum + clip.durationSec, 0), 0.01);
  const open = (nodeId: string) => () => onOpenNode(nodeId);
  const keyOpen = (nodeId: string) => (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenNode(nodeId); } };
  const plan = view.final.plan;
  return (
    <div className="workflow-storyboard" data-workflow-overlay data-testid="workflow-storyboard-view" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <div className="workflow-storyboard__summary">
        <Clapperboard size={16} />
        <span>{en ? `${view.totals.shotCount} shots · ${view.totals.durationSec}s · ${view.totals.approvedAnchors} approved anchors` : `${view.totals.shotCount} 镜 · ${view.totals.durationSec} 秒 · 已批准锚点 ${view.totals.approvedAnchors}`}</span>
        {view.issues.length > 0 && <span className="workflow-storyboard__issues" role="status">{view.issues.join(en ? '; ' : '；')}</span>}
        <span style={{ flex: 1 }} />
        {view.rows.length > 0 && <button type="button" className="workflow-storyboard__btn" onClick={() => onReference(view.rows.map(row => row.nodeId))}><Send size={12} />{en ? 'All shots to Agent' : '全部镜头引用到 Agent'}</button>}
      </div>

      <Section title={en ? 'Anchors' : '锚点'}>
        {view.anchors.length === 0
          ? <p className="workflow-storyboard__empty">{en ? 'No anchors yet. Approve a character / scene / product image to give it a code.' : '还没有锚点。批准角色/场景/产品图后会得到编号（A01/S01/P01）。'}</p>
          : <div className="workflow-storyboard__anchors">
            {view.anchors.map(anchor => (
              <div key={anchor.nodeId} role="button" tabIndex={0} className={`workflow-storyboard__card${anchor.approved ? '' : ' is-pending'}`} onClick={open(anchor.nodeId)} onKeyDown={keyOpen(anchor.nodeId)} title={en ? 'Open on canvas' : '在画布中打开'}>
                <Thumb media={anchor.media} kind="image" label={anchor.title} />
                <span className="workflow-storyboard__code">{anchor.code || (en ? 'pending' : '待批准')}</span>
                <span className="workflow-storyboard__card-title">{anchor.title}</span>
              </div>
            ))}
          </div>}
      </Section>

      <Section title={en ? 'Shots' : '分镜'}>
        {view.rows.length === 0
          ? <p className="workflow-storyboard__empty">{en ? 'No shots yet. Give a generation node a shot number to list it here.' : '还没有分镜。给生成节点写上镜号（shot.index）就会出现在这里。'}</p>
          : <div className="workflow-storyboard__rows" role="table">
            {view.rows.map(row => (
              <div key={row.nodeId} role="row" tabIndex={0} className="workflow-storyboard__row" onClick={open(row.nodeId)} onKeyDown={keyOpen(row.nodeId)} data-testid={'storyboard-row-' + row.index}>
                <span className="workflow-storyboard__index">#{row.index}</span>
                <Thumb media={row.media} kind={row.type === 'video' ? 'video' : 'image'} label={row.title} />
                <span className="workflow-storyboard__row-main">
                  <strong>{row.title}</strong>
                  <span className="workflow-storyboard__prompt">{row.prompt || (en ? '(no prompt yet)' : '（还没写提示词）')}</span>
                  <span className="workflow-storyboard__meta">
                    {[row.anchorCodes.join(' '), row.durationSec ? row.durationSec + (en ? 's' : ' 秒') : '', row.scene || '', row.camera || '', row.dialogue ? '“' + row.dialogue + '”' : '', row.hasMedia ? '' : (en ? 'not generated' : '未生成')].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <button type="button" className="workflow-storyboard__btn" aria-label={(en ? 'Reference to Agent #' : '引用到 Agent #') + row.index} onClick={event => { event.stopPropagation(); onReference([row.nodeId]); }}><Send size={12} />{en ? 'Agent' : '引用'}</button>
              </div>
            ))}
          </div>}
      </Section>

      {view.images.length > 0 && (
        <Section title={en ? 'Images' : '图片'}>
          <div className="workflow-storyboard__anchors">
            {view.images.map(row => (
              <div key={row.nodeId} role="button" tabIndex={0} className="workflow-storyboard__card" onClick={open(row.nodeId)} onKeyDown={keyOpen(row.nodeId)}>
                <Thumb media={row.media} kind="image" label={row.title} />
                <span className="workflow-storyboard__code">#{row.index}</span>
                <span className="workflow-storyboard__card-title">{row.title}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={en ? 'Video timeline' : '视频时间线'}>
        {view.timeline.length === 0
          ? <p className="workflow-storyboard__empty">{en ? 'No video shots yet.' : '还没有视频镜头。'}</p>
          : <div className="workflow-storyboard__timeline" data-testid="storyboard-timeline">
            {view.timeline.map(clip => (
              <div key={clip.nodeId} role="button" tabIndex={0}
                className={`workflow-storyboard__clip${clip.hasMedia ? '' : ' is-missing'}`}
                style={{ flexGrow: Math.max(clip.durationSec, total * 0.04), flexBasis: 0 } as CSSProperties}
                onClick={open(clip.nodeId)} onKeyDown={keyOpen(clip.nodeId)}
                title={`#${clip.index} ${clip.title} · ${clip.startSec}s – ${Math.round((clip.startSec + clip.durationSec) * 100) / 100}s`}>
                <span>#{clip.index}</span>
                <span>{clip.durationSec ? clip.durationSec + 's' : '—'}</span>
              </div>
            ))}
          </div>}
      </Section>

      <Section title={en ? 'Final cut' : '成片'} extra={
        <button type="button" className="workflow-storyboard__btn is-primary" disabled={!plan.ready || mergeBusy} onClick={() => onMerge(plan.sourceNodeIds)} data-testid="storyboard-merge">
          <Sparkles size={12} />{mergeBusy ? (en ? 'Merging…' : '拼接中…') : (en ? `Merge ${plan.sourceNodeIds.length} clips in shot order` : `按镜号拼接 ${plan.sourceNodeIds.length} 段`)}
        </button>
      }>
        {!plan.ready && <p className="workflow-storyboard__empty" role="status">{plan.blockers.join(en ? '; ' : '；')}</p>}
        {view.final.mergedNodeIds.length > 0 && (
          <div className="workflow-storyboard__anchors">
            {view.final.mergedNodeIds.map((id, index) => (
              <div key={id} role="button" tabIndex={0} className="workflow-storyboard__card" onClick={open(id)} onKeyDown={keyOpen(id)}>
                <div className="workflow-storyboard__thumb is-empty"><Film size={18} /></div>
                <span className="workflow-storyboard__card-title">{index === 0 ? (en ? 'Latest cut' : '最新成片') : (en ? 'Earlier cut' : '较早成片')}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** 顶部「工作流 / 故事板」切换。 */
export function WorkflowViewSwitch({ value, onChange, language = 'zho', shotCount }: { value: 'workflow' | 'storyboard'; onChange: (next: 'workflow' | 'storyboard') => void; language?: Lang; shotCount: number }) {
  const en = language === 'en';
  return (
    <div className="workflow-view-switch" role="tablist" data-workflow-overlay aria-label={en ? 'View' : '视图'} onPointerDown={event => event.stopPropagation()}>
      <button type="button" role="tab" aria-selected={value === 'workflow'} onClick={() => onChange('workflow')}>{en ? 'Workflow' : '工作流'}</button>
      <button type="button" role="tab" aria-selected={value === 'storyboard'} onClick={() => onChange('storyboard')}>{en ? 'Storyboard' : '故事板'}{shotCount > 0 ? ' · ' + shotCount : ''}</button>
    </div>
  );
}
