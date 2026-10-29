import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/api/db';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { plainText } from '@/lib/richtext';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import { preloadEditor } from '@/features/editor/RichTextEditor';
import { WikiScreen } from './WikiScreen';

beforeAll(async () => {
  // jsdom has no layout; the editor measures the selection
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  Element.prototype.scrollIntoView = () => {};
  await preloadEditor();
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => {
  act(() => resetToasts());
});

/** The screen in a router, with the query defaults of the app (hooks/queryClient.ts): cached data count as fresh for 10 s. */
function renderWiki(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path: '/projects/:identifier/wiki/:pageId?', element: <WikiScreen /> }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

/** jsdom is no Mac: mod is the Control key. */
const modEnter = '{Control>}{Enter}{/Control}';

/** Adds text where the editor's caret is (typed keys get mixed up by jsdom behind existing text). */
const paste = (editor: HTMLElement, text: string) =>
  fireEvent.paste(editor, { clipboardData: { files: [], types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') } });

const stored = (id: string) => getDb().pages.find((page) => page.id === id);
const webPages = () => getDb().pages.filter((page) => page.project_id === 'p_web');
const tree = () => screen.findByRole('tree', { name: 'Seiten' });
const toastTitles = () => currentToasts().map((item) => item.title);

describe('the wiki', () => {
  it('shows the tree beside the page and marks the open page in it', async () => {
    renderWiki('/projects/WEB/wiki/pg_web_structure');
    const pages = await tree();
    const current = await within(pages).findByRole('treeitem', { name: 'Seitenstruktur' });

    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.getAttribute('aria-level')).toBe('2');
    expect(within(pages).getByRole('treeitem', { name: 'Projekt-Handbuch' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(pages).getAllByRole('treeitem')).toHaveLength(12);
    expect(((await screen.findByRole('textbox', { name: 'Titel der Seite' })) as HTMLTextAreaElement).value).toBe('Seitenstruktur');
    expect((await screen.findByRole('textbox', { name: 'Inhalt der Seite' })).textContent).toContain('Abgestimmt mit Studio Nordlicht');
  });

  it('moves through the tree with the arrow keys and folds a page away', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_handbook');
    const pages = await tree();
    const handbook = await within(pages).findByRole('treeitem', { name: 'Projekt-Handbuch' });
    // one tab stop: the open page
    expect(handbook.tabIndex).toBe(0);
    expect(within(pages).getByRole('treeitem', { name: 'Seitenstruktur' }).tabIndex).toBe(-1);

    act(() => handbook.focus());
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('Seitenstruktur');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(handbook);
    await user.keyboard('{ArrowLeft}');
    expect(handbook.getAttribute('aria-expanded')).toBe('false');
    expect(within(pages).queryByRole('treeitem', { name: 'Seitenstruktur' })).toBeNull();
    await user.keyboard('{ArrowRight}');
    expect(handbook.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{End}');
    expect(document.activeElement?.textContent).toContain('Kickoff-Notizen');
  });

  it('saves after a short pause and says when in a status region', async () => {
    renderWiki('/projects/WEB/wiki/pg_web_contactform');
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    const sheet = editor.closest('article')!;
    const status = within(sheet).getByRole('status');
    const before = stored('pg_web_contactform')!.version;

    act(() => editor.focus());
    paste(editor, 'Getestet in Safari 18. ');

    await waitFor(() => expect(status.textContent).toContain('Gespeichert vor wenigen Sekunden'), { timeout: 4000 });
    expect(plainText(stored('pg_web_contactform')!.content)).toContain('Getestet in Safari 18.');
    expect(stored('pg_web_contactform')!.version).toBe(before + 1);
    // the region is the same one: screen readers announce only regions they knew before
    expect(within(sheet).getByRole('status')).toBe(status);
  });

  it('shows a conflict when somebody saved in between; "Meine Fassung übernehmen" keeps the other text as a version', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_structure');
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    await user.click(editor);
    paste(editor, 'Meine Ergänzung. ');
    await user.keyboard(modEnter);

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('Jonas Feld hat die Seite inzwischen geändert.');
    expect(editor.textContent).toContain('Meine Ergänzung.');
    expect(editor.textContent).not.toContain('Nachtrag');

    await user.click(within(banner).getByRole('button', { name: 'Meine Fassung übernehmen' }));

    await waitFor(() => expect(plainText(stored('pg_web_structure')!.content)).toContain('Meine Ergänzung.'));
    expect(plainText(stored('pg_web_structure')!.content)).not.toContain('Nachtrag');
    const kept = getDb().page_versions.filter((version) => version.page_id === 'pg_web_structure' && version.author_id === 'u_jonas');
    expect(kept.map((version) => plainText(version.content))).toEqual([expect.stringContaining('Nachtrag: Die Referenzen kommen erst in Phase 2.')]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Neu laden" takes the other text into the editor and drops the own one', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_structure');
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    await user.click(editor);
    paste(editor, 'Meine Ergänzung. ');
    await user.keyboard(modEnter);

    const banner = await screen.findByRole('alert');
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));

    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(editor.textContent).toContain('Nachtrag: Die Referenzen kommen erst in Phase 2.'));
    expect(editor.textContent).not.toContain('Meine Ergänzung.');
    expect(plainText(stored('pg_web_structure')!.content)).not.toContain('Meine Ergänzung.');
  });

  it('"Neu laden" can be taken back: the own text and the banner return', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_structure');
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    await user.click(editor);
    paste(editor, 'Meine Ergänzung. ');
    await user.keyboard(modEnter);
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(editor.textContent).not.toContain('Meine Ergänzung.'));

    const dropped = currentToasts().find((item) => item.title === 'Deine Fassung verworfen');
    expect(dropped?.action?.label).toBe('Rückgängig');
    act(() => runToastAction(dropped!.id));

    await waitFor(() => expect(editor.textContent).toContain('Meine Ergänzung.'));
    const banner = await screen.findByRole('alert');
    await user.click(within(banner).getByRole('button', { name: 'Meine Fassung übernehmen' }));
    await waitFor(() => expect(plainText(stored('pg_web_structure')!.content)).toContain('Meine Ergänzung.'));
  });

  it('a conflict met on leaving comes back with the page as the server has it: "Neu laden" shows the colleague’s text and name', async () => {
    const user = userEvent.setup();
    const { router } = renderWiki('/projects/WEB/wiki/pg_web_structure');
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    act(() => editor.focus());
    paste(editor, 'Meine Ergänzung. ');
    // left before the pause runs out: the save on leaving meets the conflict
    await act(() => router.navigate('/projects/WEB/wiki/pg_web_kickoff'));
    await waitFor(() => expect(toastTitles()).toContain('„Seitenstruktur“ nicht gespeichert'));

    // opened again, as the toast's "Öffnen" does
    await act(() => router.navigate('/projects/WEB/wiki/pg_web_structure'));
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('Jonas Feld hat die Seite inzwischen geändert.');
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));

    const again = screen.getByRole('textbox', { name: 'Inhalt der Seite' });
    await waitFor(() => expect(again.textContent).toContain('Nachtrag: Die Referenzen kommen erst in Phase 2.'));
    expect(again.textContent).not.toContain('Meine Ergänzung.');
    expect(screen.getByText(/Zuletzt geändert von Jonas Feld/)).toBeTruthy();
  });

  it('a conflict met on leaving: "Meine Fassung übernehmen" saves on the first press after opening the page again', async () => {
    const user = userEvent.setup();
    const { router } = renderWiki('/projects/WEB/wiki/pg_web_structure');
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    act(() => editor.focus());
    paste(editor, 'Meine Ergänzung. ');
    await act(() => router.navigate('/projects/WEB/wiki/pg_web_kickoff'));
    await waitFor(() => expect(toastTitles()).toContain('„Seitenstruktur“ nicht gespeichert'));
    await act(() => router.navigate('/projects/WEB/wiki/pg_web_structure'));

    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Meine Fassung übernehmen' }));

    await waitFor(() => expect(plainText(stored('pg_web_structure')!.content)).toContain('Meine Ergänzung.'));
    expect(plainText(stored('pg_web_structure')!.content)).not.toContain('Nachtrag');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('after taking back "Neu laden", a version saved meanwhile counts: "Meine Fassung übernehmen" saves at once', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_structure');
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    await user.click(editor);
    paste(editor, 'Meine Ergänzung. ');
    await user.keyboard(modEnter);
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Neu laden' }));
    // written on in the colleague's text and saved: version 5
    paste(editor, 'Noch ein Satz. ');
    await user.keyboard(modEnter);
    await waitFor(() => expect(stored('pg_web_structure')!.version).toBe(5));

    act(() => runToastAction(currentToasts().find((item) => item.title === 'Deine Fassung verworfen')!.id));
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Meine Fassung übernehmen' }));

    await waitFor(() => expect(plainText(stored('pg_web_structure')!.content)).toContain('Meine Ergänzung.'));
    expect(stored('pg_web_structure')!.version).toBe(6);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaving a page with an empty title keeps the text: it is saved under the title the page had', async () => {
    const { router } = renderWiki('/projects/WEB/wiki/pg_web_kickoff');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Titel der Seite' }), { target: { value: '' } });
    const editor = screen.getByRole('textbox', { name: 'Inhalt der Seite' });
    act(() => editor.focus());
    paste(editor, 'Wichtiger Absatz. ');

    await act(() => router.navigate('/projects/WEB/wiki/pg_web_meetings'));

    await waitFor(() => expect(plainText(stored('pg_web_kickoff')!.content)).toContain('Wichtiger Absatz.'));
    expect(stored('pg_web_kickoff')!.title).toBe('Kickoff-Notizen');
    expect(toastTitles()).toContain('„Kickoff-Notizen“ gespeichert');
    // opened again: the cache holds the page as the save answered, so the text is there at once
    await act(() => router.navigate('/projects/WEB/wiki/pg_web_kickoff'));
    expect((await screen.findByRole('textbox', { name: 'Inhalt der Seite' })).textContent).toContain('Wichtiger Absatz.');
  });

  it('keeps drafts per person: somebody else sees the page as it is, the person gets the draft back', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_structure');
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    await user.click(editor);
    paste(editor, 'Meine Ergänzung. ');
    await user.keyboard(modEnter);
    await screen.findByRole('alert');

    // "Als Ida Brenner ansehen"
    act(() => asUser('u_ida'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Inhalt der Seite' }).textContent).not.toContain('Meine Ergänzung.');
    expect(plainText(stored('pg_web_structure')!.content)).not.toContain('Meine Ergänzung.');

    act(() => asUser('u_mara'));
    const banner = await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: 'Inhalt der Seite' }).textContent).toContain('Meine Ergänzung.');
    // resolved, so no draft is left for the next test
    await user.click(within(banner).getByRole('button', { name: 'Neu laden' }));
  });

  it('names a single subpage in the singular', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_meetings');
    await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));

    const ask = await screen.findByRole('alertdialog', { name: '„Meetings“ mit 1 Unterseite löschen?' });
    expect(ask.textContent).toContain('Mit der Seite verschwindet auch ihre Unterseite „Kickoff-Notizen“.');
    await user.click(within(ask).getByRole('button', { name: '2 Seiten löschen' }));
    await waitFor(() => expect(toastTitles()).toContain('„Meetings“ und 1 Unterseite gelöscht'));
  });

  it('names how many subpages go along, hides them at once, and deletes only when the toast runs out', async () => {
    const user = userEvent.setup();
    const { router } = renderWiki('/projects/WEB/wiki/pg_web_handbook');
    await screen.findByRole('textbox', { name: 'Inhalt der Seite' });

    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));
    const ask = await screen.findByRole('alertdialog', { name: '„Projekt-Handbuch“ mit 4 Unterseiten löschen?' });
    expect(ask.textContent).toContain('Seitenstruktur');
    await user.click(within(ask).getByRole('button', { name: '5 Seiten löschen' }));

    const pages = await tree();
    await waitFor(() => expect(within(pages).queryByRole('treeitem', { name: 'Seitenstruktur' })).toBeNull());
    expect(within(pages).queryByRole('treeitem', { name: 'Projekt-Handbuch' })).toBeNull();
    expect(router.state.location.pathname).toBe('/projects/WEB/wiki');
    expect(toastTitles()).toContain('„Projekt-Handbuch“ und 4 Unterseiten gelöscht');
    expect(webPages()).toHaveLength(12);

    // "Rückgängig": all five are back, and so is the page that was open
    act(() => runToastAction(currentToasts().find((item) => item.title.startsWith('„Projekt-Handbuch“'))!.id));
    expect(await within(pages).findByRole('treeitem', { name: 'Seitenstruktur' })).toBeTruthy();
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/WEB/wiki/pg_web_handbook'));

    // again, and this time the toast runs out
    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '5 Seiten löschen' }));
    await waitFor(() => expect(toastTitles()).toContain('„Projekt-Handbuch“ und 4 Unterseiten gelöscht'));
    act(() => dismissToast(currentToasts().find((item) => item.title.startsWith('„Projekt-Handbuch“'))!.id));
    await waitFor(() => expect(webPages()).toHaveLength(7));
  });

  it('deletes a page without subpages without asking, with undo', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_kickoff');
    await screen.findByRole('textbox', { name: 'Inhalt der Seite' });

    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));

    await waitFor(() => expect(toastTitles()).toContain('„Kickoff-Notizen“ gelöscht'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => dismissToast(currentToasts().find((item) => item.title === '„Kickoff-Notizen“ gelöscht')!.id));
    await waitFor(() => expect(stored('pg_web_kickoff')).toBeUndefined());
  });

  it('deletes the page of the focused row with mod+backspace, not the open page', async () => {
    const user = userEvent.setup();
    const { router } = renderWiki('/projects/WEB/wiki/pg_web_structure');
    const pages = await tree();
    const kickoff = await within(pages).findByRole('treeitem', { name: 'Kickoff-Notizen' });

    act(() => kickoff.focus());
    await user.keyboard('{Control>}{Backspace}{/Control}');

    await waitFor(() => expect(toastTitles()).toContain('„Kickoff-Notizen“ gelöscht'));
    expect(within(pages).queryByRole('treeitem', { name: 'Kickoff-Notizen' })).toBeNull();
    expect(within(pages).getByRole('treeitem', { name: 'Seitenstruktur' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/projects/WEB/wiki/pg_web_structure');
  });

  it('moves a page by keyboard with "Verschieben nach …"', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_kickoff');
    await screen.findByRole('textbox', { name: 'Inhalt der Seite' });

    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Verschieben nach/ }));
    const dialog = await screen.findByRole('dialog', { name: '„Kickoff-Notizen“ verschieben nach …' });

    await user.click(within(dialog).getByRole('combobox', { name: /^Übergeordnete Seite/ }));
    await user.click(await screen.findByRole('option', { name: 'Projekt-Handbuch' }));
    await user.click(within(dialog).getByRole('button', { name: /^Verschieben/ }));

    await waitFor(() => expect(stored('pg_web_kickoff')!.parent_id).toBe('pg_web_handbook'));
    const siblings = webPages()
      .filter((page) => page.parent_id === 'pg_web_handbook')
      .sort((a, b) => (a.rank < b.rank ? -1 : 1))
      .map((page) => page.id);
    expect(siblings.at(-1)).toBe('pg_web_kickoff');
    const moved = await within(await tree()).findByRole('treeitem', { name: 'Kickoff-Notizen' });
    expect(moved.getAttribute('aria-level')).toBe('2');
  });

  it('says why nothing moves when the page would stay where it is', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_kickoff');
    await screen.findByRole('textbox', { name: 'Inhalt der Seite' });
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Verschieben nach/ }));
    const dialog = await screen.findByRole('dialog', { name: '„Kickoff-Notizen“ verschieben nach …' });

    await user.click(within(dialog).getByRole('button', { name: /^Verschieben/ }));

    expect(await within(dialog).findByText(/Die Seite steht schon an dieser Stelle/)).toBeTruthy();
    expect(stored('pg_web_kickoff')!.parent_id).toBe('pg_web_meetings');
  });

  it('lists the kept versions and restores one as a new version', async () => {
    const user = userEvent.setup();
    renderWiki('/projects/WEB/wiki/pg_web_structure');
    const editor = await screen.findByRole('textbox', { name: 'Inhalt der Seite' });

    await user.click(screen.getByRole('button', { name: 'Versionen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'Versionen von „Seitenstruktur“' });
    const choices = await within(dialog).findAllByRole('radio');
    expect(choices).toHaveLength(3);
    await user.click(within(dialog).getByRole('radio', { name: /^Version 1,/ }));
    expect(within(dialog).getByRole('region', { name: 'Vorschau' }).textContent).toContain('Impressum');
    await user.click(within(dialog).getByRole('button', { name: 'Diese Version wiederherstellen' }));

    await waitFor(() => expect(stored('pg_web_structure')!.version).toBe(4));
    expect(plainText(stored('pg_web_structure')!.content)).not.toContain('Anfahrt');
    await waitFor(() => expect(toastTitles()).toContain('Version 1 wiederhergestellt'));
    await waitFor(() => expect(editor.textContent).not.toContain('Anfahrt'));
  });

  it('lets a viewer read the page, without fields to edit', async () => {
    asUser('u_theo');
    renderWiki('/projects/WEB/wiki/pg_web_structure');

    expect(await screen.findByRole('heading', { level: 1, name: /Seitenstruktur/ })).toBeTruthy();
    expect(await screen.findByText(/Abgestimmt mit Studio Nordlicht/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Titel der Seite' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Inhalt der Seite' })).toBeNull();
    expect(screen.getByRole('button', { name: /Neue Seite/ }).getAttribute('aria-disabled')).toBe('true');
  });

  it('says so when a page does not exist', async () => {
    renderWiki('/projects/WEB/wiki/pg_nope');
    expect(await screen.findByText('Diese Seite gibt es nicht')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zur Übersicht des Wikis' })).toBeTruthy();
  });

  it('opens on an overview of the latest changes', async () => {
    renderWiki('/projects/WEB/wiki');
    expect(await screen.findByRole('heading', { level: 1, name: 'Wiki' })).toBeTruthy();
    const latest = await screen.findByRole('list', { name: 'Zuletzt geändert' });
    expect(within(latest).getAllByRole('link')[0].textContent).toContain('Domain-Umzug');
  });
});
