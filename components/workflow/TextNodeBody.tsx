import { useEffect, useRef, useState, type ReactNode } from 'react';

/** LibTV 式文本节点：平时按文档排版（标题层级、列表、引用、加粗），双击进入编辑。 */
export type TextBlock =
  | { kind: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote'; text: string }
  | { kind: 'ol'; text: string; marker: string }
  | { kind: 'hr' | 'gap' };

const HEADINGS = ['h1', 'h2', 'h3'] as const;

export function parseTextBlocks(source: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    let match: RegExpExecArray | null;
    if (!line) {
      if (blocks.length && blocks[blocks.length - 1].kind !== 'gap') blocks.push({ kind: 'gap' });
    } else if ((match = /^(#{1,3})\s+(.+)$/.exec(line))) {
      blocks.push({ kind: HEADINGS[match[1].length - 1], text: match[2] });
    } else if (/^([-*_])\1{2,}$/.test(line)) {
      blocks.push({ kind: 'hr' });
    } else if ((match = /^【(.+)】$/.exec(line))) {
      blocks.push({ kind: 'h3', text: match[1] });
    } else if ((match = /^[-*•·]\s+(.+)$/.exec(line))) {
      blocks.push({ kind: 'li', text: match[1] });
    } else if ((match = /^(\d{1,3})[.)、．]\s*(.+)$/.exec(line))) {
      blocks.push({ kind: 'ol', marker: match[1], text: match[2] });
    } else if ((match = /^>\s?(.+)$/.exec(line))) {
      blocks.push({ kind: 'quote', text: match[1] });
    } else {
      blocks.push({ kind: 'p', text: line });
    }
  }
  if (blocks[blocks.length - 1]?.kind === 'gap') blocks.pop();
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>
  ));
}

export function TextNodeBody({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [editing]);
  if (editing || !value.trim()) {
    return (
      <textarea
        ref={textareaRef}
        value={value}
        placeholder="写脚本、备注或说明；这里的文字不会自动进入生成提示词"
        onPointerDown={event => event.stopPropagation()}
        onChange={event => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.blur(); } }}
      />
    );
  }
  return (
    <div
      className="workflow-text-doc"
      role="document"
      tabIndex={0}
      title="双击编辑"
      onDoubleClick={event => { event.stopPropagation(); setEditing(true); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); setEditing(true); } }}
      onWheel={event => event.stopPropagation()}
    >
      {parseTextBlocks(value).map((block, index) => {
        switch (block.kind) {
          case 'gap': return <div key={index} className="workflow-text-doc__gap" aria-hidden="true" />;
          case 'hr': return <div key={index} className="workflow-text-doc__hr" role="separator" />;
          case 'li': return <div key={index} className="workflow-text-doc__li"><span aria-hidden="true">•</span><span>{renderInline(block.text)}</span></div>;
          case 'ol': return <div key={index} className="workflow-text-doc__li is-ordered"><span aria-hidden="true">{block.marker}.</span><span>{renderInline(block.text)}</span></div>;
          default: return <div key={index} className={`workflow-text-doc__${block.kind}`}>{renderInline(block.text)}</div>;
        }
      })}
    </div>
  );
}
