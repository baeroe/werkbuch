import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { isMac } from '@/lib/platform';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { AlertDialog } from './AlertDialog';
import { Dialog } from './Dialog';
import { FormDialog } from './FormDialog';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

/*
 * A dialog or popover stays mounted while it animates out (about 160 ms). The page's shortcuts belong to the page again
 * from the moment it closes, not only once it is gone: ⌘Z right after a confirmed delete must undo (Task 18, M4).
 * jsdom runs no animations, so `getAnimations` plays one that only ends when the test says so.
 */
function holdClosingAnimation() {
  let finish!: () => void;
  const fading = { pending: false, playState: 'running', effect: { getTiming: () => ({ duration: 160, iterations: 1 }) }, finished: new Promise<void>((resolve) => (finish = resolve)) };
  Element.prototype.getAnimations = () => [fading as unknown as Animation];
  onTestFinished(() => void delete (Element.prototype as Partial<Element>).getAnimations);
  return async () => {
    fading.playState = 'finished';
    await act(async () => finish());
  };
}

function pageShortcut() {
  const run = vi.fn();
  const off = registerShortcut({ id: 'test.list.next', keys: 'j', scope: 'list', label: 'shortcuts.shell.help', group: 'shortcuts.group.general', run });
  onTestFinished(off);
  const press = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
  return { run, press };
}

/** Open: the page waits. Closing (still in the DOM): the page's key works. Gone: still works. */
async function expectPausedOnlyWhileOpen(name: string, show: (open: boolean) => ReactNode, role: 'dialog' | 'alertdialog' = 'dialog') {
  const { run, press } = pageShortcut();
  const { rerender } = render(show(true));
  await screen.findByRole(role, { name, hidden: true });
  press();
  expect(run).not.toHaveBeenCalled();

  const finish = holdClosingAnimation();
  rerender(show(false));
  // still animating out
  expect(screen.getByRole(role, { name, hidden: true }).isConnected).toBe(true);
  press();
  expect(run).toHaveBeenCalledTimes(1);

  await finish();
  await waitFor(() => expect(screen.queryByRole(role, { name, hidden: true })).toBeNull());
  press();
  expect(run).toHaveBeenCalledTimes(2);
}

describe('the shortcuts of the page while a dialog closes', () => {
  it('come back the moment a Dialog closes, not when it is gone', async () => {
    await expectPausedOnlyWhileOpen('Neues Item', (open) => <Dialog open={open} title="Neues Item" />);
  });

  it('come back the moment an AlertDialog closes', async () => {
    await expectPausedOnlyWhileOpen('Seite löschen?', (open) => <AlertDialog open={open} title="Seite löschen?" description="Sie geht mit ihren Unterseiten." confirmLabel="Löschen" onConfirm={() => undefined} />, 'alertdialog');
  });

  it('come back the moment a FormDialog closes, and its ⌘↵ no longer sends the closing form', async () => {
    const onSubmit = vi.fn();
    await expectPausedOnlyWhileOpen('Label anlegen', (open) => (
      <FormDialog open={open} onOpenChange={() => undefined} title="Label anlegen" submitLabel="Anlegen" onSubmit={onSubmit}>
        <input aria-label="Name" />
      </FormDialog>
    ));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('come back the moment a popover that pauses them closes', async () => {
    await expectPausedOnlyWhileOpen('Emoji', (open) => (
      <Popover open={open}>
        <PopoverTrigger render={<button type="button">Emoji wählen</button>} />
        <PopoverContent title="Emoji" pauseShortcuts>
          <button type="button">😀</button>
        </PopoverContent>
      </Popover>
    ));
  });

  it('leave a popover without pauseShortcuts to the page', async () => {
    const { run, press } = pageShortcut();
    render(
      <Popover open>
        <PopoverTrigger render={<button type="button">Filter</button>} />
        <PopoverContent title="Filter">
          <button type="button">Nur offene</button>
        </PopoverContent>
      </Popover>,
    );
    await screen.findByRole('dialog', { name: 'Filter' });
    press();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('⌘↵ of a FormDialog while it closes', () => {
  it('sends nothing once the dialog closed', async () => {
    const onSubmit = vi.fn();
    const show = (open: boolean) => (
      <FormDialog open={open} onOpenChange={() => undefined} title="Label anlegen" submitLabel="Anlegen" onSubmit={onSubmit}>
        <input aria-label="Name" />
      </FormDialog>
    );
    const { rerender } = render(show(true));
    await screen.findByRole('dialog', { name: 'Label anlegen' });
    const finish = holdClosingAnimation();
    rerender(show(false));
    expect(screen.getByRole('dialog', { name: 'Label anlegen', hidden: true }).isConnected).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...(isMac() ? { metaKey: true } : { ctrlKey: true }) }));
    await act(async () => {});
    expect(onSubmit).not.toHaveBeenCalled();
    await finish();
  });
});
