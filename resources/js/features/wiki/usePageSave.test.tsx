/*
 * The autosave of a wiki page (`usePageSave`) against a fake REST API: the pause, the base version of every save, text
 * typed while a save runs, a failed save and its retry, the draft that outlives the view (`lib/drafts.ts`, K4), a newer
 * page from outside, an emptied title, running uploads, a conflict, a page deleted meanwhile (K5) and an unchanged save
 * on an older base (K17).
 */

import { notifyManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { UploadCounter } from '@/editor/UploadContext';
import { drafts, pageDraft } from '@/lib/drafts';
import { clearLiveGone, isPageGone } from '@/lib/liveGone';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { makePage } from '@/test/fixtures';
import { qk } from '@/hooks/keys';
import type { RichText, Page as WikiPage } from '@/types';
import { SAVE_PAUSE_MS, usePageSave } from './usePageSave';

const doc = (text: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const page = makePage({ id: 'pg_web_domain', title: 'Domain-Umzug', content_json: doc('Erstens'), version: 3 });
const key = pageDraft('pg_web_domain');

let api: MockApi;
let patch: MockRoute;

/** The answer of a save: the page as the server stores it now, one version up (unless `version` says otherwise). */
const stored = (body: unknown, version?: number): { body: { data: WikiPage } } => {
  const sent = body as { title: string; emoji: string | null; content_json: RichText | null; base_version: number };
  return { body: { data: { ...page, title: sent.title, emoji: sent.emoji, content_json: sent.content_json, version: version ?? sent.base_version + 1 } } };
};

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({
  status,
  body: { type: 'about:blank', title: reason, status, reason, ...extra },
});

beforeEach(() => {
  patch = (body) => stored(body);
  api = mockApi({ 'PATCH /api/v1/pages/pg_web_domain': (body, url) => patch(body, url) });
});

afterEach(() => {
  api.restore();
  drafts.clear();
  clearLiveGone();
  act(() => resetToasts());
});

const saves = () => api.calls.filter((call) => call.method === 'PATCH').map((call) => call.body as Record<string, unknown>);

/** Holds every save until the test lets it go, in order. */
function holdSaves() {
  const through = globalThis.fetch;
  const held: (() => void)[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === 'PATCH' ? new Promise<Response>((resolve) => held.push(() => resolve(through(input, init)))) : through(input, init);
  return {
    release: () => act(async () => held.shift()!()),
    get waiting() {
      return held.length;
    },
  };
}

function renderSave(options: { canEdit?: boolean; uploads?: UploadCounter; page?: WikiPage; onTitleRequired?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(
    ({ shown, canEdit }: { shown: WikiPage; canEdit?: boolean }) =>
      usePageSave(shown, { canEdit: canEdit ?? options.canEdit ?? true, uploads: options.uploads, onTitleRequired: options.onTitleRequired }),
    { wrapper, initialProps: { shown: options.page ?? page } as { shown: WikiPage; canEdit?: boolean } },
  );
  return { ...view, client };
}

/**
 * The autosave with the rights as the wiki reads them: from the projects (one query a screen shows); `role` answers
 * each fetch of them, a viewer may not edit.
 */
function renderWithRights(role: () => 'member' | 'viewer') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  let fetches = 0;
  const view = renderHook(
    () => {
      const rights = useQuery({
        queryKey: qk.projects.list({ include_archived: true }),
        queryFn: () => {
          fetches += 1;
          return Promise.resolve(role());
        },
      });
      return { canEdit: rights.data !== 'viewer', save: usePageSave(page, { canEdit: rights.data !== 'viewer' }) };
    },
    { wrapper },
  );
  return { ...view, fetches: () => fetches };
}

describe('usePageSave', () => {
  it('saves after a pause with the base version', async () => {
    const { result } = renderSave();
    expect(result.current.draft).toEqual({ title: 'Domain-Umzug', emoji: null, content: doc('Erstens') });
    act(() => result.current.change({ content: doc('Erstens, zweitens') }));
    // typed text is a draft of the visit at once, on the version it was typed on
    expect(drafts.page(key)).toMatchObject({ content: doc('Erstens, zweitens'), base_version: 3, conflict: null });
    expect(saves()).toHaveLength(0);

    await waitFor(() => expect(saves()).toHaveLength(1), { timeout: SAVE_PAUSE_MS + 2000 });
    expect(saves()[0]).toEqual({ title: 'Domain-Umzug', emoji: null, content_json: doc('Erstens, zweitens'), base_version: 3 });
    await waitFor(() => expect(result.current.state).toBe('saved'));
    expect(result.current.spoken).toBe('Gespeichert');
    expect(result.current.savedAt).toBeInstanceOf(Date);
    expect(drafts.page(key)).toBeNull();

    // the next save is based on the version the last one made
    await act(async () => result.current.change({ emoji: '🧭' }, { now: true }));
    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]).toMatchObject({ emoji: '🧭', base_version: 4 });
  });

  it('saves what is typed during a save on the next run', async () => {
    const hold = holdSaves();
    const { result } = renderSave();
    act(() => result.current.change({ title: 'Domain' }, { now: true }));
    await waitFor(() => expect(hold.waiting).toBe(1));
    expect(result.current.state).toBe('saving');
    expect(result.current.spoken).toBe('Speichert …');

    // typed while the save is on its way: no second save meanwhile
    act(() => result.current.change({ content: doc('Neu') }, { now: true }));
    expect(hold.waiting).toBe(1);
    await hold.release();
    // the next run takes the newest draft, on the version the first save made
    await waitFor(() => expect(hold.waiting).toBe(1), { timeout: SAVE_PAUSE_MS + 2000 });
    await hold.release();
    await waitFor(() => expect(result.current.state).toBe('saved'));
    expect(saves()).toEqual([
      { title: 'Domain', emoji: null, content_json: doc('Erstens'), base_version: 3 },
      { title: 'Domain', emoji: null, content_json: doc('Neu'), base_version: 4 },
    ]);
    expect(drafts.page(key)).toBeNull();
  });

  it('keeps the draft after a failed save and saves it on retry', async () => {
    patch = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });
    const { result } = renderSave();
    act(() => result.current.change({ title: 'Domain' }, { now: true }));
    await waitFor(() => expect(result.current.state).toBe('failed'));
    expect(result.current.spoken).toBe('Nicht gespeichert');
    expect(drafts.page(key)).toMatchObject({ title: 'Domain', base_version: 3 });
    const failure = currentToasts().at(-1)!;
    expect(failure).toMatchObject({ title: '„Domain“ nicht gespeichert', tone: 'error' });

    patch = (body) => stored(body);
    await act(async () => runToastAction(failure.id));
    await waitFor(() => expect(result.current.state).toBe('saved'));
    expect(saves().at(-1)).toMatchObject({ title: 'Domain', base_version: 3 });
    expect(drafts.page(key)).toBeNull();
  });

  it('shows a refused title at the title, without a toast', async () => {
    patch = () => problem(422, 'validation_failed', { errors: { title: ['Der Titel ist zu lang.'] } });
    const { result } = renderSave();
    act(() => result.current.change({ title: 'Domain' }, { now: true }));
    await waitFor(() => expect(result.current.titleError).toBe('Der Titel ist zu lang.'));
    expect(result.current.state).toBe('failed');
    expect(currentToasts()).toHaveLength(0);
    // typing a title again takes the refusal away
    act(() => result.current.change({ title: 'Dom' }));
    expect(result.current.titleError).toBeNull();
  });

  it('brings an unsaved draft back when the page opens again', async () => {
    patch = () => problem(503, 'service_unavailable');
    const first = renderSave();
    act(() => first.result.current.change({ title: 'Domain', content: doc('Halb') }));
    // leaving saves what is typed; the save fails, the draft stays
    first.unmount();
    await waitFor(() => expect(saves()).toHaveLength(1));
    await waitFor(() => expect(drafts.sending(key)).toBe(false));

    const second = renderSave();
    expect(second.result.current.draft).toEqual({ title: 'Domain', emoji: null, content: doc('Halb') });
    expect(second.result.current.state).toBe('failed');

    // a draft the server holds by now is settled: the page shows as it is stored
    second.unmount();
    await waitFor(() => expect(drafts.sending(key)).toBe(false));
    const held = makePage({ ...page, title: 'Domain', content_json: doc('Halb'), version: 4 });
    const third = renderSave({ page: held });
    expect(third.result.current.state).toBe('idle');
    expect(drafts.page(key)).toBeNull();
  });

  it('a draft brought back after someone else saved meets the conflict, it never saves on the newer version', async () => {
    drafts.setPage(key, { title: 'Domain', emoji: null, content: doc('Meins'), base_version: 3, conflict: null });
    const current = makePage({ ...page, title: 'Domain-Umzug (Ida)', version: 5 });
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    const { result } = renderSave({ page: current });
    expect(result.current.draft.content).toEqual(doc('Meins'));

    await act(() => result.current.save());
    expect(saves()).toEqual([{ title: 'Domain', emoji: null, content_json: doc('Meins'), base_version: 3 }]);
    expect(result.current.conflict).toEqual({ message: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    expect(drafts.page(key)?.conflict?.current.version).toBe(5);
    // while the conflict stands, nothing saves
    act(() => result.current.change({ title: 'Domain 2' }, { now: true }));
    await act(() => result.current.save());
    expect(saves()).toHaveLength(1);
    expect(await act(() => result.current.flush())).toBe(false);

    // the conflict comes back with the view
    const again = renderSave({ page: current });
    expect(again.result.current.conflict?.message).toBe('Ida Brenner hat die Seite inzwischen geändert.');
    expect(again.result.current.draft.title).toBe('Domain 2');
  });

  it('keeps the own text on top of the newer version, or loads the other one', async () => {
    const current = makePage({ ...page, title: 'Domain-Umzug (Ida)', content_json: doc('Idas'), version: 5 });
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    const { result } = renderSave();
    await act(async () => result.current.change({ content: doc('Meins') }, { now: true }));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());

    // "Meine Fassung übernehmen": on the stored version, and the server keeps that one as a version first (A307)
    patch = (body) => stored(body);
    await act(async () => result.current.keepMine());
    await waitFor(() => expect(result.current.state).toBe('saved'));
    expect(saves().at(-1)).toEqual({ title: 'Domain-Umzug', emoji: null, content_json: doc('Meins'), base_version: 5, keep_current: true });
    expect(result.current.conflict).toBeNull();

    // "Neu laden": the other text in the editor, the own one gone
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current: { ...current, version: 7 } });
    await act(async () => result.current.change({ content: doc('Noch meins') }, { now: true }));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    act(() => result.current.reload());
    expect(result.current.conflict).toBeNull();
    expect(result.current.draft).toEqual({ title: 'Domain-Umzug (Ida)', emoji: null, content: doc('Idas') });
    expect(drafts.page(key)).toBeNull();
    // the next save is based on the version it loaded
    patch = (body) => stored(body);
    await act(async () => result.current.change({ emoji: '🧭' }, { now: true }));
    await waitFor(() => expect(saves().at(-1)).toMatchObject({ emoji: '🧭', base_version: 7 }));
  });

  it('saves what was typed after Neu laden before it takes the own text back (T15-M1)', async () => {
    const current = makePage({ ...page, title: 'Domain-Umzug (Ida)', content_json: doc('Idas'), version: 5 });
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    const { result } = renderSave();
    await act(async () => result.current.change({ content: doc('Meins') }, { now: true }));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    act(() => result.current.reload());
    patch = (body) => stored(body);
    // typed on the other version, still within the pause when "Rückgängig" comes
    act(() => result.current.change({ content: doc('Idas und meins') }));
    const dropped = currentToasts().find((toast) => toast.title === 'Deine Fassung verworfen')!;

    await act(async () => runToastAction(dropped.id));

    // stored first (nothing typed is lost), then the own text with the conflict against what is stored now
    await waitFor(() => expect(result.current.conflict?.current.version).toBe(6));
    expect(saves().at(-1)).toEqual({ title: 'Domain-Umzug (Ida)', emoji: null, content_json: doc('Idas und meins'), base_version: 5 });
    expect(result.current.draft.content).toEqual(doc('Meins'));
  });

  it('says why undo after reload could not run with an empty title', async () => {
    const current = makePage({ ...page, title: 'Domain-Umzug (Ida)', content_json: doc('Idas'), version: 5 });
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    const onTitleRequired = vi.fn();
    const { result } = renderSave({ onTitleRequired });
    await act(async () => result.current.change({ content: doc('Meins') }, { now: true }));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    act(() => result.current.reload());
    // the title emptied after "Neu laden": the text typed since cannot save first
    act(() => result.current.change({ title: '' }));
    const dropped = currentToasts().find((toast) => toast.title === 'Deine Fassung verworfen')!;

    await act(async () => runToastAction(dropped.id));

    expect(currentToasts().at(-1)).toMatchObject({ title: 'Deine Fassung nicht zurückgeholt: Gib der Seite erst einen Titel.', tone: 'error' });
    expect(onTitleRequired).toHaveBeenCalledTimes(1);
    expect(result.current.titleError).toBe('Gib der Seite einen Titel. Ohne Titel wird nichts gespeichert.');
    expect(result.current.conflict).toBeNull();
    expect(result.current.draft.content).toEqual(doc('Idas'));
    expect(saves()).toHaveLength(1);
  });

  it('undoes after reload once the upload finished', async () => {
    const uploads = new UploadCounter();
    const current = makePage({ ...page, title: 'Domain-Umzug (Ida)', content_json: doc('Idas'), version: 5 });
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    const { result } = renderSave({ uploads });
    await act(async () => result.current.change({ content: doc('Meins') }, { now: true }));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    act(() => result.current.reload());
    patch = (body) => stored(body);
    // a picture uploads into the text typed after "Neu laden"
    act(() => uploads.add(1));
    act(() => result.current.change({ content: doc('Idas mit Bild') }));
    const dropped = currentToasts().find((toast) => toast.title === 'Deine Fassung verworfen')!;

    await act(async () => runToastAction(dropped.id));
    // the toast says it waits, nothing is sent or brought back yet
    expect(currentToasts().at(-1)).toMatchObject({ title: 'Deine Fassung kommt zurück, sobald der Upload fertig ist.', tone: 'neutral' });
    expect(saves()).toHaveLength(1);
    expect(result.current.conflict).toBeNull();
    act(() => uploads.add(-1));
    // the text typed since is saved first, then the own text comes back with the conflict, once
    await waitFor(() => expect(result.current.conflict?.current.version).toBe(6));
    expect(saves()).toHaveLength(2);
    expect(saves()[1]).toEqual({ title: 'Domain-Umzug (Ida)', emoji: null, content_json: doc('Idas mit Bild'), base_version: 5 });
    expect(result.current.draft.content).toEqual(doc('Meins'));
    // at most once: a save that waits for the next upload is only that save, the own text does not come back again
    act(() => result.current.reload());
    act(() => uploads.add(1));
    await act(async () => result.current.change({ content: doc('Idas mit zweitem Bild') }, { now: true }));
    expect(result.current.state).toBe('saving');
    act(() => uploads.add(-1));
    await waitFor(() => expect(saves()).toHaveLength(3));
    await waitFor(() => expect(result.current.state).toBe('saved'));
    await act(async () => {});
    expect(saves()).toHaveLength(3);
    expect(result.current.conflict).toBeNull();
    expect(result.current.draft.content).toEqual(doc('Idas mit zweitem Bild'));
  });

  it('keeps the own version when the view goes while the undo waits for an upload', async () => {
    const uploads = new UploadCounter();
    const current = makePage({ ...page, title: 'Domain-Umzug (Ida)', content_json: doc('Idas'), version: 5 });
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    const { result, unmount } = renderSave({ uploads });
    await act(async () => result.current.change({ content: doc('Meins') }, { now: true }));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    act(() => result.current.reload());
    patch = (body) => stored(body);
    act(() => uploads.add(1));
    act(() => result.current.change({ content: doc('Idas mit Bild') }));
    await act(async () => runToastAction(currentToasts().find((toast) => toast.title === 'Deine Fassung verworfen')!.id));
    expect(currentToasts().at(-1)?.title).toBe('Deine Fassung kommt zurück, sobald der Upload fertig ist.');

    // left before the upload ends: the save on leaving goes, then the own version waits on the page with the conflict
    unmount();
    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]).toMatchObject({ content_json: doc('Idas mit Bild'), base_version: 5 });
    await waitFor(() => expect(drafts.page(key)?.content).toEqual(doc('Meins')));
    expect(drafts.page(key)?.conflict).toMatchObject({ message: 'Ida Brenner hat die Seite inzwischen geändert.', current: { version: 6 } });
    expect(drafts.page(key)?.base_version).toBe(6);
  });

  it('parks the own version when undo after reload finds the right gone', async () => {
    const current = makePage({ ...page, title: 'Domain-Umzug (Ida)', content_json: doc('Idas'), version: 5 });
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    const { result, rerender } = renderSave();
    await act(async () => result.current.change({ content: doc('Meins') }, { now: true }));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    act(() => result.current.reload());
    // made a viewer meanwhile
    rerender({ shown: page, canEdit: false });

    await act(async () => runToastAction(currentToasts().find((toast) => toast.title === 'Deine Fassung verworfen')!.id));

    // the own version stands parked to copy (the sheet shows the draft as ParkedDraft), and a toast says why
    expect(drafts.page(key)?.content).toEqual(doc('Meins'));
    expect(currentToasts().at(-1)).toMatchObject({ title: 'Deine Fassung steht zum Kopieren über der Seite: Du darfst sie nicht mehr bearbeiten.', tone: 'error' });
    expect(saves()).toHaveLength(1);
  });

  it('keeps newer typed text parked when undo after reload finds the right gone', async () => {
    const current = makePage({ ...page, title: 'Domain-Umzug (Ida)', content_json: doc('Idas'), version: 5 });
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    const { result, rerender } = renderSave();
    await act(async () => result.current.change({ content: doc('Meins') }, { now: true }));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    act(() => result.current.reload());
    // typed on the other version, then made a viewer before it saved
    rerender({ shown: page, canEdit: false });
    act(() => result.current.change({ content: doc('Idas und neu') }));

    await act(async () => runToastAction(currentToasts().find((toast) => toast.title === 'Deine Fassung verworfen')!.id));

    expect(drafts.page(key)?.content).toEqual(doc('Idas und neu'));
    expect(currentToasts().at(-1)).toMatchObject({
      title: 'Deine Fassung nicht zurückgeholt: Du darfst die Seite nicht mehr bearbeiten, dein neuerer Text steht zum Kopieren darüber.',
      tone: 'error',
    });
    expect(saves()).toHaveLength(1);
  });

  it('takes a newer page from outside only while nothing is typed', async () => {
    const { result, rerender } = renderSave();
    rerender({ shown: makePage({ ...page, title: 'Domain-Umzug (neu)', version: 4 }) });
    expect(result.current.draft.title).toBe('Domain-Umzug (neu)');

    act(() => result.current.change({ content: doc('Getippt') }));
    // a newer page while text is typed: the text stays, and so does the version it is typed on
    rerender({ shown: makePage({ ...page, title: 'Ganz anders', version: 6 }) });
    expect(result.current.draft).toEqual({ title: 'Domain-Umzug (neu)', emoji: null, content: doc('Getippt') });
    expect(drafts.page(key)?.base_version).toBe(4);
    await act(() => result.current.save());
    expect(saves()[0]).toMatchObject({ content_json: doc('Getippt'), base_version: 4 });

    // an older version than the one it is based on changes nothing
    rerender({ shown: makePage({ ...page, title: 'Alt', version: 2 }) });
    expect(result.current.draft.title).toBe('Domain-Umzug (neu)');
  });

  it('an unchanged save on an older base takes the newer version as its base', async () => {
    // nothing changed on the server's side, so it answers 200 with its newer version
    patch = (body) => stored(body, 8);
    const { result } = renderSave();
    await act(async () => result.current.change({ title: 'Domain' }, { now: true }));
    await waitFor(() => expect(result.current.state).toBe('saved'));
    patch = (body) => stored(body);
    await act(async () => result.current.change({ title: 'Domain 2' }, { now: true }));
    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]).toMatchObject({ base_version: 8 });
  });

  it('sends nothing for a blanked title alone and saves other changes under the old title', async () => {
    const first = renderSave();
    act(() => first.result.current.change({ title: '  ' }, { now: true }));
    // while the page is open, the title says what is missing and nothing goes
    expect(first.result.current.titleError).toBe('Gib der Seite einen Titel. Ohne Titel wird nichts gespeichert.');
    await act(() => first.result.current.save());
    expect(saves()).toHaveLength(0);
    // left with only the title blanked: nothing to keep, nothing sent
    first.unmount();
    expect(saves()).toHaveLength(0);
    expect(drafts.page(key)).toBeNull();

    const second = renderSave();
    act(() => second.result.current.change({ title: '', content: doc('Wichtig') }));
    second.unmount();
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]).toMatchObject({ title: 'Domain-Umzug', content_json: doc('Wichtig') });
    await waitFor(() => expect(currentToasts().map((toast) => toast.title)).toEqual(['„Domain-Umzug“ gespeichert']));
    expect(drafts.page(key)).toBeNull();
  });

  it('waits for running uploads before it saves', async () => {
    const uploads = new UploadCounter();
    const { result } = renderSave({ uploads });
    act(() => uploads.add(1));
    await act(async () => result.current.change({ content: doc('Mit Bild') }, { now: true }));
    expect(saves()).toHaveLength(0);
    expect(result.current.state).toBe('saving');
    act(() => uploads.add(1));
    act(() => uploads.add(-1));
    expect(saves()).toHaveLength(0);
    act(() => uploads.add(-1));
    await waitFor(() => expect(saves()).toHaveLength(1));
    await waitFor(() => expect(result.current.state).toBe('saved'));
    // an upload that ends with nothing waiting saves nothing
    act(() => uploads.add(1));
    act(() => uploads.add(-1));
    expect(saves()).toHaveLength(1);
  });

  it('saves what is typed when the page is left while a picture uploads', async () => {
    const uploads = new UploadCounter();
    const { result, unmount } = renderSave({ uploads });
    act(() => uploads.add(1));
    // a save waits for the upload while the page is open
    await act(async () => result.current.change({ content: doc('Vor dem Bild') }, { now: true }));
    expect(saves()).toHaveLength(0);
    // left meanwhile: the editor is gone and puts no picture in any more, nothing would wake the save up
    unmount();
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]).toMatchObject({ content_json: doc('Vor dem Bild'), base_version: 3 });
    await waitFor(() => expect(drafts.page(key)).toBeNull());
  });

  it('a save that meets a 404 says the page was deleted and keeps the text', async () => {
    patch = () => problem(404, 'not_found');
    const { result, unmount } = renderSave();
    await act(async () => result.current.change({ content: doc('Rette mich') }, { now: true }));
    await waitFor(() => expect(isPageGone('pg_web_domain')).toBe(true));
    expect(currentToasts()).toHaveLength(0);
    expect(drafts.page(key)?.content).toEqual(doc('Rette mich'));
    // a page known to be gone is never asked for again
    await act(async () => result.current.change({ content: doc('Rette mich bitte') }, { now: true }));
    expect(saves()).toHaveLength(1);
    expect(drafts.page(key)?.content).toEqual(doc('Rette mich bitte'));
    // nor when the view goes (here, before the next test forgets which pages are gone)
    unmount();
    expect(saves()).toHaveLength(1);
  });

  it('a save refused with 403 keeps the page, reloads the rights and keeps the text (T14-M5)', async () => {
    patch = () => problem(403, 'wiki_members_only', { detail: 'Nur Mitglieder bearbeiten das Wiki.' });
    let role: 'member' | 'viewer' = 'member';
    const { result, fetches } = renderWithRights(() => role);
    await waitFor(() => expect(fetches()).toBe(1));
    // a member made a viewer meanwhile
    role = 'viewer';
    await act(async () => result.current.save.change({ content: doc('Rette mich') }, { now: true }));
    await waitFor(() => expect(result.current.save.state).toBe('failed'));

    // the page is still there to read, the rights load again and park the text (the sheet shows it, no toast)
    await waitFor(() => expect(result.current.canEdit).toBe(false));
    expect(fetches()).toBe(2);
    expect(isPageGone('pg_web_domain')).toBe(false);
    // the decision waits for the screens to show the rights loaded again: one round of the query's notifications
    await act(() => new Promise<void>((resolve) => notifyManager.schedule(resolve)));
    expect(currentToasts()).toHaveLength(0);
    expect(drafts.page(key)?.content).toEqual(doc('Rette mich'));
  });

  it('says a lasting refusal in one toast, whatever title is typed', async () => {
    patch = () => problem(403, 'wiki_members_only', { detail: 'Nur Mitglieder bearbeiten das Wiki.' });
    const { result, fetches, unmount } = renderWithRights(() => 'member');
    await waitFor(() => expect(fetches()).toBe(1));
    await act(async () => result.current.save.change({ title: 'Domain' }, { now: true }));
    await waitFor(() => expect(currentToasts()).toHaveLength(1));
    await act(async () => result.current.save.change({ title: 'Domain neu' }, { now: true }));
    await waitFor(() => expect(saves()).toHaveLength(2));
    // the second refusal is handled, then its decision waits one round
    await waitFor(() => expect(result.current.save.state).toBe('failed'));
    await act(() => new Promise<void>((resolve) => notifyManager.schedule(resolve)));
    // the rights loaded once for this series of refusals (21i-M3b)
    expect(fetches()).toBe(2);

    // named after the stored title, one toast for the page
    expect(currentToasts().map((toast) => toast.title)).toEqual(['„Domain-Umzug“ nicht gespeichert']);
    // the view goes here: its save on leaving is refused too, before the next test
    unmount();
    await waitFor(() => expect(saves()).toHaveLength(3));
  });

  it('says why a refused save failed while the rights still allow it', async () => {
    patch = () => problem(403, 'wiki_members_only', { detail: 'Nur Mitglieder bearbeiten das Wiki.' });
    const { result, fetches } = renderWithRights(() => 'member');
    await waitFor(() => expect(fetches()).toBe(1));
    await act(async () => result.current.save.change({ content: doc('Rette mich') }, { now: true }));

    // the rights loaded again still say "may" (a rule of the server the browser does not know): the toast says why
    await waitFor(() => expect(currentToasts()).toHaveLength(1));
    expect(fetches()).toBe(2);
    expect(currentToasts()[0]).toMatchObject({
      title: '„Domain-Umzug“ nicht gespeichert',
      description: 'Nur Mitglieder bearbeiten das Wiki. Dein Text bleibt auf der Seite, die nächste Änderung versucht es erneut.',
      tone: 'error',
    });
    expect(result.current.save.state).toBe('failed');
    expect(drafts.page(key)?.content).toEqual(doc('Rette mich'));

    // the next change sends it again
    patch = (body) => stored(body);
    await act(async () => result.current.save.change({ content: doc('Rette mich jetzt') }, { now: true }));
    await waitFor(() => expect(result.current.save.state).toBe('saved'));
    expect(saves().at(-1)).toMatchObject({ content_json: doc('Rette mich jetzt'), base_version: 3 });
  });

  it('loads the rights again once per series of refused saves, not for each (21i-M3b)', async () => {
    patch = () => problem(403, 'wiki_members_only', { detail: 'Nur Mitglieder bearbeiten das Wiki.' });
    const { result, fetches } = renderWithRights(() => 'member');
    await waitFor(() => expect(fetches()).toBe(1));
    await act(async () => result.current.save.change({ content: doc('Eins') }, { now: true }));
    await waitFor(() => expect(currentToasts()).toHaveLength(1));
    expect(fetches()).toBe(2);

    // refused again: the rights just loaded say "may" still; the toast says it again, the rights stay as they are
    const before = saves().length;
    await act(async () => result.current.save.change({ content: doc('Zwei') }, { now: true }));
    await waitFor(() => expect(saves()).toHaveLength(before + 1));
    await waitFor(() => expect(result.current.save.state).toBe('failed'));
    await waitFor(() => expect(currentToasts()[0]?.description).toContain('Nur Mitglieder bearbeiten das Wiki.'));
    expect(currentToasts()).toHaveLength(1);
    expect(fetches()).toBe(2);

    // a save that goes through ends the series: the next refusal loads them again
    patch = (body) => stored(body);
    await act(async () => result.current.save.change({ content: doc('Drei') }, { now: true }));
    await waitFor(() => expect(result.current.save.state).toBe('saved'));
    patch = () => problem(403, 'wiki_members_only', { detail: 'Nur Mitglieder bearbeiten das Wiki.' });
    await act(async () => result.current.save.change({ content: doc('Vier') }, { now: true }));
    await waitFor(() => expect(fetches()).toBe(3));
  });

  it('saves nothing for a reader, and nothing unchanged', async () => {
    const reader = renderSave({ canEdit: false });
    await act(() => reader.result.current.save(true));
    reader.unmount();
    const { result } = renderSave();
    await act(() => result.current.save());
    // typed back to what the server holds: nothing to save, nothing kept
    act(() => result.current.change({ title: 'Domain' }));
    act(() => result.current.change({ title: 'Domain-Umzug' }));
    await act(() => result.current.save());
    expect(saves()).toHaveLength(0);
    expect(drafts.page(key)).toBeNull();
    // forced: it goes anyway
    await act(() => result.current.save(true));
    expect(saves()).toHaveLength(1);
  });

  it('flushes: waits for the save on its way and answers whether everything is saved', async () => {
    const hold = holdSaves();
    const { result } = renderSave();
    act(() => result.current.change({ title: 'Domain' }, { now: true }));
    await waitFor(() => expect(hold.waiting).toBe(1));
    let flushed!: Promise<boolean>;
    act(() => {
      flushed = result.current.flush();
    });
    await hold.release();
    expect(await flushed).toBe(true);
    expect(saves()).toHaveLength(1);
  });

  it('leaves the draft of a view whose save still runs alone, and takes it over when that save fails', async () => {
    const hold = holdSaves();
    patch = () => problem(503, 'service_unavailable');
    const first = renderSave();
    act(() => first.result.current.change({ title: 'Domain' }));
    // left: its save runs on
    first.unmount();
    await waitFor(() => expect(hold.waiting).toBe(1));

    const second = renderSave();
    expect(second.result.current.draft.title).toBe('Domain-Umzug');
    expect(second.result.current.state).toBe('idle');
    await hold.release();
    // the save failed: its text is the draft here, still to save
    await waitFor(() => expect(second.result.current.draft.title).toBe('Domain'));
    expect(second.result.current.state).toBe('failed');
    expect(drafts.page(key)).toMatchObject({ title: 'Domain', base_version: 3 });
  });

  it('takes over the conflict a save of a view that is gone met', async () => {
    const hold = holdSaves();
    const current = makePage({ ...page, version: 5 });
    patch = () => problem(409, 'page_conflict', { detail: 'Ida Brenner hat die Seite inzwischen geändert.', current });
    const first = renderSave();
    act(() => first.result.current.change({ title: 'Domain' }));
    first.unmount();
    await waitFor(() => expect(hold.waiting).toBe(1));

    const second = renderSave();
    await hold.release();
    await waitFor(() => expect(second.result.current.conflict).toEqual({ message: 'Ida Brenner hat die Seite inzwischen geändert.', current }));
    expect(second.result.current.draft.title).toBe('Domain');
  });

  it('saves at once what was typed on while the save of a view that is gone ran', async () => {
    const hold = holdSaves();
    const { result, unmount } = renderSave();
    act(() => result.current.change({ title: 'Domain' }, { now: true }));
    await waitFor(() => expect(hold.waiting).toBe(1));
    act(() => result.current.change({ content: doc('Mehr') }));
    unmount();
    await hold.release();
    // not after the pause: the view is gone
    await waitFor(() => expect(hold.waiting).toBe(1));
    await hold.release();
    expect(saves()).toEqual([
      { title: 'Domain', emoji: null, content_json: doc('Erstens'), base_version: 3 },
      { title: 'Domain', emoji: null, content_json: doc('Mehr'), base_version: 4 },
    ]);
    await waitFor(() => expect(drafts.page(key)).toBeNull());
  });
});
