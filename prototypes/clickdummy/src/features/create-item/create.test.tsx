import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/api/db';
import { currentToasts, dismissToast } from '@/components/ui/toast';
import { useUiStore } from '@/store/ui';
import { resetApi } from '@/test/api';
import { preloadEditor } from '@/features/editor/RichTextEditor';
import { CreateItemDialog } from './CreateItemDialog';

beforeAll(async () => {
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  await preloadEditor();
});

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const webItems = () => getDb().items.filter((item) => item.project_id === 'p_web').length;

describe('CreateItemDialog', () => {
  it('waits while a property still shows a text it refuses, and shows the refusals of the server at their fields', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithData(<CreateItemDialog open defaults={{ project_id: 'p_web', type_id: 't_bug' }} onOpenChange={onOpenChange} />);
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    const before = webItems();

    await user.type(await within(dialog).findByRole('textbox', { name: /Titel/ }), 'Formular-Fehler auf Android');
    // Aufwand takes numbers only: the field refuses "drei" and reports no value
    await user.type(await within(dialog).findByRole('textbox', { name: 'Aufwand (h)' }), 'drei');
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));

    expect(await within(dialog).findByText('Noch nicht angelegt')).toBeTruthy();
    expect(webItems()).toBe(before);
    expect(document.activeElement?.getAttribute('name')).toBe('effort');

    // valid now, but Umgebung is required for bugs: the server says so at the field
    await user.clear(within(dialog).getByRole('textbox', { name: 'Aufwand (h)' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Aufwand (h)' }), '2,5');
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));
    expect(await within(dialog).findByText(/„Umgebung“ ist ein Pflichtfeld/)).toBeTruthy();
    expect(webItems()).toBe(before);
    expect(within(dialog).getByRole('combobox', { name: /^Umgebung/ }).getAttribute('aria-invalid')).toBe('true');

    await user.click(within(dialog).getByRole('combobox', { name: /^Umgebung/ }));
    await user.click(await screen.findByRole('option', { name: 'Produktion' }));
    await user.click(within(dialog).getByRole('button', { name: /Anlegen/ }));

    await waitFor(() => expect(webItems()).toBe(before + 1));
    const created = getDb().items.at(-1)!;
    expect([created.title, created.type_id, created.values.effort, created.values.environment]).toEqual(['Formular-Fehler auf Android', 't_bug', 2.5, 'opt_env_prod']);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
