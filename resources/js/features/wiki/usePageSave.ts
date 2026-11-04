/*
 * The autosave of a wiki page (spec 4.15; ported from the clickdummy's PageView.tsx as a hook, 13b): title, emoji and
 * text save themselves after a pause in typing (`SAVE_PAUSE_MS`), when the focus leaves the text, on ⌘↵ (`wiki.save`)
 * and when the page is left. Every save says which version it is based on (`base_version`); the version of every
 * answer is the next base, also of a save that changed nothing (K17).
 *
 *   const save = usePageSave(page, { canEdit, uploads });
 *   save.change({ title }); save.change({ emoji }, { now: true }); await save.flush();
 *
 * - What is typed while a save runs is saved by the next run, on the version that save made.
 * - Typed text the server does not hold yet is a draft of the visit (`lib/drafts.ts`, `page:<id>`, K4): with the
 *   version it was typed on and the conflict a save met, so it outlives the view and comes back when the page opens
 *   again, always saved on its own version (a newer page meanwhile means the 409, never a silent overwrite). A draft
 *   the server holds by now is forgotten; another person signing in forgets it (`drafts.clear()`). While a save of a
 *   view that is gone runs, a view opened meanwhile leaves its draft alone, and takes it over should that save fail.
 * - A newer page from outside (live, an own restore) shows only while nothing is typed; while text is typed it neither
 *   replaces the text nor moves the base version (Phase 8: the next save meets the conflict instead).
 * - A blank title: while the page is open the title says what is missing and nothing goes; a page left with only its
 *   title blanked sends nothing, one left with other changes saves them under the title it had, with a toast.
 * - Running uploads (the editor's `UploadCounter`): a save waits until they are stored, an upload on its way is no
 *   node in the text yet. Uploads belong to nobody until the page saves (A232). A page left meanwhile saves at once:
 *   its editor is gone and puts no picture in any more, and nothing would wake a waiting save up.
 * - A failed save (5xx, no answer) keeps the text, says "Nicht gespeichert" and raises an error toast with "Erneut
 *   versuchen"; a 422 at `title` stands at the title. A 404 means the page is gone (deleted meanwhile, K5): it is
 *   marked as gone (`markLiveGone`), the text stays in the draft to copy, nothing is retried, no toast. A 403 means the
 *   right is gone (made a viewer, T14-M5): the rights load again (`projects`), the text stays in the draft, and the
 *   sheet shows it parked with the reason (`ParkedDraft`), no toast.
 * - A conflict (409 `page_conflict`) stops the saves until it is settled, and the save state says "Nicht gespeichert".
 *   The stored page it brings goes into the cache (only when newer, Task 12) and the tree goes stale. Its sentence
 *   names who saved meanwhile; was that the person's own account (another window), it says so instead (T4-M5). The
 *   conflict lives in the draft beside the text: it outlives the view, and a save on leaving that meets one says so in
 *   a toast with "Öffnen" (`href`). While it stands, leaving the tab asks.
 *   - `reload()` takes the stored page into the editor and drops the own text, with a toast whose "Rückgängig" (⌘Z
 *     with the focus outside a text field) brings the own text and the conflict back; a version this view saved since
 *     then is what the conflict is about now (13c). The editor's own undo stops at the reloaded page (it never enters
 *     the editor's history), so it never saves the own text over the other one without the conflict.
 *   - A conflict that stands when the view goes says so in the same toast with "Öffnen"; nothing is sent then.
 *   - `keepMine()` saves the own text on top of the stored version (or of a newer own one) and asks the server to keep
 *     the stored state as a version first (`keep_current`, A307), so an own version from another window or saved
 *     after a taken-back "Neu laden" stays too.
 */

import { router } from '@inertiajs/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { toast } from '@/components/ui/toast';
import { isEmptyDoc } from '@/editor/RichTextEditor';
import type { UploadCounter } from '@/editor/UploadContext';
import { qk } from '@/hooks/keys';
import { useSavePage } from '@/hooks/pages';
import { drafts, pageDraft, useDraftSending, usePageDraft, type PageDraft } from '@/lib/drafts';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { isPageGone, markLiveGone } from '@/lib/liveGone';
import { undoLabel } from '@/lib/undo';
import type { RichText, Page as WikiPage } from '@/types';

/** The pause in typing after which the page saves itself. */
export const SAVE_PAUSE_MS = 1200;
/** The longest title of a page (A319). */
export const MAX_TITLE = 200;

