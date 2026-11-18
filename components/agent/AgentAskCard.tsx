import { ChevronDown, ChevronUp, CircleHelp } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { translations } from '../../utils/translations';
import { isComposingEvent, moveListboxIndex } from '../../hooks/useListboxKeyboard';
import { collectAgentAskAnswers, isFallbackLabel, type AgentAskField, type AgentAskForm } from './agentAskForm';
import { AgentCardButton, AgentCardFoot, AgentCardHead } from './AgentCardShell';
import '../../styles/agentWorking.css';

interface AgentAskCardProps {
  form: AgentAskForm;
  language: 'zho' | 'en';
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}

type Values = Record<string, string | string[]>;

function initialValues(form: AgentAskForm): Values {
  const values: Values = {};
  for (const field of form.fields) {
    if (field.kind === 'checkbox') values[field.name] = field.options.filter(option => option.checked).map(option => option.value);
    else if (field.kind === 'select' && field.multiple) values[field.name] = field.options.filter(option => option.checked).map(option => option.value);
    else if (field.kind === 'select' || field.kind === 'radio') values[field.name] = field.options.find(option => option.checked)?.value || '';
    else values[field.name] = field.value;
  }
  return values;
}

/** 这一题有没有答案（决定「继续」是否可按）。 */
export function askFieldAnswered(field: AgentAskField, values: Values, other: Record<string, string>): boolean {
  if ((other[field.name] || '').trim()) return true;
  const value = values[field.name];
  return Array.isArray(value) ? value.some(Boolean) : Boolean(String(value ?? '').trim());
}

const letterOf = (index: number) => String.fromCharCode(65 + index);
const isChoice = (field: AgentAskField): field is Extract<AgentAskField, { kind: 'radio' | 'checkbox' }> => field.kind === 'radio' || field.kind === 'checkbox';

/**
 * 提问卡（flovart_ask）。版式参照 Inspora 1-37「AI Agent Approval Cards」@Kevin 的 Questions 卡（登记见 docs/design/references.md）：
 * 一页一题，「^ n/N v」翻页；选项行带 A/B/C 字母键帽，最后一行「其他…」是输入框；选中的键帽反色，悬停高光跟随指针。
 * 键盘：字母选择（多选为勾 / 取消），↑/↓ 移动，Enter 继续，Esc 取消。尾部「跳过」与「继续 ⏎」（没有答案时变暗）。
 * 表单契约不变：与 omp ask 相同的受控字段，答案仍由 collectAgentAskAnswers 收集。
 */
