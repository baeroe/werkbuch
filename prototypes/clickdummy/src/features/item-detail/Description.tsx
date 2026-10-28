/*
 * The description of an item (spec 4.8): rich text that saves itself after a pause in typing, when the focus leaves
 * it, and on mod+enter. Every save says which version it is based on (`base_description_version`). Has somebody else
 * saved in the meantime, the server refuses (409 `description_conflict` with the stored item) and the banner offers
 * "Neu laden" or "Meine Fassung übernehmen", as on wiki pages (spec 4.15); the other version stays in the history.
 *
 * The demo plays such a conflict ("Beschreibungskonflikt simulieren" in the item's menu): a first save comes from
 * "another window", then this window saves with the version it started from, a second save with a stale
 * `base_description_version`.
 */

import { RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { useEditReason } from '@/components/fields/itemData';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { useUpdateWorkItem } from '@/hooks/workItems';
import type { RichText, WorkItem, WorkItemDetail } from '@/types';
import { isEmptyDoc, RichTextEditor, RichTextView } from '@/features/editor/RichTextEditor';
import { Section, useDetail, useUnsavedGuard } from './shared';

const SAVE_PAUSE_MS = 1200;

/** What the demo's "other window" adds. */
const FOREIGN_NOTE = 'Nachtrag aus einem zweiten Fenster: Vor dem Release bitte noch einmal auf allen Browsern prüfen.';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

interface Conflict {
  /** The server's sentence, e.g. "Ida Brenner hat die Beschreibung inzwischen geändert." */
  message: string;
  current: WorkItem;
}

const same = (a: RichText | null | undefined, b: RichText | null | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function withNote(doc: RichText | null, text: string): RichText {
  return { type: 'doc', content: [...(doc?.content ?? []), { type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function conflictOf(error: unknown): Conflict | null {
  if (!(error instanceof ApiError) || error.reason !== 'description_conflict' || !error.current) return null;
  return { message: error.message, current: error.current as WorkItem };
}

export function Description({ detail }: { detail: WorkItemDetail }) {
  const { item } = detail;
  const { actions } = useDetail();
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();

  const [draft, setDraft] = useState<RichText | null>(item.description);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  /** Typed text the server does not have yet: leaving or reloading the page asks first. */
  const [unsaved, setUnsaved] = useState(false);
  useUnsavedGuard(unsaved || conflict !== null);
  /** The draft as typed, for saves that run outside a render. */
  const latest = useRef(draft);
  /** The version the draft is based on. */
  const base = useRef(item.description_version);
  /** What the server holds of this window's text (or what was taken over from it). */
  const stored = useRef<RichText | null>(item.description);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const inConflict = useRef(false);
  /** The demo: while "the other window" saves, this one keeps its version. */
  const hold = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // a newer description from outside shows while nothing is typed here
  useEffect(() => {
    if (hold.current || inConflict.current || inFlight.current) return;
    if (dirty.current && !same(item.description, latest.current)) return;
    // either nothing is typed, or the server holds exactly this text (a retried save that went through)
    dirty.current = false;
    base.current = item.description_version;
    stored.current = item.description;
    latest.current = item.description;
    setDraft(item.description);
  }, [item.description, item.description_version]);

  const save = useRef(async (_options?: { force?: boolean }) => {});
  save.current = async ({ force = false } = {}) => {
    clearTimeout(timer.current);
    if (inConflict.current || inFlight.current) return;
    const doc = latest.current;
    if (!force && (!dirty.current || same(doc, stored.current))) {
      dirty.current = false;
      return;
    }
    dirty.current = false;
    inFlight.current = true;
    setState('saving');
    let conflicted: Conflict | null = null;
    try {
      const saved = await update.mutateAsync({
        id: item.id,
        patch: { description: isEmptyDoc(doc) ? null : doc },
        base_description_version: base.current,
      });
      base.current = saved.description_version;
      stored.current = doc;
      setState('saved');
      if (!dirty.current) setUnsaved(false);
    } catch (error) {
      conflicted = conflictOf(error);
      // anything else: the item mutation names the cause (with "Erneut versuchen" where it helps); the text stays
      if (!conflicted) dirty.current = true;
      setState(conflicted ? 'idle' : 'failed');
    } finally {
      inFlight.current = false;
      hold.current = false;
    }
    if (conflicted) {
      inConflict.current = true;
      setConflict(conflicted);
    } else if (dirty.current && !same(latest.current, doc)) {
      // typed on while it saved
      timer.current = setTimeout(() => void save.current(), SAVE_PAUSE_MS);
    }
  };

  // what is typed is saved when the description goes away (the preview closes, another item opens)
  useEffect(() => () => void save.current(), []);

  useEffect(() => {
    const own = actions.current;
    const simulate = async () => {
      if (reason) return toast({ title: 'Nicht möglich', description: reason, tone: 'error' });
      if (inConflict.current || inFlight.current) return;
      clearTimeout(timer.current);
      hold.current = true;
      try {
        // the first save, from "another window"
        await update.mutateAsync({ id: item.id, patch: { description: withNote(item.description, FOREIGN_NOTE) }, base_description_version: item.description_version });
      } catch {
        hold.current = false;
        return;
      }
      // the second save: this window, still on the version it started from
      await save.current({ force: true });
    };
    own.simulateConflict = simulate;
    return () => {
      if (own.simulateConflict === simulate) own.simulateConflict = undefined;
    };
  });

  function reload() {
    if (!conflict) return;
    const { current } = conflict;
    inConflict.current = false;
    dirty.current = false;
    base.current = current.description_version;
    stored.current = current.description;
    latest.current = current.description;
    setDraft(current.description);
    setConflict(null);
    setState('idle');
    setUnsaved(false);
  }

  function keepMine() {
    if (!conflict) return;
    // save over the newer version: based on it now; the history keeps the other one
    base.current = conflict.current.description_version;
    inConflict.current = false;
    setConflict(null);
    void save.current({ force: true });
  }

  const aside = state === 'saving' ? 'Speichert …' : state === 'saved' ? 'Gespeichert' : state === 'failed' ? <span className="text-danger">Nicht gespeichert</span> : null;

  return (
    <Section title="Beschreibung" aside={reason ? null : aside}>
      {conflict && (
        <Banner tone="danger" role="alert" title={conflict.message} className="mt-2">
          <p>Deine Fassung steht noch im Editor. Lade die neue Fassung oder übernimm deine; die andere bleibt in der History.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={reload}>
              Neu laden
            </Button>
            <Button variant="primary" size="sm" onClick={keepMine}>
              Meine Fassung übernehmen
            </Button>
          </div>
        </Banner>
      )}
      <div className="mt-2" onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && void save.current()}>
        {reason ? (
          item.description && !isEmptyDoc(item.description) ? (
            <RichTextView value={item.description} />
          ) : (
            <p className="text-ui text-muted">Keine Beschreibung.</p>
          )
        ) : (
          <RichTextEditor
            value={draft}
            onChange={(doc) => {
              latest.current = doc;
              dirty.current = true;
              setUnsaved(true);
              setDraft(doc);
              if (state === 'saved' || state === 'failed') setState('idle');
              clearTimeout(timer.current);
              if (!inConflict.current) timer.current = setTimeout(() => void save.current(), SAVE_PAUSE_MS);
            }}
            onSubmit={() => void save.current()}
            preset="description"
            projectId={item.project_id}
          />
        )}
      </div>
    </Section>
  );
}
