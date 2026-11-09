import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

// 轻量 Markdown 渲染：只产出 React 元素、不拼 HTML，Agent 输出无法注入标签；链接只放行 http(s)/mailto。
const STAR = String.fromCharCode(42);
const TICK = String.fromCharCode(96);
const FENCE = TICK.repeat(3);
const WORD = /[A-Za-z0-9]/;

type Align = 'left' | 'center' | 'right' | undefined;
export type AgentMarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
  | { kind: 'rule' };

const HEADING = /^(#{1,6})[ ]+(.+)$/;
const BULLET = new RegExp('^[ ]{0,3}[-+•' + STAR + '][ ]+(.+)$');
const ORDERED = /^[ ]{0,3}([0-9]{1,9})[.)][ ]+(.+)$/;

const isBlank = (line: string) => line.trim() === '';
const headingOf = (line: string) => HEADING.exec(line.trim());

function isRule(line: string) {
  const compact = line.replace(/[ ]/g, '');
  return compact.length >= 3 && new Set(compact).size === 1 && ('-_' + STAR).includes(compact[0]);
}

function splitRow(line: string) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map(cell => cell.trim());
}

const isTableSep = (line: string) => /^[ |:-]+$/.test(line) && line.includes('-') && line.includes('|');
const startsTable = (lines: string[], i: number) => lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]);

function startsBlock(lines: string[], i: number) {
  const line = lines[i];
  const trimmed = line.trim();
  return trimmed.startsWith(FENCE) || Boolean(headingOf(line)) || isRule(line) || trimmed.startsWith('>')
    || BULLET.test(line) || ORDERED.test(line) || startsTable(lines, i);
}

export function parseAgentMarkdown(source: string): AgentMarkdownBlock[] {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: AgentMarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (isBlank(line)) { i++; continue; }
    if (trimmed.startsWith(FENCE)) {
      const lang = trimmed.slice(3).trim().split(' ')[0] || '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(FENCE)) { body.push(lines[i]); i++; }
      // 未闭合的围栏（流式输出途中）直接吃到末尾
      i++;
      blocks.push({ kind: 'code', lang, code: body.join('\n') });
      continue;
    }
    const heading = headingOf(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].replace(/[ ]+#+[ ]{0,}$/, '') });
      i++;
      continue;
    }
    if (isRule(line)) { blocks.push({ kind: 'rule' }); i++; continue; }
    if (startsTable(lines, i)) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map<Align>(cell => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : undefined));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
      blocks.push({ kind: 'table', header, align, rows });
      continue;
    }
    if (trimmed.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { body.push(lines[i].trim().replace(/^>[ ]?/, '')); i++; }
      blocks.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = !bullet;
      const items: string[] = [];
      while (i < lines.length) {
        const match = isOrdered ? ORDERED.exec(lines[i]) : BULLET.exec(lines[i]);
        if (match) { items.push(isOrdered ? match[2] : match[1]); i++; continue; }
        // 缩进续行并入上一项
        if (items.length && !isBlank(lines[i]) && /^[ ]{2,}/.test(lines[i]) && !startsBlock(lines, i)) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, start: ordered && isOrdered ? Number(ordered[1]) : 1, items });
      continue;
    }
    const body: string[] = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) { body.push(lines[i]); i++; }
    blocks.push({ kind: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buffer = '';
  let i = 0;
  let k = 0;
  const key = () => keyPrefix + '-' + k++;
  const flush = () => { if (buffer) { out.push(buffer); buffer = ''; } };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') { flush(); out.push(<br key={key()} />); i++; continue; }
    if (ch === TICK) {
      const end = text.indexOf(TICK, i + 1);
      if (end > i + 1) {
        flush();
        out.push(<code key={key()} className="agent-md__inline-code">{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    if (ch === STAR || ch === '_') {
      const marker = text[i + 1] === ch ? ch + ch : ch;
      const end = text.indexOf(marker, i + marker.length);
      const inner = end > i + marker.length ? text.slice(i + marker.length, end) : '';
      // 下划线只在词边界生效，避免把 snake_case 当成斜体
      const atBoundary = ch !== '_' || ((i === 0 || !WORD.test(text[i - 1])) && !WORD.test(text[end + marker.length] || ''));
      if (inner && inner.trim() === inner && atBoundary) {
        flush();
        const children = renderInline(inner, key());
        out.push(marker.length === 2 ? <strong key={key()}>{children}</strong> : <em key={key()}>{children}</em>);
        i = end + marker.length;
        continue;
      }
    }
    if (ch === '[') {
      const close = text.indexOf('](', i + 1);
      const end = close > i ? text.indexOf(')', close + 2) : -1;
      if (close > i && end > close) {
        const label = text.slice(i + 1, close);
        const href = text.slice(close + 2, end).trim();
        if (/^(https?:|mailto:)/i.test(href) && !label.includes('\n')) {
          flush();
          out.push(<a key={key()} href={href} target="_blank" rel="noreferrer noopener">{renderInline(label, key())}</a>);
          i = end + 1;
          continue;
        }
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

function CodeBlock({ lang, code, en }: { lang: string; code: string; en: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }, () => undefined);
  };
  const label = en ? 'Copy code' : '复制代码';
  return (
    <div className="agent-md__code">
      <div className="agent-md__code-head">
        <span>{lang || 'text'}</span>
        <button type="button" onClick={copy} aria-label={label} title={label}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? (en ? 'Copied' : '已复制') : (en ? 'Copy' : '复制')}</span>
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const;

export function AgentMarkdown({ text, language = 'zho' }: { text: string; language?: 'en' | 'zho' }) {
  const en = language === 'en';
  const blocks = useMemo(() => parseAgentMarkdown(text), [text]);
  return (
    <div className="agent-md">
      {blocks.map((block, index) => {
        const key = 'b' + index;
        switch (block.kind) {
          case 'heading': {
            const Tag = HEADING_TAGS[block.level - 1];
            return <Tag key={key} className={'agent-md__h agent-md__h' + block.level}>{renderInline(block.text, key)}</Tag>;
          }
          case 'paragraph':
            return <p key={key}>{renderInline(block.text, key)}</p>;
          case 'code':
            return <CodeBlock key={key} lang={block.lang} code={block.code} en={en} />;
          case 'list': {
            const items = block.items.map((item, j) => <li key={j}>{renderInline(item, key + '-' + j)}</li>);
            return block.ordered ? <ol key={key} start={block.start}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
          case 'quote':
            return <blockquote key={key}><AgentMarkdown text={block.text} language={language} /></blockquote>;
          case 'table':
            return (
              <div key={key} className="agent-md__table">
                <table>
                  <thead><tr>{block.header.map((cell, j) => <th key={j} style={{ textAlign: block.align[j] }}>{renderInline(cell, key + '-h' + j)}</th>)}</tr></thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>{block.header.map((_, j) => <td key={j} style={{ textAlign: block.align[j] }}>{renderInline(row[j] || '', key + '-' + r + '-' + j)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'rule':
            return <hr key={key} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