/** What the person edits of a page. */
export interface PageFields {
  title: string;
  emoji: string | null;
  content: RichText | null;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export interface PageConflict {
  /** The server's sentence: "Ida Brenner hat die Seite inzwischen geändert." */
  message: string;
  /** The page as it is stored. */
  current: WikiPage;
}

const fieldsOf = (page: WikiPage): PageFields => ({ title: page.title, emoji: page.emoji, content: page.content_json });
const fieldsOfDraft = ({ title, emoji, content }: PageDraft): PageFields => ({ title, emoji, content });

/** Object keys in one order: the editor writes `text` before `marks`, a document that went through the cache may not. */
const sortedKeys = (_key: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) : value;
/** A text as a save sends it (an empty document as null), for comparing. */
const asSent = (doc: RichText | null): string => JSON.stringify(isEmptyDoc(doc) ? null : doc, sortedKeys);
const same = (a: PageFields, b: PageFields) => a.title === b.title && a.emoji === b.emoji && asSent(a.content) === asSent(b.content);

/** The conflict a refused save met; the server names whoever saved last, which may be the writer in another window. */
function conflictOf(error: unknown, me: string | undefined): PageConflict | null {
  if (!(error instanceof ApiError) || error.reason !== 'page_conflict' || !error.current) return null;
  const current = error.current as WikiPage;
  return { message: me !== undefined && current.updated_by === me ? t('wiki.conflict.self') : error.message, current };
}

/** The newest of the pages (by version). */
const newest = (first: WikiPage, ...more: (WikiPage | undefined)[]): WikiPage => more.reduce<WikiPage>((a, b) => (b && b.version > a.version ? b : a), first);

/** The page is gone for the writer: deleted meanwhile, or a project they no longer see. */
const isGone = (error: unknown) => error instanceof ApiError && error.status === 404;
/** Refused for want of the right (a member made a viewer meanwhile): the page is still there to read. */
const isRefused = (error: unknown) => error instanceof ApiError && error.status === 403;

export interface PageSave {
  /** The page as it reads in the view: what is typed, or the stored page. */
  draft: PageFields;
  change(patch: Partial<PageFields>, options?: { now?: boolean }): void;
  /** Saves what is typed now; `force` sends even what the server holds already. */
  save(force?: boolean): Promise<void>;
  state: SaveState;
  savedAt: Date | null;
  /** The state in words, for the status region: "Speichert …", "Gespeichert", "Nicht gespeichert". */
  spoken: string;
  titleError: string | null;
  conflict: PageConflict | null;
  /** The conflict settled with the stored page: the own text is gone, until the toast's "Rückgängig". */
  reload(): void;
  /** The conflict settled with the own text: saved on top of the stored version, which is kept as a version first. */
  keepMine(): void;
  /** Saves what is typed and waits for a save on its way; false while something is unsaved (a conflict, a failure). */
  flush(): Promise<boolean>;
}

export interface PageSaveOptions {
  canEdit: boolean;
  uploads?: UploadCounter;
  /** The signed-in account: a conflict with its own save (another window) says so. */
  me?: string;
  /** The address of the page, for "Öffnen" of a conflict met after the view went away. */
  href?: string;
}

export function usePageSave(page: WikiPage, { canEdit, uploads, me, href }: PageSaveOptions): PageSave {
  const key = pageDraft(page.id);
  const savePage = useSavePage();
  const queryClient = useQueryClient();
  /** The page's draft and whether a save of it runs, also one of a view that is gone. */
  const shared = usePageDraft(key);
  const sending = useDraftSending(key);

  // what an earlier view left unsaved comes back, unless the server holds it by now; not while a save of it still runs
  const [kept] = useState(() => {
    const draft = drafts.sending(key) ? null : drafts.page(key);
    return draft && (draft.conflict || !same(fieldsOfDraft(draft), fieldsOf(page))) ? draft : null;
  });
  const [draft, setDraft] = useState<PageFields>(kept ? fieldsOfDraft(kept) : fieldsOf(page));
  // a kept conflict meets the newer of the page as it met it and the page as it reads now
  const [conflict, setConflict] = useState<PageConflict | null>(() =>
    kept?.conflict ? { message: kept.conflict.message, current: page.version >= kept.conflict.current.version ? page : kept.conflict.current } : null,
  );
  const [state, setState] = useState<SaveState>(kept ? 'failed' : 'idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  /** The page as typed, for saves that run outside a render. */
  const latest = useRef(draft);
  /** The page as the latest render had it, for an undo that runs later. */
  const latestPage = useRef(page);
  /** The options as the latest render had them. */
  const options = useRef({ me, href });
  /** The version the typed text is based on. */
  const base = useRef(kept ? kept.base_version : page.version);
  /** What the server holds of this view's text. */
  const held = useRef<PageFields>(fieldsOf(page));
  /** Typed text the server does not have yet. */
  const dirty = useRef(kept !== null);
  const inFlight = useRef(false);
  const flight = useRef<Promise<unknown> | null>(null);
  const open = useRef<PageConflict | null>(conflict);
  /** The next save keeps the stored state as a version first ("Meine Fassung übernehmen"). */
  const keepCurrent = useRef(false);
  /** A save waits for the uploads to be stored. */
  const waiting = useRef(false);
  const mounted = useRef(false);
  const editable = useRef(canEdit);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    editable.current = canEdit;
    latestPage.current = page;
    options.current = { me, href };
  });

