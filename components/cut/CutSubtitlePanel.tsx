// 字幕列表（剪映式）：逐条编辑文字与起止时间；Enter 在光标处拆成两条，行首 Backspace 并入上一条；
// SRT / VTT 导入导出；统一样式一次作用于全部字幕（字体、字号、颜色、描边、底色、位置）。
import { Download, FileUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cutStore, getCutProject } from '../../services/cut/cutStore';
import { cuesFromClips, formatCueTime, parseCueTime, parseSubtitleFile, toSrt, toVtt } from '../../services/cut/subtitles';
import {
  addSubtitle, clipEnd, deleteClips, importSubtitles, mergeSubtitleWithPrevious, setClipRange, setSubtitleStyle, splitSubtitleAtText,
  subtitleClips, updateClip, type CutClip, type CutTextStyle,
} from '../../services/cut/timeline';
import { CutFontPicker } from './CutFontPicker';
import { useCut } from './useCut';

type Lang = 'zho' | 'en';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TimeInput({ value, onCommit, label }: { value: number; onCommit: (seconds: number) => void; label: string }) {
  const [draft, setDraft] = useState(formatCueTime(value));
  useEffect(() => setDraft(formatCueTime(value)), [value]);
  const commit = () => {
    const parsed = parseCueTime(draft);
    if (parsed === null || Math.abs(parsed - value) < 1e-4) setDraft(formatCueTime(value));
    else onCommit(parsed);
  };
  return <input className="cut-sub__time" value={draft} aria-label={label} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); (event.target as HTMLInputElement).blur(); } }} />;
}

function SubtitleRow({ clip, index, language, active, focusRequest, onFocusHandled, onSeek, notify }: {
  clip: CutClip; index: number; language: Lang; active: boolean;
  focusRequest: { id: string; caret: number } | null; onFocusHandled: () => void; onSeek: (t: number) => void; notify: (message: string) => void;
}) {
  const zh = language === 'zho';
  const [draft, setDraft] = useState(clip.text || '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const store = cutStore.getState;
  useEffect(() => setDraft(clip.text || ''), [clip.text]);
  useEffect(() => {
    if (focusRequest?.id !== clip.id || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(focusRequest.caret, focusRequest.caret);
    onFocusHandled();
  }, [focusRequest, clip.id, onFocusHandled]);

  const commitText = (text = draft) => {
    if (text !== (clip.text || '')) store().commit(updateClip(getCutProject(), clip.id, { text }), 'edit subtitle');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      // 先把正在编辑的文字写回，再在光标处拆分。
      const withText = updateClip(getCutProject(), clip.id, { text: draft });
      const result = splitSubtitleAtText(withText.project, clip.id, target.selectionStart);
      if (!result.ok) { notify(result.error || 'split failed'); return; }
      store().commit(result, 'split subtitle');
      if (result.clipId) cutStore.setState({ selection: [result.clipId] });
      window.dispatchEvent(new CustomEvent('cut-subtitle-focus', { detail: { id: result.clipId, caret: 0 } }));
    } else if (event.key === 'Backspace' && target.selectionStart === 0 && target.selectionEnd === 0 && !event.nativeEvent.isComposing) {
      const withText = updateClip(getCutProject(), clip.id, { text: draft });
      const previous = subtitleClips(withText.project).filter(item => item.trackId === clip.trackId && item.start < clip.start).pop();
      if (!previous) return;
      event.preventDefault();
      const caret = (previous.text || '').length;
      const result = mergeSubtitleWithPrevious(withText.project, clip.id);
      if (!result.ok) return;
      store().commit(result, 'merge subtitle');
      window.dispatchEvent(new CustomEvent('cut-subtitle-focus', { detail: { id: previous.id, caret } }));
    }
  };

  return (
    <li className={`cut-sub${active ? ' is-active' : ''}`} data-testid="cut-subtitle-row" data-clip-id={clip.id}>
      <div className="cut-sub__meta">
        <button type="button" className="cut-sub__index" onClick={() => { onSeek(clip.start); store().select([clip.id]); }} title={zh ? '跳到这里' : 'Jump here'}>{index + 1}</button>
        <TimeInput value={clip.start} label={zh ? '开始' : 'Start'} onCommit={start => { const result = setClipRange(getCutProject(), clip.id, start, clipEnd(clip)); if (result.ok) store().commit(result, 'subtitle time'); else notify(result.error || ''); }} />
        <span>→</span>
        <TimeInput value={clipEnd(clip)} label={zh ? '结束' : 'End'} onCommit={end => { const result = setClipRange(getCutProject(), clip.id, clip.start, end); if (result.ok) store().commit(result, 'subtitle time'); else notify(result.error || ''); }} />
        <button type="button" className="iris-icon-btn is-small" aria-label={zh ? '删除' : 'Delete'} onClick={() => store().commit(deleteClips(getCutProject(), [clip.id]), 'delete subtitle')}><Trash2 size={11} /></button>
      </div>
      <textarea
        ref={ref}
        className="cut-sub__text"
        rows={1}
        value={draft}
        placeholder={zh ? '输入字幕…' : 'Subtitle text…'}
        onFocus={() => { store().select([clip.id]); onSeek(clip.start + 0.001); }}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => commitText()}
        onKeyDown={onKeyDown}
        data-testid="cut-subtitle-text"
      />
    </li>
  );
}

