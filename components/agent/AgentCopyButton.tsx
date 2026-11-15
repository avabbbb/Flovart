import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from './agentTranscript';

interface AgentCopyButtonProps {
  text: string;
  label: string;
  copiedLabel: string;
  /** Show the label next to the icon; otherwise it is an icon button with title / aria-label. */
  showLabel?: boolean;
  className?: string;
}

/** Icon copy button with a short confirmation; the label rides on title/aria-label when hidden. */
export function AgentCopyButton({ text, label, copiedLabel, showLabel = false, className }: AgentCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const current = copied ? copiedLabel : label;
  return (
    <button
      type="button"
      className={`agent-copy-btn${showLabel ? ' has-label' : ''}${copied ? ' is-copied' : ''}${className ? ` ${className}` : ''}`}
      title={current}
      aria-label={current}
      onClick={async () => {
        if (!await copyToClipboard(text)) return;
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {showLabel && <span>{current}</span>}
    </button>
  );
}