export function AgentAskCard({ form, language, onSubmit, onCancel }: AgentAskCardProps) {
  const copy = translations[language].agentAsk;
  const reduce = useReducedMotion();
  const [values, setValues] = useState<Values>(() => initialValues(form));
  const [other, setOther] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [active, setActive] = useState(-1);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const root = useRef<HTMLElement>(null);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);
  const baseId = useId();
  const total = form.fields.length;
  const field = form.fields[Math.min(page, total - 1)];
  const choice = field && isChoice(field) ? field : null;
  const rowCount = choice ? choice.options.length + 1 : 0;
  const answered = field ? askFieldAnswered(field, values, other) : false;
  const last = page >= total - 1;

  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  // 换题：高亮回到第一项（单选默认落在已选项上）。
  useEffect(() => {
    if (!choice) { setActive(-1); return; }
    const picked = choice.kind === 'radio' ? choice.options.findIndex(option => option.value === values[choice.name]) : -1;
    setActive(picked >= 0 ? picked : 0);
    // 只在换题时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  if (!field) return null;

  const setValue = (name: string, value: string | string[]) => {
    setValues(current => ({ ...current, [name]: value }));
    // 回头作答：取消这一题的「跳过」。
    setSkipped(current => { if (!current.has(name)) return current; const next = new Set(current); next.delete(name); return next; });
    setError('');
  };
  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(total - 1, next));
    if (clamped === page) return;
    setDirection(clamped > page ? 1 : -1);
    setPage(clamped);
    setError('');
    root.current?.focus({ preventScroll: true });
  };
  const finish = (nextValues: Values, nextOther: Record<string, string>, nextSkipped: ReadonlySet<string> = skipped) => {
    const result = collectAgentAskAnswers(form, nextValues, nextOther, nextSkipped);
    if ('error' in result) {
      setError(result.error);
      const missing = form.fields.findIndex(item => item.required && !nextSkipped.has(item.name) && !askFieldAnswered(item, nextValues, nextOther));
      if (missing >= 0 && missing !== page) goTo(missing);
      return;
    }
    onSubmit(result.data);
  };
  const proceed = () => {
    if (!answered) return;
    if (!last) goTo(page + 1);
    else finish(values, other);
  };
  const skip = () => {
    // 跳过 = 这一题的回答就是「用户跳过了」，不会再被拉回来补答。
    const cleared: Values = { ...values, [field.name]: Array.isArray(values[field.name]) ? [] : '' };
    const clearedOther = { ...other, [field.name]: '' };
    const nextSkipped = new Set(skipped).add(field.name);
    setValues(cleared);
    setOther(clearedOther);
    setSkipped(nextSkipped);
    if (!last) goTo(page + 1);
    else finish(cleared, clearedOther, nextSkipped);
  };

  const pick = (index: number) => {
    if (!choice) return;
    const option = choice.options[index];
    if (!option) return;
    setActive(index);
    if (choice.kind === 'radio') {
      setValue(choice.name, option.value);
      // 单选：挑了预设项就清掉「其他」，避免两个答案并存。
      setOther(current => ({ ...current, [choice.name]: '' }));
    } else {
      const current = Array.isArray(values[choice.name]) ? values[choice.name] as string[] : [];
      setValue(choice.name, current.includes(option.value) ? current.filter(value => value !== option.value) : [...current, option.value]);
    }
  };
  const focusRow = (index: number) => {
    setActive(index);
    rowRefs.current[index]?.focus({ preventScroll: false });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isComposingEvent(event)) return;
    const target = event.target as HTMLElement;
    const typing = target.matches('input[type="text"], input:not([type]), input[type="number"], input[type="date"], input[type="email"], input[type="url"], textarea, select');
    if (event.key === 'Escape') {
      event.preventDefault();
      if (typing && target.closest('.agent-ask__other')) { root.current?.focus({ preventScroll: true }); return; }
      onCancel();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !(target instanceof HTMLTextAreaElement)) {
      // 主按钮 / 跳过 / 翻页按钮自己处理回车（原生按钮行为）。
      if (target instanceof HTMLButtonElement && !target.closest('.agent-ask__options')) return;
      event.preventDefault();
      if (answered) proceed();
      else if (choice && active >= 0 && active < choice.options.length) pick(active);
      return;
    }
    if (!choice) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (typing && !target.closest('.agent-ask__other')) return;
      event.preventDefault();
      focusRow(moveListboxIndex(active, rowCount, event.key === 'ArrowDown' ? 1 : -1, { wrap: true }));
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    const index = event.key.toUpperCase().charCodeAt(0) - 65;
    if (index < 0 || index >= rowCount) return;
    event.preventDefault();
    if (index === choice.options.length) focusRow(index);
    else pick(index);
  };

  const trackPointer = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
  };

  const otherText = other[field.name] || '';
  const otherFilled = Boolean(otherText.trim());
  const questionId = `${baseId}-q${page}`;
  const [title, ...context] = form.context;

  const renderChoices = (item: Extract<AgentAskField, { kind: 'radio' | 'checkbox' }>) => {
    const selected = values[item.name];
    return (
      <div className="agent-ask__options" role={item.kind === 'radio' ? 'radiogroup' : 'group'} aria-labelledby={questionId}>
        {item.options.map((option, index) => {
          const checked = item.kind === 'checkbox'
            ? Array.isArray(selected) && selected.includes(option.value)
            : selected === option.value && !otherFilled;
          return (
            <button
              key={option.value}
              ref={node => { rowRefs.current[index] = node; }}
              type="button"
              role={item.kind === 'radio' ? 'radio' : 'checkbox'}
              aria-checked={checked}
              tabIndex={index === Math.max(0, active) ? 0 : -1}
              className="agent-ask__option"
              data-checked={checked ? '' : undefined}
              data-active={index === active ? '' : undefined}
              onPointerMove={trackPointer}
              onPointerEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onClick={() => pick(index)}
            >
              <kbd className="agent-ask__key" aria-hidden="true">{letterOf(index)}</kbd>
              <span className="agent-ask__option-text">{option.label}</span>
            </button>
          );
        })}
        <label
          className="agent-ask__option agent-ask__other"
          data-checked={otherFilled ? '' : undefined}
          data-active={active === item.options.length ? '' : undefined}
          onPointerMove={trackPointer}
          onPointerEnter={() => setActive(item.options.length)}
        >
          <kbd className="agent-ask__key" aria-hidden="true">{letterOf(item.options.length)}</kbd>
          <input
            ref={node => { rowRefs.current[item.options.length] = node; }}
            type="text"
            value={otherText}
            placeholder={copy.other}
            aria-label={copy.otherAria}
            tabIndex={active === item.options.length ? 0 : -1}
            onFocus={() => setActive(item.options.length)}
            onChange={event => { const text = event.target.value; setOther(current => ({ ...current, [item.name]: text })); setSkipped(current => { if (!current.has(item.name)) return current; const next = new Set(current); next.delete(item.name); return next; }); setError(''); }}
          />
        </label>
      </div>
    );
  };

  const renderControl = (item: AgentAskField) => {
    if (isChoice(item)) return renderChoices(item);
    if (item.kind === 'select') {
      return (
        <select
          className="agent-ask__control"
          name={item.name}
          aria-labelledby={questionId}
          multiple={item.multiple}
          required={item.required}
          value={item.multiple ? (Array.isArray(values[item.name]) ? values[item.name] as string[] : []) : String(values[item.name] || '')}
          onChange={event => {
            if (!item.multiple) { setValue(item.name, event.target.value); return; }
            setValue(item.name, Array.from(event.target.selectedOptions).map(option => option.value));
          }}
        >
          {!item.multiple && <option value="">{copy.choose}</option>}
          {item.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
    }
    if (item.kind === 'textarea') {
      return (
        <textarea
          className="agent-ask__control"
          name={item.name}
          aria-labelledby={questionId}
          value={String(values[item.name] || '')}
          rows={item.rows || 3}
          placeholder={item.placeholder}
          required={item.required}
          onChange={event => setValue(item.name, event.target.value)}
        />
      );
    }
    return (
      <input
        className="agent-ask__control"
        name={item.name}
        aria-labelledby={questionId}
        type={item.inputType}
        value={String(values[item.name] || '')}
        placeholder={item.placeholder}
        required={item.required}
        min={item.min}
        max={item.max}
        pattern={item.pattern}
        onChange={event => setValue(item.name, event.target.value)}
      />
    );
  };

  // 换题：新题从翻页方向滑入（snappy）；旧题直接换掉，不留两份表单在 DOM 里。
  const slide = reduce ? { duration: 0.1 } : { type: 'spring' as const, visualDuration: 0.22, bounce: 0 };

  return (
    <section
      ref={root}
      className="flv-card agent-ask agent-card-on-shell"
      role="group"
      aria-label={copy.aria}
      tabIndex={-1}
      data-testid="agent-ask"
      aria-description={copy.keys}
      onKeyDown={onKeyDown}
    >
      <AgentCardHead icon={<CircleHelp />} accent="ask" label={copy.label} onClose={onCancel} closeLabel={copy.cancel} />
      {title && <h3 className="flv-card__heading agent-ask__title">{title}</h3>}
      {context.length > 0 && (
        <div className="flv-card__summary agent-ask__context">
          {context.map((text, index) => <p key={index}>{text}</p>)}
        </div>
      )}
      <motion.div
        key={page}
        className="agent-ask__page"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: direction * 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={slide}
      >
        <p id={questionId} className="agent-ask__question" data-fallback={isFallbackLabel(field) ? '' : undefined}>
          {field.label}{field.required ? <span className="agent-ask__required" aria-label={copy.required}> *</span> : null}
        </p>
        {renderControl(field)}
      </motion.div>
      {error && <p className="agent-ask__error" role="alert">{error}</p>}
      <AgentCardFoot
        start={total > 1 ? (
          <span className="agent-ask__pager" role="group" aria-label={copy.pager(page + 1, total)}>
            <button type="button" className="flv-card__ghost" aria-label={copy.prev} title={copy.prev} disabled={page === 0} onClick={() => goTo(page - 1)}><ChevronUp size={14} aria-hidden="true" /></button>
            <span className="agent-ask__count flv-machine" aria-hidden="true">{page + 1}/{total}</span>
            <button type="button" className="flv-card__ghost" aria-label={copy.next} title={copy.next} disabled={last} onClick={() => goTo(page + 1)}><ChevronDown size={14} aria-hidden="true" /></button>
          </span>
        ) : undefined}
      >
        <AgentCardButton className="agent-ask__skip" onClick={skip}>{copy.skip}</AgentCardButton>
        <AgentCardButton variant="primary" enterHint className="agent-ask__submit" disabled={!answered} onClick={proceed}>{copy.proceed}</AgentCardButton>
      </AgentCardFoot>
    </section>
  );
}