  /** Typed text the server does not have yet: kept as the page's draft with the version it is typed on. */
  function keepDraft() {
    dirty.current = true;
    drafts.setPage(key, { ...latest.current, base_version: base.current, conflict: open.current });
  }

  /** Nothing typed is left unsaved. */
  function dropDraft() {
    dirty.current = false;
    drafts.setPage(key, null);
  }

  function showConflict(found: PageConflict | null) {
    open.current = found;
    setConflict(found);
  }

  // a draft the server holds by now: nothing to keep. Not while a save of a view that is gone runs: should it fail,
  // its draft is all there is
  useEffect(() => {
    if (!kept && !drafts.sending(key)) drafts.setPage(key, null);
  }, [kept, key]);

  // a newer page from outside shows while nothing is typed here; a version the text is based on or older changes nothing
  useEffect(() => {
    if (open.current || inFlight.current || dirty.current || page.version <= base.current) return;
    base.current = page.version;
    const theirs = fieldsOf(page);
    held.current = theirs;
    latest.current = theirs;
    setDraft(theirs);
  }, [page]);

  // the save of a view that is gone failed (or met a conflict) while this one is open: its draft is the text here
  useEffect(() => {
    if (sending || shared === null || open.current || inFlight.current || dirty.current) return;
    if (!shared.conflict && same(fieldsOfDraft(shared), held.current)) return;
    base.current = shared.base_version;
    latest.current = fieldsOfDraft(shared);
    dirty.current = true;
    setDraft(latest.current);
    if (shared.conflict) showConflict(shared.conflict);
    else setState('failed');
  }, [sending, shared]);

  // the uploads are stored: a save that waited for them goes
  useEffect(() => {
    if (!uploads) return;
    return uploads.subscribe(() => {
      if (uploads.current() > 0 || !waiting.current) return;
      waiting.current = false;
      void save.current();
    });
  }, [uploads]);

  const save = useRef(async (_force?: boolean) => {});
  save.current = async (force = false) => {
    clearTimeout(timer.current);
    if (!editable.current || open.current || inFlight.current || isPageGone(page.id)) return;
    const mine = latest.current;
    if (!force && (!dirty.current || same(mine, held.current))) {
      // typed back to what the server holds
      if (dirty.current) dropDraft();
      return;
    }
    // left meanwhile: the editor is gone, no picture comes into the text any more, so it saves at once
    if (uploads && uploads.current() > 0 && mounted.current) {
      waiting.current = true;
      setState('saving');
      return;
    }
    let title = mine.title.trim();
    /** Left with a blank title: what else is typed goes in under the title the page had. */
    let keptTitle = false;
    if (title === '') {
      if (mounted.current) return setTitleError(t('wiki.page.title_required'));
      if (same({ ...mine, title: held.current.title }, held.current)) return dropDraft();
      title = held.current.title;
      keptTitle = true;
    }

    inFlight.current = true;
    const keep = keepCurrent.current;
    keepCurrent.current = false;
    const epoch = drafts.epoch();
    const done = drafts.startSending(key);
    setState('saving');
    let conflicted: PageConflict | null = null;
    try {
      const request = savePage.mutateAsync({
        id: page.id,
        input: { title, emoji: mine.emoji, content: isEmptyDoc(mine.content) ? null : mine.content, base_version: base.current, ...(keep ? { keep_current: true } : {}) },
      });
      flight.current = request;
      const saved = await request;
      // the next save is based on the version the server has now, also when nothing changed there (K17)
      base.current = saved.version;
      held.current = { ...mine, title };
      if (drafts.epoch() === epoch) {
        // typed on while it saved: that is still to save, on the new version
        if (same(latest.current, mine)) dropDraft();
        else keepDraft();
      }
      setState('saved');
      setSavedAt(new Date());
      setTitleError(null);
      if (keptTitle) toast({ title: t('wiki.save.kept_title.title', { title }), description: t('wiki.save.kept_title.description'), tone: 'success' });
    } catch (error) {
      conflicted = conflictOf(error, options.current.me);
      if (conflicted) setState('failed');
      else if (isGone(error)) {
        // deleted meanwhile (K5): the view says so, the text stays to copy
        markLiveGone(page.id, 'page');
        setState('idle');
      } else if (isRefused(error)) {
        // the right is gone, not the page (T14-M5): the rights load again, and the text stands parked with the reason
        setState('failed');
        void queryClient.invalidateQueries({ queryKey: qk.projects.all });
      } else {
        keepCurrent.current = keep;
        setState('failed');
        const refusal = error instanceof ApiError ? error.errors?.title?.[0] : undefined;
        if (refusal) setTitleError(refusal);
        else notifyError(t('wiki.save.not_saved', { title }), error, () => void save.current());
      }
      if (conflicted) open.current = conflicted;
      // the text is still to save (or to settle): a view that opened meanwhile may have let go of the draft
      if (drafts.epoch() === epoch) keepDraft();
    } finally {
      inFlight.current = false;
      flight.current = null;
      done();
    }
    if (conflicted) {
      showConflict(conflicted);
      const stored = conflicted.current;
      // a refused save refreshes nothing: the page it brought goes into the cache (unless something newer is there), so
      // the header, the versions and a page opened again know it; the tree may show another title
      queryClient.setQueryData<WikiPage>(qk.pages.detail(page.id), (cached) => (cached && cached.version > stored.version ? cached : stored));
      void queryClient.invalidateQueries({ queryKey: [...qk.pages.all, 'list'] });
      // left while it saved: the text waits on the page, and the toast says where
      if (!mounted.current) announceLeft(conflicted, title);
    } else if (dirty.current && !same(latest.current, mine) && !isPageGone(page.id)) {
      // typed on meanwhile; with the view gone at once
      if (mounted.current) timer.current = setTimeout(() => void save.current(), SAVE_PAUSE_MS);
      else void save.current();
    }
  };

