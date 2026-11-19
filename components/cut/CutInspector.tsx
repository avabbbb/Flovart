// 属性面板：画面（缩放 / 位置 / 不透明度 + 关键帧）、音频（音量）、变速、文字样式、代理素材。
import { Diamond, Trash2 } from 'lucide-react';
import { cutStore, getCutProject } from '../../services/cut/cutStore';
import type { CutMediaEngine } from '../../services/cut/mediaEngine';
import { cancelCutProxy, clearCutProxy, setCutProxy } from '../../services/cut/proxyActions';
import {
  clipSpeed, clipsOnTrack, deleteClips, effectiveTextStyle, findSource, removeKeyframes, reorderClip, setKeyframe, transformAt, updateClip,
  type CutAnimatable, type CutClip, type CutClipPatch, type CutProject,
} from '../../services/cut/timeline';
import { CutFontPicker } from './CutFontPicker';

type Lang = 'zho' | 'en';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

export function CutInspector({ language, project, clip, playhead, engine, notify }: {
  language: Lang; project: CutProject; clip: CutClip | undefined; playhead: number; engine: CutMediaEngine | null;
  notify: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const zh = language === 'zho';
  if (!clip) return <p className="cut-inspector__empty">{zh ? '选中时间线上的片段来调整画面、音量、变速、文字或关键帧。按 ? 看快捷键。' : 'Select a clip to adjust transform, volume, speed, text or keyframes. Press ? for shortcuts.'}</p>;
  const store = cutStore.getState;
  const patch = (value: CutClipPatch, label: string) => {
    const result = store().commit(updateClip(getCutProject(), clip.id, value), label);
    if (!result.ok && result.error) notify(result.error, 'warning');
  };
  const source = findSource(project, clip.sourceId);
  const local = Math.max(0, Math.min(clip.duration, playhead - clip.start));
  const inside = playhead >= clip.start && playhead <= clip.start + clip.duration;
  const live = transformAt(clip, local);
  const siblings = clipsOnTrack(project, clip.trackId);
  const index = siblings.findIndex(item => item.id === clip.id);
  const proxy = clip.kind === 'video' && clip.sourceId && engine ? engine.proxyInfo(clip.sourceId) : null;
  const style = effectiveTextStyle(project, clip);

  const animatable = (property: CutAnimatable, label: string, min: number, max: number, step: number) => {
    const frames = clip.keyframes?.filter(frame => frame.property === property) || [];
    const onFrame = frames.find(frame => Math.abs(frame.time - local) < 1 / project.fps);
    const value = live[property];
    const setValue = (next: number) => {
      // 有关键帧时，改数值 = 在播放头处设 / 改关键帧（剪映行为）；没有时改静态值。
      if (frames.length && inside) store().commit(setKeyframe(getCutProject(), clip.id, { property, time: local, value: next }), 'keyframe');
      else patch({ transform: { [property]: next } }, label);
    };
    return (
      <label className="cut-field is-control cut-anim">
        <span>
          {label} <b>{property === 'opacity' ? `${Math.round(value * 100)}%` : value.toFixed(2)}</b>
          <button
            type="button"
            className={`cut-kf${onFrame ? ' is-on' : frames.length ? ' is-has' : ''}`}
            title={onFrame ? (zh ? '删除此处关键帧' : 'Remove keyframe here') : (zh ? '在播放头处加关键帧' : 'Add keyframe at playhead')}
            disabled={!inside}
            onClick={event => {
              event.preventDefault();
              if (onFrame) store().commit(removeKeyframes(getCutProject(), clip.id, { property, time: onFrame.time }), 'remove keyframe');
              else store().commit(setKeyframe(getCutProject(), clip.id, { property, time: local, value }), 'keyframe');
            }}
            data-testid={`cut-kf-${property}`}
          ><Diamond size={10} /></button>
        </span>
        <input type="range" min={min} max={max} step={step} value={value} onChange={event => setValue(Number(event.target.value))} />
      </label>
    );
  };

  return (
    <div className="cut-inspector__body" data-testid="cut-inspector">
      <div className="cut-field"><span>{zh ? '片段' : 'Clip'}</span><strong title={source?.name || clip.text}>{source?.name || (clip.kind === 'subtitle' ? (zh ? '字幕' : 'Subtitle') : clip.kind === 'text' ? (zh ? '文字' : 'Text') : clip.kind)}</strong></div>
      <div className="cut-field"><span>{zh ? '起点 / 时长' : 'Start / length'}</span><strong>{fmt(clip.start)} · {clip.duration.toFixed(2)}s</strong></div>

      {(clip.kind === 'video' || clip.kind === 'image') && (
        <section className="cut-section">
          <h3>{zh ? '画面' : 'Transform'}</h3>
          {animatable('scale', zh ? '缩放' : 'Scale', 0.1, 4, 0.01)}
          {animatable('x', zh ? '水平位置' : 'Position X', -1, 1, 0.005)}
          {animatable('y', zh ? '垂直位置' : 'Position Y', -1, 1, 0.005)}
          {animatable('opacity', zh ? '不透明度' : 'Opacity', 0, 1, 0.01)}
          {!!clip.keyframes?.length && <button type="button" className="iris-ghost-pill cut-pill" onClick={() => store().commit(removeKeyframes(getCutProject(), clip.id), 'clear keyframes')}>{zh ? `清除全部关键帧（${clip.keyframes.length}）` : `Clear keyframes (${clip.keyframes.length})`}</button>}
        </section>
      )}

      {(clip.kind === 'video' || clip.kind === 'audio') && (
        <section className="cut-section">
          <h3>{zh ? '音频与变速' : 'Audio & speed'}</h3>
          <label className="cut-field is-control">
            <span>{zh ? '音量' : 'Volume'} {Math.round(clip.volume * 100)}%{clip.kind === 'video' && source && !source.hasAudio ? (zh ? '（无音轨）' : ' (no audio)') : ''}</span>
            <input type="range" min={0} max={2} step={0.05} value={clip.volume} onChange={event => patch({ volume: Number(event.target.value) }, 'volume')} data-testid="cut-volume" />
          </label>
          <label className="cut-field is-control">
            <span>{zh ? '变速' : 'Speed'} {clipSpeed(clip)}×</span>
            <select className="cut-select" value={clipSpeed(clip)} onChange={event => patch({ speed: Number(event.target.value) }, 'speed')} data-testid="cut-speed">
              {SPEEDS.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
            </select>
          </label>
        </section>
      )}

      {clip.kind === 'video' && clip.sourceId && (
        <section className="cut-section">
          <h3>{zh ? '代理素材（只影响预览）' : 'Proxy (preview only)'}</h3>
          {proxy?.status === 'generating' ? (
            <div className="cut-field is-row">
              <div className="cut-export__bar"><span style={{ width: `${Math.round((proxy.progress ?? 0) * 100)}%` }} /></div>
              <span>{Math.round((proxy.progress ?? 0) * 100)}%</span>
              <button type="button" className="iris-ghost-pill cut-pill" onClick={() => cancelCutProxy(clip.sourceId!)}>{zh ? '取消' : 'Cancel'}</button>
            </div>
          ) : proxy?.status === 'ready' ? (
            <div className="cut-field is-row">
              <span className="cut-badge">{proxy.height}p</span>
              <button type="button" className="iris-ghost-pill cut-pill" onClick={() => void clearCutProxy(clip.sourceId!)} data-testid="cut-proxy-delete"><Trash2 size={12} />{zh ? '删除代理' : 'Delete proxy'}</button>
            </div>
          ) : (
            <div className="cut-field is-row">
              {([540, 720] as const).map(height => (
                <button key={height} type="button" className="iris-ghost-pill cut-pill" data-testid={`cut-proxy-${height}`} onClick={() => void setCutProxy(clip.sourceId!, height).then(result => notify(result.ok ? (zh ? `${height}p 代理已生成` : `${height}p proxy ready`) : (result.error || 'proxy failed'), result.ok ? 'success' : 'warning'))}>{height}p</button>
              ))}
            </div>
          )}
        </section>
      )}

      {(clip.kind === 'text' || clip.kind === 'subtitle') && (
        <section className="cut-section">
          <h3>{clip.kind === 'subtitle' ? (zh ? '字幕（样式统一在字幕面板改）' : 'Subtitle (style lives in the Subtitles panel)') : (zh ? '文字' : 'Text')}</h3>
          <label className="cut-field is-control">
            <textarea rows={2} value={clip.text || ''} onChange={event => patch({ text: event.target.value }, 'text')} data-testid="cut-text-input" />
          </label>
          {clip.kind === 'text' && (
            <>
              <CutFontPicker language={language} value={style.fontFamily} onChange={fontFamily => patch({ textStyle: { fontFamily } }, 'font')} />
              <label className="cut-field is-control"><span>{zh ? '字号' : 'Size'}</span><input type="range" min={0.03} max={0.2} step={0.005} value={style.size} onChange={event => patch({ textStyle: { size: Number(event.target.value) } }, 'text size')} /></label>
              <div className="cut-field is-row">
                <label className="cut-color"><span>{zh ? '颜色' : 'Color'}</span><input type="color" value={style.color} onChange={event => patch({ textStyle: { color: event.target.value } }, 'text color')} /></label>
                <label className="cut-color"><span>{zh ? '描边' : 'Stroke'}</span><input type="color" value={style.strokeColor || '#000000'} onChange={event => patch({ textStyle: { strokeColor: event.target.value, strokeWidth: style.strokeWidth || 0.08 } }, 'text stroke')} /></label>
                <label className="cut-check"><input type="checkbox" checked={!!style.background} onChange={event => patch({ textStyle: { background: event.target.checked } }, 'text backdrop')} />{zh ? '底色' : 'Backdrop'}</label>
              </div>
              <p className="cut-hint">{zh ? '位置：在预览里直接拖动文字框。' : 'Position: drag the text box in the preview.'}</p>
            </>
          )}
        </section>
      )}

      <div className="cut-field is-row">
        <button type="button" className="iris-ghost-pill cut-pill" disabled={index <= 0} onClick={() => store().commit(reorderClip(getCutProject(), clip.id, index - 1), 'reorder')}>{zh ? '← 前移' : '← Earlier'}</button>
        <button type="button" className="iris-ghost-pill cut-pill" disabled={index < 0 || index >= siblings.length - 1} onClick={() => store().commit(reorderClip(getCutProject(), clip.id, index + 1), 'reorder')}>{zh ? '后移 →' : 'Later →'}</button>
      </div>
      <button type="button" className="iris-ghost-pill cut-pill is-danger" onClick={() => { store().commit(deleteClips(getCutProject(), [clip.id]), 'delete'); store().select([]); }}><Trash2 size={13} />{zh ? '删除片段' : 'Delete clip'}</button>
    </div>
  );
}
