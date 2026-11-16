// 视频节点内嵌裁剪条（P1-5）：替代 TrimDialog 弹窗，就地设置入出点；产物仍走 video.trim@1 生成新版本，不覆盖原视频。
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { createTrimState, formatTrimTime, setTrimRange, trimKeyReducer, trimPlaybackGuard, type TrimState } from './trimKeys';

export interface WorkflowVideoTrimBarProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  durationSec: number;
  currentTimeSec: number;
  busy?: boolean;
  language?: 'zh' | 'en';
  onConfirm: (startSec: number, endSec: number) => void;
  onCancel: () => void;
}

export function WorkflowVideoTrimBar({ videoRef, durationSec, currentTimeSec, busy, language = 'zh', onConfirm, onCancel }: WorkflowVideoTrimBarProps) {
  const en = language === 'en';
  const [state, setState] = useState<TrimState>(() => createTrimState(durationSec, currentTimeSec));
  const rootRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // 时长在元数据加载后才知道：首次拿到时把出点放到片尾。
  useEffect(() => {
    if (durationSec > 0 && stateRef.current.durationSec !== durationSec) {
      setState(previous => previous.durationSec > 0 ? { ...previous, durationSec } : createTrimState(durationSec, currentTimeSec));
    }
  }, [currentTimeSec, durationSec]);

  useEffect(() => { rootRef.current?.focus(); }, []);

  // 播放头跟随 <video>；预览播放到出点自动停。
  useEffect(() => {
    const guard = trimPlaybackGuard(stateRef.current, currentTimeSec);
    if (guard.stop) {
      videoRef.current?.pause();
      if (videoRef.current) videoRef.current.currentTime = guard.playheadSec;
      setState(previous => ({ ...previous, playing: false, playheadSec: guard.playheadSec }));
    } else if (guard.playheadSec !== stateRef.current.playheadSec) {
      setState(previous => ({ ...previous, playheadSec: guard.playheadSec }));
    }
  }, [currentTimeSec, videoRef]);

  const seek = (sec: number) => { if (videoRef.current) videoRef.current.currentTime = sec; };

  const handleKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (busy) return;
    if ((event.target as HTMLElement).tagName === 'INPUT' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return; // 让滑块自己处理左右键
    const result = trimKeyReducer(stateRef.current, { key: event.key, shiftKey: event.shiftKey });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (result.effect === 'confirm') { onConfirm(result.state.inSec, result.state.outSec); return; }
    if (result.effect === 'cancel') { videoRef.current?.pause(); onCancel(); return; }
    if (result.effect === 'seek') { videoRef.current?.pause(); seek(result.state.playheadSec); }
    if (result.effect === 'toggle-play') {
      const video = videoRef.current;
      if (video) {
        if (result.state.playing) {
          if (result.state.playheadSec < result.state.inSec || result.state.playheadSec >= result.state.outSec) video.currentTime = result.state.inSec;
          void video.play()?.catch?.(() => undefined);
        } else video.pause();
      }
    }
    setState(result.state);
  };

  const duration = Math.max(state.durationSec, 0.01);
  const percent = (sec: number) => `${(sec / duration) * 100}%`;
  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="workflow-node__trim-bar"
      data-workflow-overlay
      data-testid="video-trim-bar"
      role="group"
      aria-label={en ? 'Trim video: I/O set in/out, ←/→ move selection, ↑/↓ step, Shift fine, Space play' : '裁剪视频：I/O 设入出点，←/→ 移动选区，↑/↓ 步进，Shift 精调，空格播放'}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={handleKey}
    >
      <div className="workflow-node__trim-track">
        <div className="workflow-node__trim-selection" style={{ left: percent(state.inSec), width: percent(state.outSec - state.inSec) }} />
        <div className="workflow-node__trim-playhead" style={{ left: percent(state.playheadSec) }} />
        <input type="range" aria-label={en ? 'In point' : '入点'} min={0} max={duration} step={0.01} value={state.inSec}
          onChange={event => { const next = setTrimRange(state, Number(event.target.value), state.outSec); setState(next); seek(next.inSec); }} />
        <input type="range" aria-label={en ? 'Out point' : '出点'} min={0} max={duration} step={0.01} value={state.outSec}
          onChange={event => { const next = setTrimRange(state, state.inSec, Number(event.target.value)); setState(next); seek(next.outSec); }} />
      </div>
      <div className="workflow-node__trim-meta">
        <span data-testid="trim-range">{formatTrimTime(state.inSec)} – {formatTrimTime(state.outSec)}</span>
        <span className="workflow-node__trim-length">{(state.outSec - state.inSec).toFixed(2)}s</span>
        <span style={{ flex: 1 }} />
        <button type="button" disabled={busy} onClick={() => { videoRef.current?.pause(); onCancel(); }}>{en ? 'Cancel' : '取消'}</button>
        <button type="button" className="is-primary" disabled={busy || state.outSec - state.inSec <= 0} onClick={() => onConfirm(state.inSec, state.outSec)}>
          {busy ? (en ? 'Trimming…' : '剪辑中…') : (en ? 'Trim as new take' : '剪成新版本')}
        </button>
      </div>
    </div>
  );
}
