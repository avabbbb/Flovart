import { useEffect, useRef, useState } from 'react';
import { collectAgentAskAnswers, type AgentAskField, type AgentAskForm } from './agentAskForm';

interface AgentAskCardProps {
  form: AgentAskForm;
  language: 'zho' | 'en';
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}

function initialValues(form: AgentAskForm): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const field of form.fields) {
    if (field.kind === 'checkbox') values[field.name] = field.options.filter(option => option.checked).map(option => option.value);
    else if (field.kind === 'select' && field.multiple) values[field.name] = field.options.filter(option => option.checked).map(option => option.value);
    else if (field.kind === 'select' || field.kind === 'radio') values[field.name] = field.options.find(option => option.checked)?.value || '';
    else values[field.name] = field.value;
  }
  return values;
}

/** 与 omp ask 同一套表单契约：受控字段、自动 Other、提交回 JSON。 */
export function AgentAskCard({ form, language, onSubmit, onCancel }: AgentAskCardProps) {
  const L = (zho: string, en: string) => (language === 'en' ? en : zho);
  const [values, setValues] = useState<Record<string, string | string[]>>(() => initialValues(form));
  const [other, setOther] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  const setValue = (name: string, value: string | string[]) => {
    setValues(current => ({ ...current, [name]: value }));
    setError('');
  };

  const submit = () => {
    const result = collectAgentAskAnswers(form, values, other);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onSubmit(result.data);
  };

  const renderChoices = (field: Extract<AgentAskField, { kind: 'radio' | 'checkbox' }>) => {
    const selected = values[field.name];
    return (
      <div className="agent-ask__options" role={field.kind === 'radio' ? 'radiogroup' : 'group'} aria-label={field.label}>
        {field.options.map(option => {
          const checked = field.kind === 'checkbox'
            ? Array.isArray(selected) && selected.includes(option.value)
            : selected === option.value;
          return (
            <label key={option.value} className="agent-ask__option">
              <input
                type={field.kind}
                name={field.name}
                value={option.value}
                checked={checked}
                onChange={event => {
                  if (field.kind === 'radio') setValue(field.name, option.value);
                  else {
                    const current = Array.isArray(selected) ? selected : [];
                    setValue(field.name, event.target.checked ? [...current, option.value] : current.filter(value => value !== option.value));
                  }
                }}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
        <label className="agent-ask__option agent-ask__other">
          <span>{L('其他', 'Other')}</span>
          <input
            type="text"
            value={other[field.name] || ''}
            placeholder={L('直接输入你的答案', 'Type your own answer')}
            onChange={event => setOther(current => ({ ...current, [field.name]: event.target.value }))}
          />
        </label>
      </div>
    );
  };

  return (
    <section
      ref={root}
      className="agent-ask"
      role="group"
      aria-label={L('Agent 需要你选择', 'Agent needs your input')}
      tabIndex={-1}
      data-testid="agent-ask"
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onCancel();
      }}
    >
      {form.context.length > 0 && (
        <div className="agent-ask__context">
          {form.context.map((text, index) => <p key={index}>{text}</p>)}
        </div>
      )}
      {form.fields.map(field => (
        <div key={field.name} className="agent-ask__field">
          <span className="agent-ask__label">{field.label}{field.required ? ' *' : ''}</span>
          {field.kind === 'radio' || field.kind === 'checkbox'
            ? renderChoices(field)
            : field.kind === 'select'
              ? (
                <select
                  className="agent-ask__control"
                  name={field.name}
                  multiple={field.multiple}
                  required={field.required}
                  value={field.multiple ? (Array.isArray(values[field.name]) ? values[field.name] as string[] : []) : String(values[field.name] || '')}
                  onChange={event => {
                    if (!field.multiple) {
                      setValue(field.name, event.target.value);
                      return;
                    }
                    setValue(field.name, Array.from(event.target.selectedOptions).map(option => option.value));
                  }}
                >
                  {!field.multiple && <option value="">{L('请选择…', 'Choose…')}</option>}
                  {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              )
              : field.kind === 'textarea'
                ? (
                  <textarea
                    className="agent-ask__control"
                    name={field.name}
                    value={String(values[field.name] || '')}
                    rows={field.rows || 3}
                    placeholder={field.placeholder}
                    required={field.required}
                    onChange={event => setValue(field.name, event.target.value)}
                  />
                )
                : (
                  <input
                    className="agent-ask__control"
                    name={field.name}
                    type={field.inputType}
                    value={String(values[field.name] || '')}
                    placeholder={field.placeholder}
                    required={field.required}
                    min={field.min}
                    max={field.max}
                    pattern={field.pattern}
                    onChange={event => setValue(field.name, event.target.value)}
                  />
                )}
        </div>
      ))}
      {error && <p className="agent-ask__error" role="alert">{error}</p>}
      <div className="agent-ask__actions">
        <button type="button" className="agent-ask__cancel" onClick={onCancel}>{L('取消', 'Cancel')}</button>
        <button type="button" className="agent-ask__submit" onClick={submit}>{L('提交', 'Submit')}</button>
      </div>
    </section>
  );
}
