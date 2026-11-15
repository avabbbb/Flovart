import { ArrowDown, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { describeAgentLinkIssue } from '../../services/agentLinkIssue';
import { useAgentActivityStore, type AgentActivityEntry } from '../../stores/useAgentActivityStore';
import { useAgentConnectionStore, type AgentLinkEvent } from '../../stores/useAgentConnectionStore';
import { AgentCopyButton } from './AgentCopyButton';
import { linkStatusLabel } from './AgentLinkStatus';
import '../../styles/agentLink.css';

type Lang = 'en' | 'zho';
export type RunLogLevel = 'info' | 'ok' | 'run' | 'warn' | 'error';

export interface RunLogLine {
  id: string;
  at: string;
  level: RunLogLevel;
  /** Filter key: 'link' for connection events, otherwise the agent / source. */
  channel: string;
  who: string;
  text: string;
}

const COMMAND_LABELS: Record<string, [string, string]> = {
  status: ['读取状态', 'Read status'],
  'agent.turn': ['Agent 回合', 'Agent turn'],
  'workflow.inspect': ['查看画布', 'Read canvas'],
  'workflow.selection.get': ['查看选中内容', 'Read selection'],
  'workflow.apply': ['批量修改画布', 'Apply canvas changes'],
  'workflow.node.create': ['创建节点', 'Create node'],
  'workflow.node.create-connected': ['创建并连接节点', 'Create connected node'],
  'workflow.node.update': ['修改节点', 'Update node'],
  'workflow.node.delete': ['删除节点', 'Delete node'],
  'workflow.node.move': ['移动节点', 'Move node'],
  'workflow.node.resize': ['调整节点大小', 'Resize node'],
  'workflow.node.run': ['运行节点', 'Run node'],
  'workflow.node.stop': ['停止节点', 'Stop node'],
  'workflow.generate': ['生成', 'Generate'],
  'workflow.models.list': ['查看模型', 'List models'],
  'workflow.note.write': ['写备注', 'Write note'],
  'workflow.media.import': ['导入素材', 'Import media'],
  'workflow.node.tool': ['节点工具', 'Node tool'],
  'workflow.connect': ['连接节点', 'Connect nodes'],
  'workflow.disconnect': ['断开连接', 'Disconnect nodes'],
  'workflow.select': ['选中节点', 'Select nodes'],
  'workflow.viewport.set': ['移动视角', 'Move view'],
};

const SOURCE_LABELS: Record<string, [string, string]> = {
  cli: ['命令行', 'CLI'],
  mcp: ['外部 Agent', 'External agent'],
  agent: ['内置助手', 'Built-in assistant'],
};

const pick = (pair: [string, string] | undefined, language: Lang, fallback: string) => (pair ? (language === 'zho' ? pair[0] : pair[1]) : fallback);

function clock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function activityLine(entry: AgentActivityEntry, language: Lang): RunLogLine {
  const level: RunLogLevel = entry.status === 'ok' ? 'ok' : entry.status === 'error' ? 'error' : 'run';
  const parts = [pick(COMMAND_LABELS[entry.command], language, entry.command)];
  if (entry.durationMs !== null) parts.push(`${entry.durationMs} ms`);
  if (entry.summary) parts.push(entry.summary);
  if (entry.error) parts.push(entry.error.code ? `${entry.error.code}: ${entry.error.message}` : entry.error.message);
  return {
    id: entry.id,
    at: entry.at,
    level,
    channel: entry.agentIdentity || entry.source,
    who: entry.agentIdentity || pick(SOURCE_LABELS[entry.source], language, entry.source),
    text: parts.join(' · '),
  };
}

export function linkLine(event: AgentLinkEvent, language: Lang): RunLogLine {
  const level: RunLogLevel = event.status === 'ready' ? 'ok'
    : event.status === 'connecting' ? 'info'
      : event.status === 'offline' && (!event.issueKind || event.issueKind === 'not_configured') ? 'warn'
        : 'error';
  const status = linkStatusLabel(event.status, false, language, event.issueKind);
  const issue = event.issueKind ? describeAgentLinkIssue(event.issueKind, language) : null;
  const text = [status, issue ? `${issue.title} — ${issue.next}` : '', event.url && event.status !== 'offline' ? event.url : '']
    .filter(Boolean).join(' · ');
  return { id: event.id, at: event.at, level, channel: 'link', who: language === 'zho' ? '连接' : 'Link', text };
}

const LEVEL_LABEL: Record<RunLogLevel, string> = { info: 'INFO', ok: 'OK', run: 'RUN', warn: 'WARN', error: 'ERR' };

export function runLogText(lines: RunLogLine[]) {
  return lines.map(line => `${clock(line.at)} ${LEVEL_LABEL[line.level].padEnd(4)} [${line.who}] ${line.text}`).join('\n');
}

/** Pixels from the bottom that still count as "following" the log. */
const STICK_THRESHOLD = 24;

export function AgentRunLog({ language = 'zho' }: { language?: Lang }) {
  const zh = language === 'zho';
  const entries = useAgentActivityStore(state => state.entries);
  const clearEntries = useAgentActivityStore(state => state.clearEntries);
  const events = useAgentConnectionStore(state => state.events);
  const clearEvents = useAgentConnectionStore(state => state.clearEvents);
  const [filter, setFilter] = useState('all');
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const scroller = useRef<HTMLOListElement>(null);
  const lastCount = useRef(0);

  const lines = useMemo(() => [
    ...entries.map(entry => activityLine(entry, language)),
    ...events.map(event => linkLine(event, language)),
  ].sort((a, b) => a.at.localeCompare(b.at)), [entries, events, language]);
  const channels = useMemo(() => {
    const seen = new Map<string, string>();
    lines.forEach(line => { if (line.channel !== 'link' && !seen.has(line.channel)) seen.set(line.channel, line.who); });
    return [...seen.entries()];
  }, [lines]);
  const visible = useMemo(() => (filter === 'all' ? lines : lines.filter(line => line.channel === filter)), [lines, filter]);

  // Follow the tail only while the reader is at the bottom; scrolling up pauses it.
  useLayoutEffect(() => {
    const element = scroller.current;
    const added = visible.length - lastCount.current;
    lastCount.current = visible.length;
    if (!element) return;
    if (follow) {
      element.scrollTop = element.scrollHeight;
      setUnseen(0);
    } else if (added > 0) {
      setUnseen(count => count + added);
    }
  }, [visible, follow]);

  useEffect(() => { setUnseen(0); }, [filter]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_THRESHOLD;
    if (atBottom !== follow) setFollow(atBottom);
    if (atBottom) setUnseen(0);
  };

  const jumpToLatest = () => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
    setFollow(true);
    setUnseen(0);
  };

  const t = zh
    ? { title: '运行日志', show: '筛选', all: '全部', link: '连接', count: `${visible.length} 条`, copy: '复制日志', copied: '已复制', clear: '清空日志', empty: '还没有记录。连接变化和 Agent 的每一步都会实时出现在这里。', paused: '已暂停自动滚动', latest: unseen > 0 ? `${unseen} 条新日志` : '回到最新', follow: '自动滚动' }
    : { title: 'Run log', show: 'Filter', all: 'All', link: 'Link', count: `${visible.length} lines`, copy: 'Copy log', copied: 'Copied', clear: 'Clear log', empty: 'Nothing yet. Connection changes and every agent step appear here live.', paused: 'Auto-scroll paused', latest: unseen > 0 ? `${unseen} new` : 'Jump to latest', follow: 'Auto-scroll' };

  return (
    <section className="agent-runlog" data-testid="agent-run-log" aria-labelledby="agent-run-log-title">
      <header className="agent-runlog__bar">
        <h2 id="agent-run-log-title" className="agent-runlog__title">{t.title}</h2>
        <span className="agent-runlog__count">{t.count}</span>
        <label className="agent-runlog__filter">
          <span className="agent-runlog__filter-label">{t.show}</span>
          <select value={filter} onChange={event => setFilter(event.target.value)} aria-label={t.show}>
            <option value="all">{t.all}</option>
            <option value="link">{t.link}</option>
            {channels.map(([channel, who]) => <option key={channel} value={channel}>{who}</option>)}
          </select>
        </label>
        <span className="agent-runlog__actions">
          <AgentCopyButton text={runLogText(visible)} label={t.copy} copiedLabel={t.copied} />
          <button
            type="button"
            className="agent-copy-btn"
            title={t.clear}
            aria-label={t.clear}
            disabled={lines.length === 0}
            onClick={() => { clearEntries(); clearEvents(); setUnseen(0); setFollow(true); }}
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </span>
      </header>
      <div className="agent-runlog__viewport">
        {visible.length === 0 ? (
          <p className="agent-runlog__empty">{t.empty}</p>
        ) : (
          <ol ref={scroller} className="agent-runlog__lines" onScroll={onScroll} data-testid="agent-activity-feed" aria-live={follow ? 'polite' : 'off'}>
            {visible.map(line => (
              <li key={line.id} className={`agent-runlog__line is-${line.level}`} data-level={line.level}>
                <time dateTime={line.at}>{clock(line.at)}</time>
                <span className="agent-runlog__level">{LEVEL_LABEL[line.level]}</span>
                <span className="agent-runlog__msg"><span className="agent-runlog__who">[{line.who}]</span> {line.text}</span>
              </li>
            ))}
          </ol>
        )}
        {!follow && visible.length > 0 && (
          <button type="button" className="agent-runlog__jump" onClick={jumpToLatest} data-testid="agent-run-log-jump" title={t.paused}>
            <ArrowDown size={12} aria-hidden="true" />
            <span>{t.latest}</span>
          </button>
        )}
      </div>
    </section>
  );
}
