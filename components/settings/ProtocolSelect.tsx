import React from 'react';
import { useListboxKeyboard } from '../../hooks/useListboxKeyboard';

export interface ProtocolOption {
    id: string;
    label: string;
    badge?: string;
    detail?: string;
    featured?: boolean;
}

interface ProtocolSelectProps {
    options: ProtocolOption[];
    value: string;
    onChange: (id: string) => void;
    recommendedLabel?: string;
    /** 额外类名（其它面板复用时换皮）。 */
    className?: string;
    ariaLabel?: string;
    disabled?: boolean;
    labelledBy?: string;
    testId?: string;
}

/** 设置抽屉里的协议选择：替代原生 select，带简称徽标、能力说明与推荐标记；键盘可用（↑↓/Enter/Esc）。 */
export function ProtocolSelect({ options, value, onChange, recommendedLabel = '', disabled, labelledBy, testId, className, ariaLabel }: ProtocolSelectProps) {
    const [open, setOpen] = React.useState(false);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const selectedIndex = Math.max(0, options.findIndex(option => option.id === value));
    const selected = options[selectedIndex];

    React.useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    const choose = (id: string) => {
        if (id !== value) onChange(id);
        setOpen(false);
    };

    // 焦点留在触发按钮（select-only combobox）：↑/↓ 回绕移动、首字母跳转、Enter 选中、Esc 关闭，高亮滚到可见。
    const listbox = useListboxKeyboard({
        items: options,
        open,
        autoFocus: false,
        initialIndex: selectedIndex,
        getLabel: option => option.label,
        onSelect: option => choose(option.id),
        onClose: () => setOpen(false),
    });
    const active = listbox.activeIndex;

    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;
        if (!open) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
            return;
        }
        listbox.onKeyDown(event);
    };

    if (!selected) return null;

    return (
        <div ref={rootRef} className={`settings-protocol-select${open ? ' is-open' : ''}${className ? ' ' + className : ''}`}>
            <button
                type="button"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listbox.listId}
                aria-labelledby={labelledBy}
                aria-label={ariaLabel}
                aria-activedescendant={open && active >= 0 ? listbox.optionId(active) : undefined}
                disabled={disabled}
                data-testid={testId}
                className="settings-protocol-select__trigger"
                onClick={() => setOpen(current => !current)}
                onKeyDown={onKeyDown}
            >
                {selected.badge && <span className="settings-protocol-select__badge" aria-hidden="true">{selected.badge}</span>}
                <span className="settings-protocol-select__text">
                    <strong>{selected.label}</strong>
                    {selected.detail && <small>{selected.detail}</small>}
                </span>
                <svg className="settings-protocol-select__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {open && (
                <div {...listbox.getListboxProps({ className: 'settings-protocol-select__menu', 'aria-labelledby': labelledBy, 'aria-label': ariaLabel, tabIndex: undefined })}>
                    {options.map((option, index) => (
                        <div
                            key={option.id}
                            {...listbox.getOptionProps(index)}
                            aria-selected={option.id === value}
                            aria-label={option.label}
                            className={`settings-protocol-select__option${index === active ? ' is-active' : ''}${option.id === value ? ' is-selected' : ''}`}
                            onClick={() => choose(option.id)}
                        >
                            {option.badge && <span className="settings-protocol-select__badge" aria-hidden="true">{option.badge}</span>}
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
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
