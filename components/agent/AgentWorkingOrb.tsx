// Agent 工作状态：奶蛙思考动画（同一作者 OfferU 的 NaiwaThinking）+ 静态标签的全圆角胶囊。
// 动效只在奶蛙身上，字是静的、无扫光 / 打字机；换阶段时旧胶囊模糊 + 右滑 + 淡出，新胶囊淡入。
// 状态全部来自真实事件（agentWorkingPhase），写在 data-state 上；奶蛙本身只有一种动作，不按状态变形。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NaiwaThinking } from '../brand/NaiwaThinking';
import type { AgentOrbState } from './agentWorkingPhase';
import '../../styles/agentWorking.css';
import '../../styles/fluid.css';

/** 换阶段的离场时长，与 agentWorking.css 里 .agent-orb-phase[data-leaving] 的 --motion-medium 对齐。 */
const LEAVE_MS = 320;

/** 奶蛙尺寸：20（行内，不带气泡）/ 32（工作胶囊，带「…」气泡）。小于 20 认不出是奶蛙，不提供。 */
export type AgentOrbSize = 20 | 32;

/** 只要一只奶蛙（运行中的工具行、输入框「运行中」）。20px 不带气泡。 */
export function AgentOrbIcon({ state, size = 20, label }: { state: AgentOrbState; size?: AgentOrbSize; label?: string }) {
  return (
    <span className="agent-orb" data-state={state} data-size={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <NaiwaThinking size={size} bubble={size >= 32} />
    </span>
  );
}

type Phase = { key: string; label: string; state: AgentOrbState };

/**
 * 运行中的胶囊。meta 放在胶囊尾部（步数 / 用时），不参与换场动画；里面带 .agent-orb-meta-extra 的部分在窄容器里先藏。
 * 外层 .agent-orb-host 是 inline-size 容器：胶囊按所在栏宽收紧，标签省略号截断，完整文案在 title 与读屏里都在。
 */
export function AgentWorkingOrb({ label, state, meta, size = 32 }: {
  label: string;
  state: AgentOrbState;
  meta?: ReactNode;
  size?: AgentOrbSize;
}) {
  const current: Phase = { key: state + '|' + label, label, state };
  const [leaving, setLeaving] = useState<Phase | null>(null);
  const previous = useRef<Phase>(current);

  useEffect(() => {
    if (previous.current.key === current.key) return;
    setLeaving(previous.current);
    previous.current = current;
    const timer = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(timer);
    // current 每次渲染都是新对象，只按 key 判断阶段是否变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.key]);

  return (
    <div className="agent-orb-host">
      <div className="agent-orb-pill" data-size={size} data-state={state} data-testid="agent-working-orb" role="status" aria-live="polite" title={label + '…'}>
        <span className="agent-orb-stack">
          {leaving && <OrbPhase key={'out-' + leaving.key} phase={leaving} size={size} leaving />}
          <OrbPhase key={'in-' + current.key} phase={current} size={size} />
        </span>
        {meta != null && meta !== '' && <span className="agent-orb-meta">{meta}</span>}
      </div>
    </div>
  );
}

function OrbPhase({ phase, size, leaving }: { phase: Phase; size: AgentOrbSize; leaving?: boolean }) {
  return (
    <span className="agent-orb-phase" data-leaving={leaving ? '' : undefined} aria-hidden={leaving || undefined}>
      <span className="agent-orb" data-state={phase.state} data-size={size} aria-hidden="true"><NaiwaThinking size={size} bubble={size >= 32} /></span>
      <span className="agent-orb-label">{phase.label}…</span>
    </span>
  );
}
