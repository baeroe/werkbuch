/*
 * The description of an item (spec 4.8): rich text that saves itself after a pause in typing, when the focus leaves
 * it, and on ⌘↵. Every save says which version it is based on (`base_description_version`). Has somebody else saved
 * in the meantime, the server refuses (409 `description_conflict` with the stored item in `current` and the name of the
 * last editor in its sentence) and the banner offers "Neu laden" (the other version, this window's text is gone; the
 * history keeps both) or "Meine Fassung übernehmen" (saves this text on top of the other version), as on wiki pages
 * (spec 4.15).
 *
 * What is typed while a save is on its way is not lost: the next save takes the newest draft (13c). A failed save (5xx,
 * no answer) keeps the draft and says "Nicht gespeichert"; the error toast of the item mutation offers "Erneut
 * versuchen", and when that retry goes through, the version it made is the one the draft is based on now.
 *
 * An open conflict outlives the item's view, like an unsent comment: closing the preview (or opening another item)
 * keeps this window's version, and the banner offers it again when the item comes back. Nothing typed goes without a
 * word when the view goes away: what is typed is saved then; a conflict that save meets (or one the banner showed as
 * the view closed) raises a toast naming the item, whose "Öffnen" brings it back in the preview with the banner; and
 * while a conflict is open or a save is on its way, leaving or reloading the page asks first (`beforeunload`, kept at
 * module level: it outlives the view). Both buttons of the banner give the focus back to the editor. What was typed
 * on while the last save of a view that is gone was on its way is saved at once, not after the pause, so the guard
 * stays up until it answers.
 *
 * Archived meanwhile, or the edit right gone while text is typed (A154): the editor gives way to the stored text, and
 * the unsaved text stays above it, read-only, with "Kopieren" and "Verwerfen"; it is not sent again (the server would
 * refuse it), and leaving the page asks while it stands. What it does not cover: a save of a view that is gone that
 * fails (5xx) lives on only in the retry of the error toast (deferred, see the rulings).
 */

import { RotateCw } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useEffect, useId, useRef, useState } from 'react';
import { CopyButton } from '@/features/settings/tokens/CopyButton';
import { ApiError } from '@/api/client';
import { useEditReason } from '@/components/fields/itemData';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { isEmptyDoc, RichTextEditor } from '@/editor/RichTextEditor';
import { RichTextView } from '@/editor/RichTextView';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import { docToText } from '@/lib/richtext';
import { useUiStore } from '@/store/ui';
import type { RichText, WorkItem, WorkItemDetail } from '@/types';
import { focusWhenLost, Section, useUnsavedGuard } from './shared';

/** How long typing pauses before the description saves. */
export const DESCRIPTION_PAUSE_MS = 1200;

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

interface Conflict {
  /** The server's sentence: "Ida Brenner hat die Beschreibung inzwischen geändert." */
  message: string;
  current: WorkItem;
}

/** A description as a save sends it (an empty document as null), for comparing. */
const asSent = (doc: RichText | null | undefined): string => JSON.stringify(doc === undefined || isEmptyDoc(doc) ? null : doc);
const same = (a: RichText | null | undefined, b: RichText | null | undefined) => asSent(a) === asSent(b);

function conflictOf(error: unknown): Conflict | null {
  if (!(error instanceof ApiError) || error.reason !== 'description_conflict' || !error.current) return null;
  return { message: error.message, current: error.current as WorkItem };
}

/**
 * Open conflicts by item id, for this visit (nothing is stored): this window's version as it reads now, and what the
 * server said. Set when a save meets a conflict, also one that ran as the view closed; gone once it is resolved.
 */
const openConflicts = new Map<string, { mine: RichText | null; message: string }>();

/** Saves of a description on their way, also of views that are gone already. */
let pendingSaves = 0;

const warnOnUnload = (event: BeforeUnloadEvent) => event.preventDefault();
let guarding = false;