export function CutSubtitlePanel({ language, onSeek, notify }: { language: Lang; onSeek: (t: number) => void; notify: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void }) {
  const zh = language === 'zho';
  const project = useCut(state => state.doc.present);
  const playhead = useCut(state => state.playhead);
  const selection = useCut(state => state.selection);
  const subs = subtitleClips(project);
  const style = project.subtitleStyle;
  const fileRef = useRef<HTMLInputElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; caret: number } | null>(null);
  useEffect(() => {
    const onFocus = (event: Event) => setFocusRequest((event as CustomEvent<{ id: string; caret: number }>).detail);
    window.addEventListener('cut-subtitle-focus', onFocus);
    return () => window.removeEventListener('cut-subtitle-focus', onFocus);
  }, []);

  const setStyle = (patch: Partial<CutTextStyle>) => cutStore.getState().commit(setSubtitleStyle(getCutProject(), patch), 'subtitle style');

  const addAtPlayhead = () => {
    const start = playhead;
    const result = addSubtitle(getCutProject(), { start, end: start + 2, text: '' });
    if (!result.ok) { notify(zh ? '播放头处已有字幕，换个位置再加。' : 'There is already a subtitle at the playhead.', 'warning'); return; }
    cutStore.getState().commit(result, 'add subtitle');
    setFocusRequest({ id: result.clipId!, caret: 0 });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseSubtitleFile(file.name, await file.text());
      const result = importSubtitles(getCutProject(), parsed.cues, { replace: true });
      if (!result.ok) { notify(zh ? '文件里没有可用的字幕。' : 'No usable cues in that file.', 'warning'); return; }
      cutStore.getState().commit(result, 'import subtitles');
      notify(zh ? `已导入 ${parsed.cues.length} 条字幕${parsed.skipped ? `（跳过 ${parsed.skipped} 条）` : ''}` : `Imported ${parsed.cues.length} cues${parsed.skipped ? ` (${parsed.skipped} skipped)` : ''}`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  return (
    <div className="cut-subs" data-testid="cut-subtitle-panel">
      <div className="cut-subs__actions">
        <button type="button" className="iris-ghost-pill cut-pill" onClick={addAtPlayhead} data-testid="cut-subtitle-add"><Plus size={12} />{zh ? '新增' : 'Add'}</button>
        <button type="button" className="iris-ghost-pill cut-pill" onClick={() => fileRef.current?.click()}><FileUp size={12} />SRT / VTT</button>
        <input ref={fileRef} type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" hidden onChange={event => { void onImport(event.target.files?.[0]); event.target.value = ''; }} data-testid="cut-subtitle-file" />
        <button type="button" className="iris-ghost-pill cut-pill" disabled={!subs.length} onClick={() => download('subtitles.srt', toSrt(cuesFromClips(project.clips)), 'application/x-subrip')}><Download size={12} />SRT</button>
        <button type="button" className="iris-ghost-pill cut-pill" disabled={!subs.length} onClick={() => download('subtitles.vtt', toVtt(cuesFromClips(project.clips)), 'text/vtt')}><Download size={12} />VTT</button>
      </div>
      <details className="cut-subs__style" open>
        <summary>{zh ? `统一样式（作用于全部 ${subs.length} 条）` : `Style for all ${subs.length} subtitles`}</summary>
        <CutFontPicker language={language} value={style.fontFamily} onChange={fontFamily => setStyle({ fontFamily })} />
        <label className="cut-field is-control"><span>{zh ? '字号' : 'Size'}</span><input type="range" min={0.025} max={0.15} step={0.0025} value={style.size} onChange={event => setStyle({ size: Number(event.target.value) })} /></label>
        <div className="cut-field is-row">
          <label className="cut-color"><span>{zh ? '文字' : 'Text'}</span><input type="color" value={style.color} onChange={event => setStyle({ color: event.target.value })} /></label>
          <label className="cut-color"><span>{zh ? '描边' : 'Stroke'}</span><input type="color" value={style.strokeColor || '#000000'} onChange={event => setStyle({ strokeColor: event.target.value })} /></label>
          <label className="cut-check"><input type="checkbox" checked={!!style.bold} onChange={event => setStyle({ bold: event.target.checked })} />{zh ? '粗体' : 'Bold'}</label>
        </div>
        <label className="cut-field is-control"><span>{zh ? '描边粗细' : 'Stroke width'}</span><input type="range" min={0} max={0.3} step={0.01} value={style.strokeWidth ?? 0} onChange={event => setStyle({ strokeWidth: Number(event.target.value) })} /></label>
        <div className="cut-field is-row">
          <label className="cut-check"><input type="checkbox" checked={!!style.background} onChange={event => setStyle({ background: event.target.checked })} />{zh ? '底色' : 'Backdrop'}</label>
          <label className="cut-color"><input type="color" value={style.backgroundColor?.startsWith('#') ? style.backgroundColor : '#000000'} onChange={event => setStyle({ backgroundColor: event.target.value, background: true })} /></label>
          <button type="button" className="iris-ghost-pill cut-pill" onClick={() => cutStore.getState().commit(setSubtitleStyle(getCutProject(), {}, { clearOverrides: true }), 'reset subtitle overrides')}>{zh ? '清除单条样式' : 'Clear overrides'}</button>
        </div>
        <label className="cut-field is-control"><span>{zh ? '位置（也可在预览里拖动）' : 'Position (or drag in the preview)'}</span><input type="range" min={0.05} max={0.95} step={0.01} value={style.y} onChange={event => setStyle({ y: Number(event.target.value) })} /></label>
      </details>
      {subs.length === 0 ? (
        <p className="cut-bin__empty">{zh ? '还没有字幕。点「新增」在播放头处加一条，或导入 SRT / VTT。' : 'No subtitles yet. Add one at the playhead or import an SRT / VTT file.'}</p>
      ) : (
        <ol className="cut-subs__list">
          {subs.map((clip, index) => (
            <SubtitleRow
              key={clip.id}
              clip={clip}
              index={index}
              language={language}
              active={selection.includes(clip.id) || (playhead >= clip.start && playhead < clipEnd(clip))}
              focusRequest={focusRequest}
              onFocusHandled={() => setFocusRequest(null)}
              onSeek={onSeek}
              notify={message => notify(message, 'warning')}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