  /** A conflict whose view is gone: the toast names the page, and "Öffnen" brings it back with the banner. */
  function announceLeft(found: PageConflict, title: string) {
    const to = options.current.href;
    toast({
      title: t('wiki.save.not_saved', { title }),
      description: `${found.message} ${t('wiki.conflict.waits')}`,
      tone: 'error',
      action: to ? { label: t('wiki.conflict.open'), onClick: () => router.visit(to) } : undefined,
    });
  }

  // what is typed is saved when the page is left; a conflict that stands then says so, as one met on leaving does
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const found = open.current;
      if (found && editable.current && !isPageGone(page.id)) announceLeft(found, latest.current.title.trim() || held.current.title);
      else void save.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the view goes
  }, []);

  function change(patch: Partial<PageFields>, { now = false } = {}) {
    latest.current = { ...latest.current, ...patch };
    keepDraft();
    setDraft(latest.current);
    if (patch.title !== undefined && patch.title.trim() !== '') setTitleError(null);
    clearTimeout(timer.current);
    if (open.current) return;
    if (now) void save.current();
    else timer.current = setTimeout(() => void save.current(), SAVE_PAUSE_MS);
  }

  async function flush(): Promise<boolean> {
    if (open.current) return false;
    if (flight.current) await flight.current.catch(() => undefined);
    await save.current();
    return !dirty.current && !open.current;
  }

  function reload() {
    const found = open.current;
    if (!found) return;
    const mine = latest.current;
    showConflict(null);
    dropDraft();
    base.current = found.current.version;
    const theirs = fieldsOf(found.current);
    held.current = theirs;
    latest.current = theirs;
    setDraft(theirs);
    setState('idle');
    setTitleError(null);
    // the own text left the editor: "Rückgängig" (or ⌘Z) brings it back, with the conflict
    toast({
      title: t('wiki.conflict.dropped.title'),
      description: t('wiki.conflict.dropped.description'),
      keep: true,
      action: { label: undoLabel(), onClick: () => restoreMine(mine, found) },
    });
  }

  function restoreMine(mine: PageFields, before: PageConflict) {
    // a copy: the editor ignores documents it reported itself
    const copy: PageFields = { ...mine, content: mine.content ? structuredClone(mine.content) : null };
    // what this view saved after "Neu laden" is newer than the page the conflict met: that is the stored state now
    const current = newest(before.current, latestPage.current, queryClient.getQueryData<WikiPage>(qk.pages.detail(page.id)));
    const again: PageConflict = { message: before.message, current };
    drafts.setPage(key, { ...copy, base_version: Math.max(base.current, current.version), conflict: again });
    // a page left meanwhile shows it again when it opens
    if (!mounted.current) return;
    clearTimeout(timer.current);
    dirty.current = true;
    latest.current = copy;
    setDraft(copy);
    showConflict(again);
    setState('failed');
  }

  function keepMine() {
    const found = open.current;
    if (!found) return;
    // on top of the stored version (or of what this view saved since, which is newer still)
    base.current = Math.max(base.current, found.current.version);
    showConflict(null);
    keepCurrent.current = true;
    keepDraft();
    void save.current(true);
  }

  const spoken = state === 'saving' ? t('wiki.save.saving') : state === 'saved' ? t('wiki.save.saved') : state === 'failed' ? t('wiki.save.failed') : '';

  return { draft, change, save: (force) => save.current(force), state, savedAt, spoken, titleError, conflict, reload, keepMine, flush };
}