/** While a conflict is open or a save is on its way, leaving or reloading the page asks first; no view needs to be there. */
function syncLeaveGuard(): void {
  const needed = openConflicts.size > 0 || pendingSaves > 0;
  if (needed === guarding) return;
  guarding = needed;
  if (needed) window.addEventListener('beforeunload', warnOnUnload);
  else window.removeEventListener('beforeunload', warnOnUnload);
}

function keepConflict(id: string, open: { mine: RichText | null; message: string }): void {
  openConflicts.set(id, open);
  syncLeaveGuard();
}

function dropConflict(id: string): void {
  openConflicts.delete(id);
  syncLeaveGuard();
}

/** A conflict whose view is gone: the toast names the item, and "Öffnen" brings it back with the banner. */
function announceLeftConflict(item: Pick<WorkItem, 'id' | 'key'>, message: string): void {
  toast({
    title: t('items.detail.description.conflict_left', { key: item.key }),
    description: message,
    tone: 'error',
    action: { label: t('items.detail.description.open'), onClick: () => useUiStore.getState().openPeek(item.id) },
  });
}

export function Description({ detail }: { detail: WorkItemDetail }) {
  const { item } = detail;
  const reason = useEditReason(item);
  const editable = useRef(reason === null);
  const update = useUpdateWorkItem();
  const stored = item.description_json;

  // a conflict left open comes back with this window's version, unless the server holds that text by now
  const [reopened] = useState(() => {
    const open = openConflicts.get(item.id);
    return open && !same(open.mine, stored) ? open : null;
  });
  const [draft, setDraft] = useState<RichText | null>(reopened ? reopened.mine : stored);
  // against the stored item as it is now: "Neu laden" takes it, "Meine Fassung übernehmen" saves over its version
  const [conflict, setConflict] = useState<Conflict | null>(reopened && { message: reopened.message, current: item });
  const [state, setState] = useState<SaveState>('idle');
  /** A refusal of the text itself (422 at `description_json`, e.g. too long), shown under the editor. */
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  /** Typed text the server does not have yet: leaving or reloading the page asks first. */
  const [unsaved, setUnsaved] = useState(reopened !== null);
  useUnsavedGuard(unsaved || conflict !== null);
  /** The draft as typed, for saves that run outside a render. */
  const latest = useRef(draft);
  /** The version the draft is based on. */
  const base = useRef(item.description_version);
  /** What the server holds of this window's text (or what was taken over from it). */
  const held = useRef<RichText | null>(stored);
  /** Typed text the server does not have yet. Cleared only by a save that went through (or "Neu laden"). */
  const dirty = useRef(reopened !== null);
  const inFlight = useRef(false);
  const inConflict = useRef(reopened !== null);
  /** The answer of the last save this window made itself; any other answer of the mutation is a retry from its toast. */
  const own = useRef<WorkItem | undefined>(undefined);
  /** The error of the last save this window made itself; any other error of the mutation is a retry from its toast. */
  const ownError = useRef<Error | null>(null);
  /** Whether the view is still there: a conflict met afterwards is announced by a toast. */
  const mounted = useRef(false);
  const editor = useRef<Editor | null>(null);
  /** The text that could not be saved anymore, selected when copying fails. */
  const parked = useRef<HTMLDivElement>(null);
  const latestItem = useRef(item);
  useEffect(() => {
    latestItem.current = item;
    editable.current = reason === null;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // a conflict left open whose text the server took in the meantime: nothing left to offer
  useEffect(() => {
    if (!reopened) dropConflict(item.id);
  }, [reopened, item.id]);

  // a newer description from outside shows while nothing is typed here. While text is typed, nothing the cache shows
  // counts: a failed save rolls the item back, and the toast's retry shows its text before the server has it
  useEffect(() => {
    if (inConflict.current || inFlight.current || dirty.current) return;
    base.current = item.description_version;
    held.current = stored;
    latest.current = stored;
    setDraft(stored);
  }, [stored, item.description_version]);

  const save = useRef(async (_options?: { force?: boolean }) => {});
  save.current = async ({ force = false } = {}) => {
    clearTimeout(timer.current);
    // archived or the right gone: the text stays above the stored one (A154), the server would refuse it
    if (inConflict.current || inFlight.current || !editable.current) return;
    const doc = latest.current;
    if (!force && (!dirty.current || same(doc, held.current))) {
      // nothing typed, or typed back to what the server holds
      dirty.current = false;
      setUnsaved(false);
      return;
    }
    inFlight.current = true;
    pendingSaves += 1;
    syncLeaveGuard();
    setState('saving');
    let conflicted: Conflict | null = null;
    try {
      const saved = await update.mutateAsync({ id: item.id, patch: { description: isEmptyDoc(doc) ? null : doc }, base_description_version: base.current });
      own.current = saved;
      base.current = saved.description_version;
      held.current = doc;
      dropConflict(item.id);
      setState('saved');
      // typed on while it saved: that is still to save
      if (same(latest.current, doc)) {
        dirty.current = false;
        setUnsaved(false);
      }
    } catch (error) {
      ownError.current = error as Error;
      // anything else than a conflict: the item mutation names the cause (with "Erneut versuchen" where it helps); the
      // text stays, still to save
      conflicted = conflictOf(error);
      setState(conflicted ? 'idle' : 'failed');
      if (error instanceof ApiError && error.errors?.description_json) setError(error.errors.description_json[0]!);
    } finally {
      inFlight.current = false;
      pendingSaves -= 1;
      syncLeaveGuard();
    }
    if (conflicted) {
      openConflict(conflicted);
      // the save ran as the view went away (a link, the preview closing): only the toast can say it now
      if (!mounted.current) announceLeftConflict(item, conflicted.message);
    } else if (dirty.current && !same(latest.current, doc)) {
      // typed on meanwhile; with the view gone at once, so the leave guard (pendingSaves) stays up for it
      if (mounted.current) timer.current = setTimeout(() => void save.current(), DESCRIPTION_PAUSE_MS);
      else void save.current();
    }
  };

  /** A conflict: kept beyond this view (the save may have run as it closed, or it closes before it is resolved). */
  function openConflict(found: Conflict) {
    inConflict.current = true;
    keepConflict(item.id, { mine: latest.current, message: found.message });
    setConflict(found);
  }

  // "Erneut versuchen" on the error toast sends the failed save once more, past this window: once it went through, the
  // draft is based on the version it made (and still to save if it was typed on meanwhile)
  const answer = update.data;
  useEffect(() => {
    if (!answer || answer === own.current || inFlight.current) return;
    own.current = answer;
    const sent = update.variables?.patch.description ?? null;
    base.current = answer.description_version;
    held.current = sent;
    if (same(latest.current, sent)) {
      dirty.current = false;
      setUnsaved(false);
      setState('saved');
      // "Meine Fassung übernehmen" that failed and went through on retry: no conflict left to ask about on unload
      dropConflict(item.id);
    } else {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save.current(), DESCRIPTION_PAUSE_MS);
    }
  }, [answer, update.variables]);

  // that retry meeting a conflict (someone saved in between): the banner, as for a save of this window
  const failure = update.error;
  useEffect(() => {
    if (!failure || failure === ownError.current || inFlight.current || inConflict.current) return;
    ownError.current = failure;
    const found = conflictOf(failure);
    if (found) openConflict(found);
  }, [failure]);

  // what is typed is saved when the description goes away (the preview closes, another item opens); an open conflict
  // is kept in `openConflicts` instead
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // the item as it reads last: its key may have changed since (a renamed project)
      const shown = latestItem.current;
      const open = inConflict.current ? openConflicts.get(shown.id) : undefined;
      if (open) announceLeftConflict(shown, open.message);
      void save.current();
    };
  }, []);

  /** Back into the editor once the banner (and the button pressed in it) is gone. */
  const focusEditor = () => focusWhenLost(() => (editor.current?.isDestroyed === false ? (editor.current.view.dom as HTMLElement) : null));

  function reload({ current }: Conflict) {
    dropConflict(item.id);
    inConflict.current = false;
    dirty.current = false;
    base.current = current.description_version;
    held.current = current.description_json;
    latest.current = current.description_json;
    setDraft(current.description_json);
    setConflict(null);
    setState('idle');
    setUnsaved(false);
    focusEditor();
  }

  /** "Verwerfen" of the text that could not be saved anymore: the stored description is all there is. */
  function discardParked() {
    dropConflict(item.id);
    inConflict.current = false;
    dirty.current = false;
    latest.current = stored;
    held.current = stored;
    setDraft(stored);
    setConflict(null);
    setState('idle');
    setUnsaved(false);
  }

  function keepMine({ current }: Conflict) {
    // save over the newer version: based on it now; the history keeps the other one
    base.current = current.description_version;
    inConflict.current = false;
    setConflict(null);
    focusEditor();
    void save.current({ force: true });
  }

  const status =
    state === 'saving' ? (
      t('items.detail.description.saving')
    ) : state === 'saved' ? (
      t('items.detail.description.saved')
    ) : state === 'failed' ? (
      <span className="text-danger">{t('items.detail.description.failed')}</span>
    ) : null;

  return (
    // the save state is a status region that is always there: screen readers announce changes only of regions they know
    <Section title={t('items.detail.description.title')} aside={reason ? null : <span role="status">{status}</span>}>
      {/* with the editor only: while the rights load (or are gone), neither button could do anything */}
      {conflict && !reason && (
        <Banner tone="danger" role="alert" title={conflict.message} className="mt-2">
          <p>{t('items.detail.description.conflict')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => reload(conflict)}>
              {t('common.reload')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => keepMine(conflict)}>
              {t('items.detail.description.keep_mine')}
            </Button>
          </div>
        </Banner>
      )}
      {reason && (unsaved || conflict) && (
        <Banner tone="danger" role="alert" title={t('items.detail.description.parked')} className="mt-2">
          <p>{reason}</p>
          <div ref={parked} className="mt-2 rounded-md border border-line bg-surface p-2">
            {draft && !isEmptyDoc(draft) ? <RichTextView value={draft} preset="description" /> : <p className="text-muted">{t('items.detail.description.empty')}</p>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={docToText(draft)} target={() => parked.current} size="sm" />
            <Button variant="secondary" size="sm" onClick={discardParked}>
              {t('items.detail.description.discard')}
            </Button>
          </div>
        </Banner>
      )}
      <div className="mt-2" onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && void save.current()}>
        {reason ? (
          stored && !isEmptyDoc(stored) ? (
            <RichTextView value={stored} preset="description" />
          ) : (
            <p className="text-ui text-muted">{t('items.detail.description.empty')}</p>
          )
        ) : (
          <RichTextEditor
            value={draft}
            onChange={(doc) => {
              latest.current = doc;
              // below the banner: what is kept for the conflict is the text as it reads now
              const open = inConflict.current ? openConflicts.get(item.id) : undefined;
              if (open) open.mine = doc;
              dirty.current = true;
              setUnsaved(true);
              setDraft(doc);
              setError(null);
              if (state === 'saved' || state === 'failed') setState('idle');
              clearTimeout(timer.current);
              if (!inConflict.current) timer.current = setTimeout(() => void save.current(), DESCRIPTION_PAUSE_MS);
            }}
            onSubmit={() => void save.current()}
            preset="description"
            editorRef={editor}
            invalid={error !== null}
            describedBy={error ? errorId : undefined}
          />
        )}
        <div aria-live="polite">
          {error && (
            <p id={errorId} className="mt-1.5 text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}
