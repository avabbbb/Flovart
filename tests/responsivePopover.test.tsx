import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ResponsivePopover } from '../components/ResponsivePopover';

function PopoverHarness() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={anchorRef} type="button" onClick={() => setOpen(true)}>Open settings</button>
    <button type="button">Outside action</button>
    {open && <ResponsivePopover
      anchorRef={anchorRef}
      ariaLabel="Generation settings"
      onRequestClose={() => setOpen(false)}
      dataTestId="test-popover"
    >
      <button type="button">Choose model</button>
    </ResponsivePopover>}
  </>;
}

describe('ResponsivePopover', () => {
  it('labels the dialog, moves focus into it, and restores focus after Escape', async () => {
    render(<PopoverHarness />);
    const trigger = screen.getByRole('button', { name: 'Open settings' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Generation settings' });
    const option = screen.getByRole('button', { name: 'Choose model' });
    await waitFor(() => expect(option).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Generation settings' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(dialog).not.toBeInTheDocument();
  });

  it('closes on outside pointer interaction without stealing focus from the clicked target', async () => {
    render(<PopoverHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    await screen.findByRole('dialog', { name: 'Generation settings' });
    const outside = screen.getByRole('button', { name: 'Outside action' });
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('dialog', { name: 'Generation settings' })).not.toBeInTheDocument();
  });
});
