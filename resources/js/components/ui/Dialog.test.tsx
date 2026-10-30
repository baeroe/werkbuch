import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { Button } from './Button';
import { Dialog, DialogClose, DialogFrame } from './Dialog';

describe('Dialog', () => {
  it('starts the focus on initialFocus and gives it back to finalFocus when it closes', async () => {
    const user = userEvent.setup();
    const initialFocus = createRef<HTMLInputElement>();
    const finalFocus = createRef<HTMLButtonElement>();
    render(
      <>
        <button type="button">Davor</button>
        <button type="button" ref={finalFocus}>
          Danach
        </button>
        <Dialog
          trigger={<button type="button">Öffnen</button>}
          title="Neues Item"
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          footer={<DialogClose render={<Button variant="ghost">Abbrechen</Button>} />}
        >
          <input ref={initialFocus} aria-label="Titel" />
          <input aria-label="Notiz" />
        </Dialog>
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    await screen.findByRole('dialog', { name: 'Neues Item' });
    await waitFor(() => expect(document.activeElement).toBe(initialFocus.current));

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(finalFocus.current);
  });

  it('closes on Escape and reports it, after which the page may go on', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onOpenChangeComplete = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
          onOpenChangeComplete={onOpenChangeComplete}
          title="Neues Item"
          description="Ein Item für das Team."
        />
      );
    }
    render(<Harness />);
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByText('Ein Item für das Team.')).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChangeComplete).toHaveBeenLastCalledWith(false);
  });

  it('closes from the close button of the frame, named in the language of the page', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="Neues Item" />);

    await user.click(await screen.findByRole('button', { name: 'Schließen' }));

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ['sm', 'max-w-sm'],
    ['md', 'max-w-lg'],
    ['lg', 'max-w-2xl'],
  ] as const)('size %s sets the popup width %s, md by default', async (size, width) => {
    render(<Dialog open title="Neues Item" size={size} />);

    expect((await screen.findByRole('dialog')).className).toContain(width);
  });

  it('is as wide as md when no size is given', async () => {
    render(<Dialog open title="Neues Item" />);

    expect((await screen.findByRole('dialog')).className).toContain('max-w-lg');
  });

  it('pads a dialog that has a title only, and sets a body and a footer apart', async () => {
    const { rerender } = render(<Dialog open title="Neues Item" />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('.border-t')).toBeNull();

    rerender(
      <Dialog open title="Neues Item" footer={<Button variant="primary">Anlegen</Button>}>
        <p>Inhalt</p>
      </Dialog>,
    );
    expect(screen.getByText('Inhalt')).toBeTruthy();
    expect(screen.getByRole('dialog').querySelector('.border-t')).not.toBeNull();
  });

  it('shows no close button when the frame is not closable', async () => {
    render(
      <BaseDialog.Root open>
        <DialogFrame title="Antworten" closable={false} />
      </BaseDialog.Root>,
    );

    await screen.findByRole('dialog', { name: 'Antworten' });
    expect(screen.queryByRole('button', { name: 'Schließen' })).toBeNull();
  });

  it('holds two scope layers when a dialog opens over a dialog: the page stays paused until both are closed', async () => {
    const next = vi.fn();
    const off = registerShortcut({ id: 'test.list.next', keys: 'j', scope: 'list', label: 'shortcuts.shell.help', group: 'shortcuts.group.general', run: next });
    const press = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
    function Harness({ outer, inner }: { outer: boolean; inner: boolean }) {
      return (
        <Dialog open={outer} title="Außen">
          <Dialog open={inner} title="Innen" stacked />
        </Dialog>
      );
    }
    try {
      const { rerender } = render(<Harness outer inner />);
      await screen.findByRole('dialog', { name: 'Innen', hidden: true });
      press();
      expect(next).not.toHaveBeenCalled();

      // the inner one closes: the outer one still pauses the page
      rerender(<Harness outer inner={false} />);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Innen', hidden: true })).toBeNull());
      press();
      expect(next).not.toHaveBeenCalled();

      rerender(<Harness outer={false} inner={false} />);
      await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
      press();
      expect(next).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });
});
