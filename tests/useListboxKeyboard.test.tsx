import { fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { firstNavigableIndex, isPrintableKey, moveListboxIndex, useListboxKeyboard, useMenuKeyboard } from '../hooks/useListboxKeyboard';

type Row = { label: string; header?: boolean };
const ROWS: Row[] = [
  { label: 'DeepSeek', header: true },
  { label: 'deepseek-chat' },
  { label: 'deepseek-reasoner' },
  { label: 'OpenAI', header: true },
  { label: 'gpt-4o' },
  { label: 'gpt-4o-mini' },
];

function Harness({ onSelect = vi.fn(), onClose = vi.fn(), wrap = true, initialIndex }: { onSelect?: (row: Row) => void; onClose?: () => void; wrap?: boolean; initialIndex?: number }) {
  const [query, setQuery] = useState('');
  // 筛选后保留仍有子项的分组标题。
  const items = useMemo(() => {
    const q = query.toLowerCase();
    const out: Row[] = [];
    let header: Row | null = null;
    for (const row of ROWS) {
      if (row.header) { header = row; continue; }
      if (q && !row.label.toLowerCase().includes(q)) continue;
      if (header) { out.push(header); header = null; }
      out.push(row);
    }
    return out;
  }, [query]);
  const listbox = useListboxKeyboard({ items, query, onQueryChange: setQuery, onClose, onSelect, wrap, initialIndex, isNavigable: row => !row.header });
  return (
    <div data-testid="pop" {...listbox.getContainerProps()}>
      <button type="button">tab</button>
      <input aria-label="search" {...listbox.getInputProps({ value: query, onChange: event => setQuery(event.target.value) })} />
      <div {...listbox.getListboxProps({ 'aria-label': 'models' })}>
        {items.map((row, index) => row.header
          ? <div key={row.label} role="presentation">{row.label}</div>
          : <div key={row.label} {...listbox.getOptionProps(index)}>{row.label}</div>)}
      </div>
    </div>
  );
}

const active = () => document.querySelector('[data-listbox-active="true"]')?.textContent;

describe('moveListboxIndex', () => {
  const nav = (index: number) => index !== 0 && index !== 3;
  it('skips headers, wraps or clamps at the ends', () => {
    expect(firstNavigableIndex(6, nav)).toBe(1);
    expect(moveListboxIndex(2, 6, 1, { wrap: true, isNavigable: nav })).toBe(4);
    expect(moveListboxIndex(5, 6, 1, { wrap: true, isNavigable: nav })).toBe(1);
    expect(moveListboxIndex(1, 6, -1, { wrap: true, isNavigable: nav })).toBe(5);
    expect(moveListboxIndex(5, 6, 1, { isNavigable: nav })).toBe(5);
    expect(moveListboxIndex(1, 6, -1, { isNavigable: nav })).toBe(1);
    expect(moveListboxIndex(1, 6, -1, { exitAbove: true, isNavigable: nav })).toBe(-1);
    expect(moveListboxIndex(-1, 6, 1, { isNavigable: nav })).toBe(1);
    expect(moveListboxIndex(0, 0, 1)).toBe(-1);
  });
  it('treats only single unmodified characters as printable', () => {
    expect(isPrintableKey({ key: 'a', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isPrintableKey({ key: 'a', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
    expect(isPrintableKey({ key: 'ArrowDown', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });
});

describe('useListboxKeyboard', () => {
  it('focuses the search on open, highlights the first match and wires aria', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'search' });
    expect(document.activeElement).toBe(input);
    expect(active()).toBe('deepseek-chat');
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'deepseek-chat' }).id);
  });

  it('filters, re-highlights the first match, and ↑/↓ skips headers and wraps', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe('deepseek-reasoner');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe('gpt-4o'); // 跳过 OpenAI 标题
    fireEvent.change(input, { target: { value: 'gpt' } });
    expect(active()).toBe('gpt-4o');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe('gpt-4o'); // 回绕
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(active()).toBe('gpt-4o-mini');
  });

  it('clamps instead of wrapping when wrap is off, and hover syncs the highlight', () => {
    render(<Harness wrap={false} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(active()).toBe('deepseek-chat');
    fireEvent.mouseMove(screen.getByRole('option', { name: 'gpt-4o-mini' }));
    expect(active()).toBe('gpt-4o-mini');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe('gpt-4o-mini');
  });

  it('Enter selects the highlighted item; Esc clears the search first, then closes', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<Harness onSelect={onSelect} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'reason' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ label: 'deepseek-reasoner' }, 1);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores Enter and arrows while an IME is composing', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 229 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(active()).toBe('deepseek-chat');
  });

  it('forwards printable keys typed elsewhere in the popover to the search', () => {
    render(<Harness />);
    const other = screen.getByRole('button', { name: 'tab' });
    other.focus();
    fireEvent.keyDown(other, { key: 'g' });
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('g');
    expect(document.activeElement).toBe(input);
    expect(active()).toBe('gpt-4o');
    other.focus();
    fireEvent.keyDown(other, { key: 'Backspace' });
    expect(input).toHaveValue('');
  });

  it('starts on initialIndex (the current selection) when there is no query', () => {
    render(<Harness initialIndex={5} />);
    expect(active()).toBe('gpt-4o-mini');
  });
});

function MenuHarness({ onClose }: { onClose: () => void }) {
  const keys = useMenuKeyboard({ onClose });
  return (
    <div role="menu" {...keys}>
      <button type="button" role="menuitem">Blank</button>
      <div role="presentation">Group</div>
      <button type="button" role="menuitem" disabled>Disabled</button>
      <button type="button" role="menuitemradio" aria-checked="true">Template</button>
      <button type="button" role="menuitem">Import</button>
    </div>
  );
}

describe('useMenuKeyboard', () => {
  it('focuses the checked item, moves with ↑/↓ skipping disabled items, jumps by first letter and closes on Esc', () => {
    const onClose = vi.fn();
    render(<MenuHarness onClose={onClose} />);
    expect(document.activeElement).toHaveTextContent('Template');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveTextContent('Import');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveTextContent('Blank');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveTextContent('Template');
    fireEvent.keyDown(document.activeElement!, { key: 'i' });
    expect(document.activeElement).toHaveTextContent('Import');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
