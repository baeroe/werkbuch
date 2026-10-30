import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../../../lang/de.json';
import { initI18n } from '@/lib/i18n';
import { useUiStore } from '@/store/ui';
import { HelpOverlay, helpGroups } from './HelpOverlay';
import type { ShortcutDef } from './registry';
import { useShortcut } from './useShortcut';

const def = (id: string, keys: string, scope: ShortcutDef['scope'], label: ShortcutDef['label'], group: ShortcutDef['group']): ShortcutDef => ({
  id,
  keys,
  scope,
  label,
  group,
  run: vi.fn(),
});

const GENERAL = 'shortcuts.group.general';
const NAVIGATION = 'shortcuts.group.navigation';
const DIALOG = 'shortcuts.group.dialog';

describe('helpGroups', () => {
  it('leaves out a global shortcut that a page scope binds again, however its keys are spelled', () => {
    const groups = helpGroups([
      def('shell.help', '/', 'global', 'shortcuts.shell.help', GENERAL),
      def('shell.undo', 'c', 'global', 'shortcuts.shell.undo', GENERAL),
      def('shell.close', 'esc', 'global', 'shortcuts.dialog.submit', GENERAL),
      def('list.filter', '/', 'list', 'shortcuts.shell.go.views', DIALOG),
      def('list.clear', 'escape', 'list', 'shortcuts.shell.go.projects', DIALOG),
    ]);

    expect(groups.map(({ group, entries }) => [group, ...entries.map((entry) => `${entry.keys} ${entry.label}`)])).toEqual([
      [GENERAL, 'c shortcuts.shell.undo'],
      [DIALOG, '/ shortcuts.shell.go.views', 'escape shortcuts.shell.go.projects'],
    ]);
  });

  it('puts General and Navigation first, whatever the order of registration, and the other groups after them', () => {
    const groups = helpGroups([
      def('a', 'mod+enter', 'dialog', 'shortcuts.dialog.submit', DIALOG),
      def('b', 'g i', 'global', 'shortcuts.shell.go.inbox', NAVIGATION),
      def('c', '?', 'global', 'shortcuts.shell.help', GENERAL),
    ]);

    expect(groups.map(({ group }) => group)).toEqual([GENERAL, NAVIGATION, DIALOG]);
  });

  it('lists the same keys for the same thing once', () => {
    const groups = helpGroups([
      def('list.help', '?', 'list', 'shortcuts.shell.help', GENERAL),
      def('detail.help', '?', 'detail', 'shortcuts.shell.help', GENERAL),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(1);
  });
});

/** Registers what the shell registers, so the overlay has something to list. */
function Shortcuts() {
  useShortcut('shell.help', vi.fn());
  useShortcut('shell.go.inbox', vi.fn());
  return null;
}

const dialog = () => screen.getByRole('dialog', { name: 'Tastaturkürzel' });

beforeEach(() => useUiStore.setState(useUiStore.getInitialState()));

describe('HelpOverlay', () => {
  it('renders nothing while the help is closed', () => {
    render(
      <>
        <Shortcuts />
        <HelpOverlay />
      </>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists the registered shortcuts in groups, General first, with their keys and the texts of the language', () => {
    render(
      <>
        <Shortcuts />
        <HelpOverlay />
      </>,
    );

    act(() => useUiStore.getState().setHelpOpen(true));

    const headings = within(dialog())
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['Allgemein', 'Navigation']);

    const general = within(dialog()).getByRole('region', { name: 'Allgemein' });
    expect(within(general).getByText('Alle Kürzel')).toBeTruthy();
    expect(within(general).getByRole('img', { name: 'Fragezeichen' })).toBeTruthy();

    const navigation = within(dialog()).getByRole('region', { name: 'Navigation' });
    expect(within(navigation).getByText('Inbox')).toBeTruthy();
    expect(within(navigation).getByRole('img', { name: /^G dann I$/ })).toBeTruthy();
  });

  it('says in its description which keys work while typing', () => {
    render(<HelpOverlay />);
    act(() => useUiStore.getState().setHelpOpen(true));

    const description = dialog().getAttribute('aria-describedby') ?? '';
    const text = document.getElementById(description);
    expect(text?.textContent).toContain('Beim Schreiben in einem Feld wirken nur');
    expect(within(text as HTMLElement).getAllByRole('img')).toHaveLength(3);
  });

  it('speaks English when the page does', () => {
    initI18n({ locale: 'en', translations: { ...de, 'shortcuts.help.title': 'Keyboard shortcuts', 'shortcuts.help.description': 'Only :keys work.' } });
    render(<HelpOverlay />);
    act(() => useUiStore.getState().setHelpOpen(true));

    const text = document.getElementById(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }).getAttribute('aria-describedby') ?? '');
    expect(text?.textContent).toMatch(/^Only .*, .* and .* work\.$/);
  });

  it('starts with the focus on the list, not on the close button', async () => {
    render(
      <>
        <Shortcuts />
        <HelpOverlay />
      </>,
    );
    act(() => useUiStore.getState().setHelpOpen(true));

    // the list holds the groups: the focus sits on the element around them
    await waitFor(() => expect(within(document.activeElement as HTMLElement).queryAllByRole('heading', { level: 3 })).toHaveLength(2));
    expect(document.activeElement).not.toBe(dialog());
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<HelpOverlay />);
    act(() => useUiStore.getState().setHelpOpen(true));

    await user.keyboard('{Escape}');

    expect(useUiStore.getState().helpOpen).toBe(false);
  });
});
