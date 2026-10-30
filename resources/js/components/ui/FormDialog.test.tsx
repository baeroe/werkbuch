import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { isMac } from '@/lib/platform';
import { listShortcuts } from '@/lib/shortcuts/registry';
import { FormDialog } from './FormDialog';
import { Input } from './Input';

/** The key chord of the submit shortcut as the browser sends it; on a Mac `mod` is the command key. */
const submitChord = () => new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...(isMac() ? { metaKey: true } : { ctrlKey: true }) });
const sendWithShortcut = () => document.activeElement!.dispatchEvent(submitChord());
const tick = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

/** A screen as the settings use the dialog: a send starts a call that makes the button pending until it is over. */
function Harness({ onSubmit, children }: { onSubmit: () => void; children?: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState(false);
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title="Bot anlegen"
      submitLabel="Anlegen"
      pending={pending}
      onSubmit={() => {
        onSubmit();
        setPending(true);
        setTimeout(() => setPending(false), 50);
      }}
    >
      {children ?? <Input label="Name" name="name" />}
    </FormDialog>
  );
}

describe('FormDialog', () => {
  it('sends the form once with the submit shortcut, also when it is pressed twice at once or twice in a row while the call runs', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await screen.findByRole('dialog', { name: 'Bot anlegen' });
    act(() => screen.getByRole('textbox', { name: 'Name' }).focus());

    act(() => {
      sendWithShortcut();
      sendWithShortcut();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // pending now: a press a moment later is ignored as well
    await tick();
    act(() => void sendWithShortcut());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // the call is over: the next press sends again
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anlegen' }).hasAttribute('aria-busy')).toBe(false));
    act(() => void sendWithShortcut());
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('sends with Enter in a text field and with the button, once each, and names the shortcut on the button', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <FormDialog open onOpenChange={() => {}} title="Bot anlegen" submitLabel="Anlegen" onSubmit={onSubmit}>
        <Input label="Name" name="name" />
      </FormDialog>,
    );
    await screen.findByRole('dialog');
    const button = screen.getByRole('button', { name: 'Anlegen' });
    expect(button.getAttribute('aria-keyshortcuts')).toBe(isMac() ? 'Meta+Enter' : 'Control+Enter');

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Kira{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await tick();
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('does not let the submit event reach the form of the page that opened the dialog', async () => {
    const user = userEvent.setup();
    const onPageSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onPageSubmit}>
        <FormDialog open onOpenChange={() => {}} title="Bot anlegen" submitLabel="Anlegen" onSubmit={onSubmit}>
          <Input label="Name" name="name" />
        </FormDialog>
      </form>,
    );
    await screen.findByRole('dialog');

    await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onPageSubmit).not.toHaveBeenCalled();
  });

  it('a pending dialog locks its button without taking the focus away: the same element, busy, and a click does nothing', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <FormDialog open onOpenChange={() => {}} title="Bot anlegen" submitLabel="Speichern" onSubmit={onSubmit}>
        <Input label="Name" name="name" />
      </FormDialog>,
    );
    await screen.findByRole('dialog');
    const button = screen.getByRole('button', { name: 'Speichern' });
    act(() => button.focus());

    rerender(
      <FormDialog open onOpenChange={() => {}} title="Bot anlegen" submitLabel="Speichern" pending onSubmit={onSubmit}>
        <Input label="Name" name="name" />
      </FormDialog>,
    );

    expect(screen.getByRole('button', { name: 'Speichern' })).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    fireEvent.submit(button.closest('dialog, [role="dialog"]')!.querySelector('form')!);
    act(() => void sendWithShortcut());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a refusal without a field as a notice on top, as an alert', async () => {
    const { rerender } = render(
      <FormDialog open onOpenChange={() => {}} title="Bot anlegen" submitLabel="Anlegen" onSubmit={() => {}}>
        <Input label="Name" name="name" />
      </FormDialog>,
    );
    await screen.findByRole('dialog');
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(
      <FormDialog open onOpenChange={() => {}} title="Bot anlegen" submitLabel="Anlegen" notice="Das Limit der Bots ist erreicht." onSubmit={() => {}}>
        <Input label="Name" name="name" />
      </FormDialog>,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Das hat nicht geklappt');
    expect(alert.textContent).toContain('Das Limit der Bots ist erreicht.');
    // it comes before the fields
    expect(alert.compareDocumentPosition(screen.getByRole('textbox', { name: 'Name' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('after a refused send the first invalid field takes the focus', async () => {
    const rows = (pending: boolean, invalid: boolean) => (
      <FormDialog open onOpenChange={() => {}} title="Bot anlegen" submitLabel="Anlegen" pending={pending} onSubmit={() => {}}>
        <Input label="Name" name="name" />
        <Input label="Kürzel" name="handle" error={invalid ? 'Gib dem Bot ein Kürzel.' : undefined} />
      </FormDialog>
    );
    const { rerender } = render(rows(false, false));
    await screen.findByRole('dialog');
    rerender(rows(true, false));
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Kürzel' }));

    rerender(rows(false, true));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Kürzel' })));
  });

  it('closes with "Abbrechen" and the Escape key, hands the focus to finalFocus, and builds its form fresh at every opening', async () => {
    const user = userEvent.setup();
    const finalFocus = { current: null as HTMLButtonElement | null };
    function Screen() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" ref={finalFocus} onClick={() => setOpen(true)}>
            Neuer Bot
          </button>
          <FormDialog open={open} onOpenChange={setOpen} title="Bot anlegen" description="Ohne Login." size="sm" submitLabel="Anlegen" finalFocus={finalFocus} onSubmit={() => {}}>
            <Input label="Name" name="name" />
          </FormDialog>
        </>
      );
    }
    render(<Screen />);

    await user.click(screen.getByRole('button', { name: 'Neuer Bot' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bot anlegen' });
    expect(dialog.className).toContain('max-w-sm');
    expect(screen.getByText('Ohne Login.')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Kira');
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(finalFocus.current);

    await user.click(screen.getByRole('button', { name: 'Neuer Bot' }));
    expect((await screen.findByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('binds the submit shortcut of the catalog only while it is open', async () => {
    const { rerender } = render(
      <FormDialog open onOpenChange={() => {}} title="Bot anlegen" submitLabel="Anlegen" onSubmit={() => {}}>
        <Input label="Name" name="name" />
      </FormDialog>,
    );
    await screen.findByRole('dialog');
    expect(listShortcuts()).toMatchObject([{ id: 'dialog.submit', keys: 'mod+enter', scope: 'dialog', label: 'shortcuts.dialog.submit', group: 'shortcuts.group.dialog' }]);

    rerender(
      <FormDialog open={false} onOpenChange={() => {}} title="Bot anlegen" submitLabel="Anlegen" onSubmit={() => {}}>
        <Input label="Name" name="name" />
      </FormDialog>,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(listShortcuts()).toEqual([]);
  });
});
