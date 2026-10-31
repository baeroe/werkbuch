import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AlertDialog } from './AlertDialog';

describe('AlertDialog', () => {
  it('starts the focus on "Abbrechen", and the confirmation runs onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AlertDialog open title="Projekt löschen?" description="Alle Items des Projekts gehen verloren." confirmLabel="Projekt löschen" onConfirm={onConfirm} />);

    const dialog = await screen.findByRole('alertdialog', { name: 'Projekt löschen?' });
    expect(screen.getByText('Alle Items des Projekts gehen verloren.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' })));
    // it must be answered: no close button
    expect(screen.queryByRole('button', { name: 'Schließen' })).toBeNull();
    expect(dialog.className).toContain('max-w-sm');

    await user.click(screen.getByRole('button', { name: 'Projekt löschen' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes on "Abbrechen" and Escape without confirming', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
          trigger={<button type="button">Löschen</button>}
          title="Projekt löschen?"
          description="Das lässt sich nicht zurücknehmen."
          confirmLabel="Löschen"
          onConfirm={onConfirm}
        />
      );
    }
    render(<Harness />);
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    // the trigger opens it again; Escape closes it as well
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('gives the focus to finalFocus when it closes', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(true);
      const next = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" ref={next}>
            Nächste Zeile
          </button>
          <AlertDialog open={open} onOpenChange={setOpen} title="Property löschen?" description="Die Werte verschwinden." confirmLabel="Löschen" onConfirm={() => setOpen(false)} finalFocus={next} />
        </>
      );
    }
    render(<Harness />);
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nächste Zeile' })));
  });

  it('takes a custom label for the cancel button', async () => {
    render(<AlertDialog defaultOpen title="Workflow wechseln?" description="Items werden neu zugeordnet." confirmLabel="Wechseln" cancelLabel="Doch nicht" onConfirm={() => {}} />);

    expect(await screen.findByRole('button', { name: 'Doch nicht' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
  });

  it('is the danger tone and shows the running action: busy, and cancelling is blocked', async () => {
    const onConfirm = vi.fn();
    render(<AlertDialog open title="Projekt löschen?" description="Weg ist weg." confirmLabel="Projekt löschen" pending onConfirm={onConfirm} />);

    const confirm = await screen.findByRole('button', { name: 'Projekt löschen' });
    expect(confirm.className).toContain('bg-danger');
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Abbrechen' }).hasAttribute('disabled')).toBe(true);

    await userEvent.setup().click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
