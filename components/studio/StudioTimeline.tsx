import { Camera, Crosshair, History } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useStudioHubStore } from '../../stores/useStudioHubStore';
import { translations } from '../../utils/translations';
import { useWorkflowStore } from '../workflow/store';
import {
  buildWorkflowTimeline,
  filterTimelineRange,
  groupTimelineByDay,
  timelineRelativeTime,
  type TimelineRange,
  type WorkflowTimelineEntry,
} from '../workflow/timeline';
import { describeWorkflowRestore, restoreWorkflowToChangeSet, saveWorkflowTimelineSnapshot } from '../workflow/timelineActions';
import { useWorkflowTimelineEvents } from '../workflow/timelineEvents';

// Hub 里的画布 Timeline：一行 = 一个点 + 一句话 + 等宽 rev + 相对时间，点之间是手绘感的波浪细线。
// 参考：Sebastiano Guerriero「Timeline concept」（inspora posts/8-0），强调色换成 Hub 的青绿（--isl-mint）。
// 悬停 = 指向（底色 + 文字变亮）；选中 = 播放头（点发光、上方连线长成强调色）并展开可操作的动作。

const RANGES: TimelineRange[] = ['day', 'week', 'month'];
const EMPTY_EVENTS: never[] = [];

/** 竖向波浪线（一个周期 = 一行间距），viewBox 拉伸到行高。 */
function Wire({ active }: { active: boolean }) {
  const d = 'M6 0 C 10 8, 10 16, 6 24 S 2 40, 6 48 S 10 56, 6 64';
  return (
    <svg className="studio-timeline__wire" viewBox="0 0 12 64" preserveAspectRatio="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <path className="studio-timeline__wire-base" d={d} />
      <path className="studio-timeline__wire-lit" d={d} />
    </svg>
  );
}

