import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/lib/i18n';
import en from '../../../../lang/en.json';
import { EmojiPicker } from './EmojiPicker';

const search = () => screen.getByRole('searchbox', { name: 'Emoji suchen' }) as HTMLInputElement;
const focusedName = () => (document.activeElement as HTMLElement).getAttribute('aria-label');

afterEach(() => vi.restoreAllMocks());

describe('EmojiPicker', () => {
  it('shows the six groups with their emoji, named for assistive technology', () => {
    render(<EmojiPicker onPick={() => {}} className="mx-1" />);

    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Häufig', 'Gesichter', 'Gesten', 'Arbeit', 'Natur und Essen', 'Symbole']);
    expect(screen.getAllByRole('button')).toHaveLength(48);
    expect(screen.getByRole('button', { name: 'Daumen hoch' }).textContent).toBe('👍');
    expect(search().placeholder).toBe('Suchen, z. B. Daumen …');
    expect(screen.getByText('Emoji wählen oder eins eintippen')).toBeTruthy();
  });

  it('the search narrows the set by name and shows the hits as one group', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={() => {}} />);

    await user.type(search(), 'daumen');

    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Treffer']);
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Daumen hoch', 'Daumen runter', 'Daumen drücken']);
  });

  it('starts with the text it is given', () => {
    render(<EmojiPicker onPick={() => {}} defaultQuery="xyz" />);

    expect(search().value).toBe('xyz');
    expect(screen.getByText('Kein Emoji mit „xyz“.')).toBeTruthy();
    // nothing typed that could be an emoji: no offer to use it
    expect(screen.queryByRole('button', { name: 'Dieses Emoji verwenden' })).toBeNull();
  });

  it('Enter in the search picks the first hit, and the arrow down leads into the grid', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    await user.type(search(), 'daumen');

    await user.keyboard('{ArrowDown}');
    expect(focusedName()).toBe('Daumen hoch');
    act(() => search().focus());
    await user.keyboard('{Enter}');

    expect(onPick).toHaveBeenCalledWith('👍');
  });

  it('Enter and the arrow keys in the search do nothing when there is nothing to pick or to enter', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} defaultQuery="xyz" />);
    act(() => search().focus());

    await user.keyboard('{Enter}{ArrowDown}');

    expect(onPick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(search());
  });

  it('the arrow keys move through the grid and Enter picks the emoji that has the focus', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: 'Daumen hoch' }));
    onPick.mockClear();
    act(() => screen.getByRole('button', { name: 'Daumen hoch' }).focus());

    await user.keyboard('{ArrowRight}');
    expect(focusedName()).toBe('Daumen runter');
    // the shown name follows the focus
    expect(screen.getByText('Daumen runter', { selector: 'p' })).toBeTruthy();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(focusedName()).toBe('Daumen hoch');
    await user.keyboard('{End}');
    expect(focusedName()).toBe('Zielscheibe');
    await user.keyboard('{ArrowRight}');
    expect(focusedName()).toBe('Zielscheibe');
    await user.keyboard('{Home}');
    expect(focusedName()).toBe('Daumen hoch');
    await user.keyboard('{ArrowRight}{Enter}');

    expect(onPick).toHaveBeenCalledWith('👎');
    // other keys stay with the browser
    expect(fireEvent.keyDown(document.activeElement!, { key: 'x' })).toBe(true);
  });

  it('up and down keep the column across the rows of the grid, which has 8 columns from md on', async () => {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = real(element, pseudo);
      return element.hasAttribute('data-emoji-grid') ? ({ gridTemplateColumns: Array(8).fill('1fr').join(' ') } as CSSStyleDeclaration) : style;
    });
    const user = userEvent.setup();
    render(<EmojiPicker onPick={() => {}} />);
    act(() => screen.getByRole('button', { name: 'Herz' }).focus());

    await user.keyboard('{ArrowDown}');
    expect(focusedName()).toBe('Zwinkern');
    await user.keyboard('{ArrowUp}');
    expect(focusedName()).toBe('Herz');
    // above the first row and below the last one the focus stays
    await user.keyboard('{ArrowUp}');
    expect(focusedName()).toBe('Herz');
    act(() => screen.getByRole('button', { name: 'Funkeln' }).focus());
    await user.keyboard('{ArrowDown}');
    expect(focusedName()).toBe('Funkeln');
  });

  it('on a phone the grid has 7 columns, so the last emoji of a group wraps to a row of its own', async () => {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = real(element, pseudo);
      return element.hasAttribute('data-emoji-grid') ? ({ gridTemplateColumns: Array(7).fill('1fr').join(' ') } as CSSStyleDeclaration) : style;
    });
    const user = userEvent.setup();
    render(<EmojiPicker onPick={() => {}} />);
    act(() => screen.getByRole('button', { name: 'Rakete' }).focus());

    // Rakete is the 7th of its group and Erledigt (8th) stands alone in the next row, in column 0: from there the column is kept
    await user.keyboard('{ArrowDown}');
    expect(focusedName()).toBe('Erledigt');
    await user.keyboard('{ArrowDown}');
    expect(focusedName()).toBe('Tränen lachen');
  });

  it('shows the name of the emoji under the pointer', () => {
    render(<EmojiPicker onPick={() => {}} />);

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Rakete' }));

    expect(screen.getByText('Rakete', { selector: 'p' })).toBeTruthy();
  });

  it('picks with a click', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    await user.click(screen.getByRole('button', { name: 'Feuer' }));

    expect(onPick).toHaveBeenCalledWith('🔥');
  });

  it.each([
    ['a flag', '🇩🇪'],
    ['a keycap', '1️⃣'],
    ['a sequence with a skin tone', '👍🏽'],
    ['a sequence joined by zero-width joiners', '👩‍💻'],
    ['an emoji with a variation selector', '✌️'],
  ])('takes %s that is typed into the search: Enter picks it', (_, typed) => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    fireEvent.change(search(), { target: { value: typed } });
    expect(screen.getByText(`Kein Emoji mit „${typed}“.`)).toBeTruthy();
    fireEvent.keyDown(search(), { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(typed);
  });

  it('offers a typed emoji as a button, hidden from screen readers in its glyph', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    fireEvent.change(search(), { target: { value: '  🇩🇪 ' } });

    const use = screen.getByRole('button', { name: 'Dieses Emoji verwenden' });
    expect(use.querySelector('[aria-hidden="true"]')?.textContent).toBe('🇩🇪');
    await user.click(use);

    expect(onPick).toHaveBeenCalledWith('🇩🇪');
  });

  it('does not take a plain digit or a number sign as an emoji', () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);

    fireEvent.change(search(), { target: { value: '1 #' } });
    fireEvent.keyDown(search(), { key: 'Enter' });

    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Dieses Emoji verwenden' })).toBeNull();
  });

  it('searches the names of an English page and says everything in English', async () => {
    initI18n({ locale: 'en', translations: en });
    const user = userEvent.setup();
    render(<EmojiPicker onPick={() => {}} />);

    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toContain('Nature and food');
    expect(screen.getByRole('searchbox', { name: 'Search emoji' }).getAttribute('placeholder')).toBe('Search, e.g. thumbs up …');
    expect(screen.getByText('Pick an emoji or type one')).toBeTruthy();

    await user.type(screen.getByRole('searchbox'), 'thumbs');

    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Thumbs up', 'Thumbs down']);
    expect(within(screen.getByRole('group')).getByRole('button', { name: 'Thumbs up' })).toBeTruthy();
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Matches');

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No emoji matching “zzz”.')).toBeTruthy();
  });
});
