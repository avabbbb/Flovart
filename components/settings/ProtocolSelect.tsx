import React from 'react';

export interface ProtocolOption {
    id: string;
    label: string;
    badge: string;
    detail?: string;
    featured?: boolean;
}

interface ProtocolSelectProps {
    options: ProtocolOption[];
    value: string;
    onChange: (id: string) => void;
    recommendedLabel: string;
    disabled?: boolean;
    labelledBy?: string;
    testId?: string;
}

/** 设置抽屉里的协议选择：替代原生 select，带简称徽标、能力说明与推荐标记；键盘可用（↑↓/Enter/Esc）。 */
export function ProtocolSelect({ options, value, onChange, recommendedLabel, disabled, labelledBy, testId }: ProtocolSelectProps) {
    const [open, setOpen] = React.useState(false);
    const [active, setActive] = React.useState(0);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const listId = React.useId();
    const selectedIndex = Math.max(0, options.findIndex(option => option.id === value));
    const selected = options[selectedIndex];

    React.useEffect(() => {
        if (!open) return;
        setActive(selectedIndex);
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open, selectedIndex]);

    const choose = (id: string) => {
        if (id !== value) onChange(id);
        setOpen(false);
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;
        if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { setOpen(true); return; }
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive(index => (index + step + options.length) % options.length);
            return;
        }
        if (event.key === 'Enter' && open) {
            event.preventDefault();
            choose(options[active].id);
        }
    };

    if (!selected) return null;

    return (
        <div ref={rootRef} className={`settings-protocol-select${open ? ' is-open' : ''}`}>
            <button
                type="button"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                aria-labelledby={labelledBy}
                aria-activedescendant={open ? `${listId}-${active}` : undefined}
                disabled={disabled}
                data-testid={testId}
                className="settings-protocol-select__trigger"
                onClick={() => setOpen(current => !current)}
                onKeyDown={onKeyDown}
            >
                <span className="settings-protocol-select__badge" aria-hidden="true">{selected.badge}</span>
                <span className="settings-protocol-select__text">
                    <strong>{selected.label}</strong>
                    {selected.detail && <small>{selected.detail}</small>}
                </span>
                <svg className="settings-protocol-select__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {open && (
                <ul id={listId} role="listbox" aria-labelledby={labelledBy} className="settings-protocol-select__menu">
                    {options.map((option, index) => (
                        <li
                            key={option.id}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={option.id === value}
                            aria-label={option.label}
                            className={`settings-protocol-select__option${index === active ? ' is-active' : ''}${option.id === value ? ' is-selected' : ''}`}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => choose(option.id)}
                        >
                            <span className="settings-protocol-select__badge" aria-hidden="true">{option.badge}</span>
                            <span className="settings-protocol-select__text">
                                <strong>
                                    {option.label}
                                    {option.featured && <em className="settings-protocol-select__pill">{recommendedLabel}</em>}
                                </strong>
                                {option.detail && <small>{option.detail}</small>}
                            </span>
                            {option.id === value && (
                                <svg className="settings-protocol-select__check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