export function StudioTimeline({ language, projectId, activeProjectId }: { language: 'en' | 'zho'; projectId: string | null; activeProjectId: string | null }) {
  const copy = translations[language].canvasTimeline;
  const project = useWorkflowStore(state => state.projects.find(item => item.id === projectId));
  const events = useWorkflowTimelineEvents(state => (projectId ? state.byProject[projectId] : undefined)) || EMPTY_EVENTS;
  const canFocus = useStudioHubStore(state => Boolean(state.handlers.focusNodes));
  const reduceMotion = Boolean(useReducedMotion());
  const [range, setRange] = useState<TimelineRange>('week');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  useEffect(() => { if (projectId) void useWorkflowTimelineEvents.getState().load(projectId); }, [projectId]);
  useEffect(() => { setSelectedId(null); setConfirmId(null); setCursor(0); }, [projectId, range]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 3200); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { listRef.current?.focus({ preventScroll: true }); }, [projectId]);

  const entries = useMemo(() => (project ? buildWorkflowTimeline(project, events, language) : []), [project, events, language]);
  const visible = useMemo(() => filterTimelineRange(entries, range, now), [entries, range, now]);
  const groups = useMemo(() => groupTimelineByDay(visible, language, now), [visible, language, now]);
  const changeSets = useMemo(() => new Map((project?.draftChangeSets || []).map(item => [item.id, item])), [project?.draftChangeSets]);
  const liveNodeIds = useMemo(() => new Set((project?.nodes || []).map(node => node.id)), [project?.nodes]);

  useEffect(() => {
    const id = visible[cursor]?.id;
    if (!id) return;
    listRef.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [cursor, visible, reduceMotion]);

  if (!project || !projectId) {
    return (
      <div className="studio-hub__pane">
        <header className="studio-hub__head"><h2>{copy.title}</h2></header>
        <p className="studio-hub__empty">{copy.noCanvas}</p>
      </div>
    );
  }

  const select = (entry: WorkflowTimelineEntry) => {
    setSelectedId(current => (current === entry.id ? null : entry.id));
    setConfirmId(null);
    setCursor(visible.indexOf(entry));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && confirmId) {
      // 先收起确认框；没有确认框时交给 Hub 关闭窗口。
      event.preventDefault();
      setConfirmId(null);
      listRef.current?.focus({ preventScroll: true });
      return;
    }
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(index => Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setCursor(event.key === 'Home' ? 0 : Math.max(0, visible.length - 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      const entry = visible[cursor];
      if (entry) { event.preventDefault(); select(entry); }
    }
  };

  const focusEntry = (entry: WorkflowTimelineEntry) => {
    const ids = entry.nodeIds.filter(id => liveNodeIds.has(id));
    if (!ids.length) return;
    const focus = useStudioHubStore.getState().handlers.focusNodes;
    if (focus?.(projectId, ids)) useStudioHubStore.getState().close();
  };

  const snapshotEntry = (entry: WorkflowTimelineEntry) => {
    const saved = saveWorkflowTimelineSnapshot(projectId, entry.changeSetId, copy.snapshotName(entry.revision));
    setNotice(saved ? copy.snapshotSaved(saved.name) : copy.restoreUnavailable);
  };

  const restoreEntry = (entry: WorkflowTimelineEntry) => {
    if (!entry.changeSetId) return;
    const result = restoreWorkflowToChangeSet(projectId, entry.changeSetId, copy.safetyName(project.draftVersion || 1));
    setConfirmId(null);
    setNotice(result.ok ? copy.restored(result.revision) : copy.restoreFailed);
    if (result.ok) setSelectedId(null);
  };

  const cursorId = visible[cursor]?.id;
  const activeDescendant = cursorId ? `${baseId}-${cursorId}` : undefined;
  const rows = groups.flatMap(group => [
    { type: 'marker' as const, key: group.key, label: group.label },
    ...group.entries.map(entry => ({ type: 'entry' as const, entry })),
  ]);

  return (
    <div className="studio-hub__pane studio-timeline">
      <header className="studio-hub__head">
        <h2>{copy.title}<span className="studio-hub__count">{copy.count(visible.length)}</span></h2>
        <div className="studio-timeline__range" role="radiogroup" aria-label={copy.rangeLabel}>
          {RANGES.map(item => (
            <button key={item} type="button" role="radio" aria-checked={range === item} className="studio-timeline__range-btn" onClick={() => setRange(item)}>
              {range === item && (
                <motion.span layoutId={`${baseId}-range-pill`} className="studio-timeline__range-pill" transition={reduceMotion ? { duration: 0 } : { type: 'spring', visualDuration: 0.26, bounce: 0.12 }} />
              )}
              <span className="studio-timeline__range-label">{copy.ranges[item]}</span>
            </button>
          ))}
        </div>
      </header>
      {notice && <p className="studio-timeline__notice" role="status">{notice}</p>}
      <div
        ref={listRef}
        className="studio-hub__scroll isl-scrollbar studio-timeline__scroll"
        role="listbox"
        tabIndex={0}
        aria-label={`${copy.listLabel}. ${copy.keyboardHint}`}
        aria-activedescendant={activeDescendant}
        onKeyDown={onKeyDown}
      >
        {visible.length === 0 ? <p className="studio-hub__empty">{copy.empty[range]}</p> : (
          <ol className="studio-timeline__rail" role="presentation">
            {rows.map((row, index) => {
              const next = rows[index + 1];
              const litBelow = Boolean(next && next.type === 'entry' && next.entry.id === selectedId);
              const wire = next ? <Wire active={litBelow} /> : null;
              if (row.type === 'marker') {
                return (
                  <li key={'marker-' + row.key} className="studio-timeline__marker" role="presentation">
                    {wire}
                    <span className="studio-timeline__dot" aria-hidden="true" />
                    <span className="studio-timeline__marker-label">{row.label}</span>
                  </li>
                );
              }
              const entry = row.entry;
              const selected = selectedId === entry.id;
              const isCursor = cursorId === entry.id;
              const changeSet = entry.changeSetId ? changeSets.get(entry.changeSetId) : undefined;
              const liveIds = entry.nodeIds.filter(id => liveNodeIds.has(id));
              const isActiveCanvas = projectId === activeProjectId && canFocus;
              const restoreInfo = selected && entry.changeSetId ? describeWorkflowRestore(projectId, entry.changeSetId) : null;
              const diff = changeSet ? copy.diff(
                changeSet.nodeChanges.filter(change => !change.before).length,
                changeSet.nodeChanges.filter(change => !change.after).length,
                changeSet.nodeChanges.filter(change => change.before && change.after).length,
                changeSet.connectionChanges.length,
              ) : copy.generationNote;
              const restoreTitle = restoreInfo?.ok ? copy.restore
                : restoreInfo?.reason === 'latest' ? copy.restoreLatest
                : restoreInfo?.reason === 'undone' ? copy.restoreUndone
                : copy.restoreUnavailable;
              return (
                <li
                  key={entry.id}
                  id={`${baseId}-${entry.id}`}
                  data-entry-id={entry.id}
                  role="option"
                  aria-selected={selected}
                  className="studio-timeline__row"
                  data-selected={selected ? 'true' : 'false'}
                  data-cursor={isCursor ? 'true' : 'false'}
                  data-undone={entry.undone ? 'true' : 'false'}
                >
                  {wire}
                  <button type="button" tabIndex={-1} className="studio-timeline__hit" onClick={() => select(entry)} onMouseEnter={() => setCursor(visible.indexOf(entry))}>
                    <span className="studio-timeline__dot" aria-hidden="true" />
                    <span className="studio-timeline__text" title={entry.text}>{entry.text}</span>
                    {entry.undone && <span className="studio-timeline__tag">{copy.undone}</span>}
                    <span className="studio-timeline__rev">rev {entry.revision}</span>
                    <time className="studio-timeline__time" dateTime={entry.at} title={new Date(entry.at).toLocaleString(language === 'zho' ? 'zh-CN' : 'en-US')}>{timelineRelativeTime(entry.at, language, now)}</time>
                  </button>
                  {selected && (
                    <motion.div
                      className="studio-timeline__detail"
                      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={reduceMotion ? { duration: 0 } : { type: 'spring', visualDuration: 0.24, bounce: 0 }}
                    >
                      {diff && <p className="studio-timeline__diff">{diff}</p>}
                      <div className="studio-timeline__actions">
                        <button
                          type="button"
                          className="studio-hub__btn"
                          disabled={!isActiveCanvas || !liveIds.length}
                          title={!isActiveCanvas ? copy.focusUnavailable : !liveIds.length ? copy.focusGone : copy.focus}
                          onClick={() => focusEntry(entry)}
                        ><Crosshair size={13} aria-hidden="true" />{copy.focus}</button>
                        {entry.kind === 'change' && (
                          <>
                            <button type="button" className="studio-hub__btn" disabled={!restoreInfo?.ok} title={restoreTitle} onClick={() => setConfirmId(entry.id)}><History size={13} aria-hidden="true" />{copy.restore}</button>
                            <button type="button" className="studio-hub__btn" disabled={!restoreInfo || (!restoreInfo.ok && restoreInfo.reason !== 'latest')} title={copy.saveSnapshot} onClick={() => snapshotEntry(entry)}><Camera size={13} aria-hidden="true" />{copy.saveSnapshot}</button>
                          </>
                        )}
                      </div>
                      {confirmId === entry.id && restoreInfo?.ok && (
                        <div className="studio-timeline__confirm" role="alertdialog" aria-label={copy.confirmTitle(restoreInfo.revision)}>
                          <strong>{copy.confirmTitle(restoreInfo.revision)}</strong>
                          <span>{copy.confirmBody(restoreInfo.undoCount, copy.safetyName(restoreInfo.currentRevision))}</span>
                          {restoreInfo.evicted && <span>{copy.confirmSnapshotFull(restoreInfo.evicted.name)}</span>}
                          <div>
                            <button type="button" className="studio-hub__btn" onClick={() => setConfirmId(null)}>{copy.cancel}</button>
                            <button type="button" className="studio-hub__btn is-primary" autoFocus onClick={() => restoreEntry(entry)}>{copy.confirmRestore}</button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {visible.length > 0 && <p className="studio-timeline__footer">{copy.footer}</p>}
      </div>
    </div>
  );
}
