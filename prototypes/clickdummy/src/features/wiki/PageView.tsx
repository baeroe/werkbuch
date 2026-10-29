/*
 * One wiki page (spec 4.15, 4.16): emoji, title and the full editor (level `page`), saved by itself after a short pause
 * in typing, when the focus leaves the text, on mod+enter and when the page is left. Every save says which version it
 * is based on. Has somebody else saved in between, the server refuses (409 `page_conflict` with the stored page) and the
 * banner offers "Neu laden" or "Meine Fassung übernehmen"; taking over keeps the other text as a version first.
 * "Seitenstruktur" of the demo meets such a conflict on its first save, as if a colleague had saved just before.
 *
 * The save state stands in a status region that is always there: "Speichert …", "Gespeichert vor …" (moving on with
 * the time) or "Nicht gespeichert". Screen readers hear when the state changes, not every tick of the time.
 *
 * What the server does not have yet outlives the page's view for this visit (`pending`, kept per person): a save that
 * failed or met a conflict, also one that ran as the page was left, comes back with its text and its banner when the
 * page opens again. A conflict keeps the page as the server sent it and writes it into the cache, so "Neu laden" and
 * "Meine Fassung übernehmen" work on the latest version, also after reopening. A failed save keeps the text and offers
 * "Erneut versuchen" in the toast; the retry sends the text as it reads then. A page left with an empty title is saved
 * under the title it had, so nothing typed is lost.
 *
 * Viewers read: the title as heading, the text in the viewer, the versions without restoring.
 */

import { useQueryClient } from '@tanstack/react-query';
import { Ellipsis, Eye, FilePlus2, FileQuestionMark, FolderInput, History, SmilePlus, Trash2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { useUserMap } from '@/components/fields/itemData';
import { Button, buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { isEmptyDoc, RichTextEditor, RichTextView } from '@/features/editor/RichTextEditor';
import { UploadOwnerContext } from '@/features/editor/pasteImages';
import { qk } from '@/hooks/keys';
import { usePage, useSavePage } from '@/hooks/pages';
import { useProjects } from '@/hooks/projects';
import { now } from '@/lib/clock';
import { useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { UNDO_LABEL } from '@/lib/undo';
import { useDialogScope, useShortcut } from '@/lib/shortcuts/useShortcut';
import { useSession } from '@/store/session';
import type { Page as WikiPage, PageNode, RichText } from '@/types';
import { ConflictBanner } from './ConflictBanner';
import { useLongDay } from './format';
import { savedAgo } from './savedAgo';
import { VersionsDialog } from './VersionsDialog';
import './wiki.css';

/** The pause in typing after which the page saves itself. */
const SAVE_PAUSE_MS = 1200;
const MAX_TITLE = 200;

/** The page's sheet: a white card on the dot paper, the reading surface of the wiki. */
export const SHEET = 'min-w-0 max-w-[52rem] rounded-card border border-line bg-surface px-5 py-5 shadow-elev-1 md:px-10 md:py-8';

interface Draft {
  title: string;
  emoji: string | null;
  content: RichText | null;
}

interface Conflict {
  /** The server's sentence: "Jonas Feld hat die Seite inzwischen geändert." */
  message: string;
  current: WikiPage;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const draftOf = (page: WikiPage): Draft => ({ title: page.title, emoji: page.emoji, content: page.content });
const sameDraft = (a: Draft, b: Draft) => a.title === b.title && a.emoji === b.emoji && JSON.stringify(a.content ?? null) === JSON.stringify(b.content ?? null);

function conflictOf(error: unknown): Conflict | null {
  if (!(error instanceof ApiError) || error.reason !== 'page_conflict' || !error.current) return null;
  return { message: error.message, current: error.current as WikiPage };
}

/** The read failed because the page is gone for the reader (deleted, or a project they no longer see). */
const isGone = (error: unknown) => error instanceof ApiError && (error.status === 404 || error.status === 403);

interface KeptDraft {
  mine: Draft;
  /** The version the draft is based on. */
  base: number;
  /** The conflict it met, with the page as the server had it then. */
  conflict: Conflict | null;
}

/**
 * Typed text the server does not have yet, for this visit (nothing is stored): a save that failed or met a conflict,
 * also one that ran as the page was left. Kept by person and page, so "Als … ansehen" neither shows nor saves somebody
 * else's text. Gone once a save goes through or the text is reloaded.
 */
const pending = new Map<string, KeptDraft>();
const draftKey = (userId: string, pageId: string) => `${userId} ${pageId}`;

/**
 * The draft kept for this person and page, unless it is settled by now: the server holds that text, or the server's
 * page is older than what the draft knew (the demo was reset), so the draft belongs to data that is gone.
 */
function keptDraft(key: string, page: WikiPage): KeptDraft | null {
  const kept = pending.get(key);
  if (!kept) return null;
  if (sameDraft(kept.mine, draftOf(page)) || page.version < (kept.conflict?.current.version ?? kept.base)) {
    pending.delete(key);
    return null;
  }
  return kept;
}

/** While `active`, closing or reloading the tab asks first. */
function useUnsavedGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

/** Mounted while the emoji choice is open: its grid takes letters, so the page's single-key shortcuts wait. */
function PausePageShortcuts() {
  useDialogScope();
  return null;
}

export type PageViewProps = {
  projectId: string;
  /** The path of the wiki, e.g. /projects/WEB/wiki. */
  base: string;
  pageId: string;
  /** The pages above it in the tree, the top one first. */
  ancestors: readonly PageNode[];
  /** Whether the rights are known, and why the person may not edit (null: they may). */
  rights: { ready: boolean; denied: string | null };
  onMove: () => void;
  onDelete: () => void;
  onCreateChild: () => void;
};

function PageSkeleton() {
  return (
    <SkeletonGroup label="Seite wird geladen …" className={SHEET}>
      <Skeleton className="h-3 w-40" />
      <div className="mt-6 flex items-center gap-3">
        <Skeleton className="size-11 rounded-ctl" />
        <Skeleton className="h-8 w-2/3" />
      </div>
      <Skeleton className="mt-3 h-3 w-56" />
      <div className="mt-8 flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="mt-4 h-5 w-48" />
        <Skeleton className="h-4 w-full" />
      </div>
    </SkeletonGroup>
  );
}

export function PageGone({ base }: { base: string }) {
  return (
    <EmptyState
      icon={FileQuestionMark}
      titleAs="h1"
      title="Diese Seite gibt es nicht"
      description="Sie wurde gelöscht, oder der Link ist unvollständig. Im Baum stehen alle Seiten, die es im Wiki gibt."
      actions={
        <Link to={base} className={buttonClass({ variant: 'secondary' })}>
          Zur Übersicht des Wikis
        </Link>
      }
      className="max-w-[52rem]"
    />
  );
}

export function PageView(props: PageViewProps) {
  const query = usePage(props.pageId);
  const projects = useProjects({ include_archived: true });

  if (query.isError && !query.data) {
    if (isGone(query.error)) return <PageGone base={props.base} />;
    return (
      <ErrorState
        title="Die Seite konnte nicht geladen werden"
        description={query.error instanceof ApiError ? query.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className="max-w-[52rem]"
      />
    );
  }
  if (!query.data || !props.rights.ready) return <PageSkeleton />;

  // a page of another project (an old link): to the address it has
  if (query.data.project_id !== props.projectId) {
    const owner = projects.data?.items.find((project) => project.id === query.data.project_id);
    if (owner) return <Navigate replace to={`/projects/${owner.identifier}/wiki/${query.data.id}`} />;
    return projects.isPending ? <PageSkeleton /> : <PageGone base={props.base} />;
  }
  return <PageSheet {...props} page={query.data} />;
}

function SaveStatus({ state, savedAt, spoken }: { state: SaveState; savedAt: Date | null; spoken: string }) {
  // the time on screen moves on; screen readers heard the state already
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!savedAt) return;
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [savedAt]);
  const shown = state === 'saving' ? 'Speichert …' : state === 'failed' ? 'Nicht gespeichert' : savedAt ? savedAgo(savedAt, now()) : '';
  return (
    <div role="status" className="min-w-0 text-sm text-muted">
      <span className="sr-only">{spoken}</span>
      <span aria-hidden="true" className={cx('block truncate', state === 'failed' && 'font-medium text-danger')}>
        {shown}
      </span>
    </div>
  );
}

function PageSheet({ page, projectId, base, ancestors, rights, onMove, onDelete, onCreateChild }: PageViewProps & { page: WikiPage }) {
  const canEdit = rights.denied === null;
  const users = useUserMap();
  const longDay = useLongDay();
  const location = useLocation();
  const navigate = useNavigate();
  const savePage = useSavePage();
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const titleErrorId = useId();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  /** The person who types here; another person gets a sheet of their own (WikiScreen keys it by person). */
  const [writer] = useState(() => useSession.getState().userId);
  const key = draftKey(writer, page.id);
  // text kept from earlier in this visit comes back, unless it is settled by now
  const [kept] = useState(() => keptDraft(key, page));
  const [draft, setDraft] = useState<Draft>(kept ? kept.mine : draftOf(page));
  // a kept conflict meets the newer of the page as it met it and the page as the cache has it now
  const [conflict, setConflict] = useState<Conflict | null>(() =>
    kept?.conflict ? { message: kept.conflict.message, current: page.version >= kept.conflict.current.version ? page : kept.conflict.current } : null,
  );
  const [state, setState] = useState<SaveState>(kept && !kept.conflict ? 'failed' : 'idle');
  const [spoken, setSpoken] = useState(kept && !kept.conflict ? 'Nicht gespeichert' : '');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  /** Typed text the server does not have yet: closing the tab asks first. */
  const [unsaved, setUnsaved] = useState(kept !== null);
  useUnsavedGuard(canEdit && (unsaved || conflict !== null));

  /** The draft as typed, for saves that run outside a render. */
  const latest = useRef(draft);
  /** The page as the latest render had it, for an undo that runs later. */
  const latestPage = useRef(page);
  latestPage.current = page;
  /** The version the draft is based on. */
  const base_ = useRef(kept ? kept.base : page.version);
  /** What the server holds of this window's text. */
  const stored = useRef<Draft>(draftOf(page));
  const dirty = useRef(kept !== null);
  const inFlight = useRef(false);
  /** The save on its way, so a restore can wait for it. */
  const flight = useRef<Promise<unknown> | null>(null);
  const inConflict = useRef(Boolean(kept?.conflict));
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const pagePath = `${base}/${page.id}`;
  const owner = useMemo(() => ({ type: 'page' as const, id: page.id }), [page.id]);

  // a newer page from outside (a restored version, another window) shows while nothing is typed here; a version this
  // window is based on or older changes nothing
  useEffect(() => {
    if (inConflict.current || inFlight.current || page.version <= base_.current || dirty.current) return;
    const theirs = draftOf(page);
    base_.current = page.version;
    stored.current = theirs;
    latest.current = theirs;
    setDraft(theirs);
  }, [page]);

  const save = useRef(async (_force?: boolean) => {});
  save.current = async (force = false) => {
    clearTimeout(timer.current);
    if (!canEdit || inConflict.current || inFlight.current) return;
    const mine = latest.current;
    if (!force && (!dirty.current || sameDraft(mine, stored.current))) {
      dirty.current = false;
      if (mounted.current) setUnsaved(false);
      return;
    }
    // another person took over this window ("Als … ansehen"): the text stays the writer's, for when they come back
    if (useSession.getState().userId !== writer) {
      pending.set(key, { mine, base: base_.current, conflict: null });
      return;
    }
    let title = mine.title.trim();
    /** The page was left with an empty title: the text goes in under the title the page had. */
    let keptTitle = false;
    if (title === '') {
      // while the page is open its field says what is missing, and the text waits in the editor
      if (mounted.current) {
        setTitleError('Gib der Seite einen Titel. Ohne Titel wird nichts gespeichert.');
        return;
      }
      title = stored.current.title.trim() || page.title;
      keptTitle = true;
    }
    dirty.current = false;
    inFlight.current = true;
    setState('saving');
    let conflicted: Conflict | null = null;
    try {
      const request = savePage.mutateAsync({
        id: page.id,
        input: { title, emoji: mine.emoji, content: isEmptyDoc(mine.content) ? null : mine.content, base_version: base_.current },
      });
      flight.current = request;
      const saved = await request;
      base_.current = saved.version;
      stored.current = { ...mine, title };
      pending.delete(key);
      // the page as the server answered: a page opened again shows it at once, not the copy from before the save
      queryClient.setQueryData(qk.pages.detail(page.id), saved);
      setState('saved');
      setSpoken('Gespeichert');
      setSavedAt(now());
      setTitleError(null);
      if (!dirty.current) setUnsaved(false);
      if (keptTitle) toast({ title: `„${title}“ gespeichert`, description: 'Ohne Titel lässt sich eine Seite nicht speichern. Sie behält deshalb ihren bisherigen Titel.', tone: 'success' });
    } catch (error) {
      conflicted = conflictOf(error);
      if (conflicted) {
        setState('idle');
      } else {
        dirty.current = true;
        setState('failed');
        setSpoken('Nicht gespeichert');
        const titleRefusal = error instanceof ApiError ? error.errors?.title?.[0] : undefined;
        if (titleRefusal && mounted.current) setTitleError(titleRefusal);
        else {
          pending.set(key, { mine: latest.current, base: base_.current, conflict: null });
          notifyError(`„${title}“ nicht gespeichert`, error, () => void save.current());
        }
      }
    } finally {
      inFlight.current = false;
      flight.current = null;
    }
    if (conflicted) {
      inConflict.current = true;
      pending.set(key, { mine: latest.current, base: base_.current, conflict: conflicted });
      // a refused save refreshes nothing (only a save that goes through does): the page as the conflict brought it goes
      // into the cache, so the header, the versions and a reopened page know it
      queryClient.setQueryData(qk.pages.detail(page.id), conflicted.current);
      void queryClient.invalidateQueries({ queryKey: [...qk.pages.all, 'list'] });
      setConflict(conflicted);
      // the page was left while it saved: the text waits on the page, and the toast says where
      if (!mounted.current) {
        toast({
          title: `„${title}“ nicht gespeichert`,
          description: `${conflicted.message} Deine Fassung wartet auf der Seite.`,
          tone: 'error',
          action: { label: 'Öffnen', onClick: () => void navigate(pagePath) },
        });
      }
    } else if (dirty.current && !sameDraft(latest.current, mine)) {
      // typed on while it saved
      timer.current = setTimeout(() => void save.current(), SAVE_PAUSE_MS);
    }
  };

  // what is typed is saved when the page is left
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void save.current();
    };
  }, []);

  // a page just made: the title takes the focus, ready to be typed over
  useEffect(() => {
    if ((location.state as { focusTitle?: boolean } | null)?.focusTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
    // only when the page opens
  }, []);

  function change(patch: Partial<Draft>, { now: saveNow = false } = {}) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    const open = pending.get(key);
    if (open) open.mine = next;
    dirty.current = true;
    setUnsaved(true);
    setDraft(next);
    if (patch.title !== undefined && patch.title.trim() !== '') setTitleError(null);
    clearTimeout(timer.current);
    if (inConflict.current) return;
    if (saveNow) void save.current();
    else timer.current = setTimeout(() => void save.current(), SAVE_PAUSE_MS);
  }

  /** Saves what is typed and waits for a save on its way; false when a restore must wait (a conflict, a failure). */
  async function flush(): Promise<boolean> {
    if (inConflict.current) {
      toast({ title: 'Erst den Konflikt klären', description: 'Lade die neue Fassung oder übernimm deine. Danach lässt sich eine Version wiederherstellen.', tone: 'error' });
      return false;
    }
    if (flight.current) await flight.current.catch(() => undefined);
    await save.current();
    return !dirty.current && !inConflict.current;
  }

  /** The banner's buttons go away with it: the focus goes on to the text. */
  const focusText = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-wiki-body] .ProseMirror')?.focus());

  function reload() {
    if (!conflict) return;
    const mine = latest.current;
    const before = conflict;
    const theirs = draftOf(conflict.current);
    pending.delete(key);
    inConflict.current = false;
    dirty.current = false;
    base_.current = conflict.current.version;
    stored.current = theirs;
    latest.current = theirs;
    setDraft(theirs);
    setConflict(null);
    setState('idle');
    setUnsaved(false);
    setTitleError(null);
    focusText();
    // the own text left the editor: "Rückgängig" (or mod+z) brings it back, with the banner
    toast({ title: 'Deine Fassung verworfen', description: 'Im Editor steht jetzt die neue Fassung.', action: { label: UNDO_LABEL, onClick: () => restoreMine(mine, before) } });
  }

  function restoreMine(mine: Draft, before: Conflict) {
    // a copy: the editor ignores documents it reported itself (the value rule of RichTextEditor)
    const copy: Draft = { ...mine, content: mine.content ? structuredClone(mine.content) : null };
    // what this window saved after "Neu laden" is newer than the page the conflict met: "Neu laden" loads that one now
    const fresh = latestPage.current.version > before.current.version ? latestPage.current : before.current;
    const again: Conflict = { message: before.message, current: fresh };
    pending.set(key, { mine: copy, base: Math.max(base_.current, fresh.version), conflict: again });
    // a page left meanwhile shows it again when it opens
    if (!mounted.current) return;
    clearTimeout(timer.current);
    inConflict.current = true;
    dirty.current = true;
    latest.current = copy;
    setDraft(copy);
    setConflict(again);
    setUnsaved(true);
  }

  function keepMine() {
    if (!conflict) return;
    // save over the newer version: based on it now (or on what this window saved since, which is newer still); the
    // server keeps a foreign version first
    base_.current = Math.max(base_.current, conflict.current.version);
    inConflict.current = false;
    setConflict(null);
    focusText();
    void save.current(true);
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    // a title has one line: Enter goes on to the text
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      document.querySelector<HTMLElement>('[data-wiki-body] .ProseMirror')?.focus();
    }
  }

  useShortcut({ id: 'wiki.save', keys: 'mod+enter', scope: 'detail', label: 'Seite jetzt speichern', group: 'Wiki', run: () => void save.current(), when: () => canEdit });
  useShortcut({ id: 'wiki.delete', keys: 'mod+backspace', scope: 'detail', label: 'Seite löschen (mit Rückgängig)', group: 'Wiki', run: onDelete, when: () => canEdit });

  const group = `Seite „${page.title}“`;
  useCommand({ id: 'wiki.page.versions', label: 'Versionen ansehen', group, icon: <History />, keywords: ['historie', 'wiederherstellen', 'version'], run: () => setVersionsOpen(true) });
  useCommand({ id: 'wiki.page.move', label: 'Seite verschieben …', group, icon: <FolderInput />, keywords: ['verschieben', 'umhängen'], run: onMove, when: () => canEdit });
  useCommand({ id: 'wiki.page.child', label: 'Unterseite anlegen', group, icon: <FilePlus2 />, keywords: ['neue seite', 'anlegen'], run: onCreateChild, when: () => canEdit });
  useCommand({ id: 'wiki.page.delete', label: 'Seite löschen', group, keys: 'mod+backspace', icon: <Trash2 />, keywords: ['entfernen'], run: onDelete, when: () => canEdit });

  const editor = users.get(page.updated_by)?.name ?? 'Unbekannt';

  return (
    <article aria-labelledby={`${titleErrorId}-title`} className={SHEET}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
        {ancestors.length > 0 && (
          <nav aria-label="Pfad der Seite" className="min-w-0">
            <ol className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-muted">
              {ancestors.map((node) => (
                <li key={node.id} className="flex min-w-0 items-center gap-1">
                  <Link to={`${base}/${node.id}`} className="inline-flex min-h-11 min-w-0 items-center gap-1 rounded-chip px-0.5 text-muted no-underline hover:text-ink hover:underline md:min-h-6">
                    {node.emoji && <span aria-hidden="true">{node.emoji}</span>}
                    <span className="truncate">{node.title}</span>
                  </Link>
                  <span aria-hidden="true" className="text-faint">
                    /
                  </span>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {canEdit && <SaveStatus state={state} savedAt={savedAt} spoken={spoken} />}
          <Button variant="ghost" size="sm" icon={History} onClick={() => setVersionsOpen(true)}>
            Versionen …
          </Button>
          {canEdit && (
            <Menu>
              <MenuTrigger render={<IconButton icon={Ellipsis} label="Weitere Aktionen" tooltip={false} />} />
              <MenuContent align="end" className="w-60">
                <MenuItem icon={FilePlus2} onClick={onCreateChild}>
                  Unterseite anlegen
                </MenuItem>
                <MenuItem icon={FolderInput} onClick={onMove}>
                  Verschieben nach …
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={Trash2} danger shortcut="mod+backspace" onClick={onDelete}>
                  Löschen
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-start gap-2 md:mt-7 md:gap-3">
        {canEdit ? (
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={draft.emoji ? 'Emoji ändern' : 'Emoji wählen'}
                  className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-ctl text-[1.75rem] leading-none transition-colors duration-120 hover:bg-hover md:size-12 md:text-[2rem]"
                />
              }
            >
              {draft.emoji ?? <SmilePlus className="size-6 text-muted" aria-hidden="true" />}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" title="Emoji der Seite">
              <PausePageShortcuts />
              <EmojiPicker
                className="mt-2"
                onPick={(emoji) => {
                  setEmojiOpen(false);
                  change({ emoji }, { now: true });
                }}
              />
              {draft.emoji && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  className="mt-2"
                  onClick={() => {
                    setEmojiOpen(false);
                    change({ emoji: null }, { now: true });
                  }}
                >
                  Emoji entfernen
                </Button>
              )}
            </PopoverContent>
          </Popover>
        ) : (
          page.emoji && (
            <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center text-[1.75rem] leading-none md:size-12 md:text-[2rem]">
              {page.emoji}
            </span>
          )
        )}
        <div className="min-w-0 flex-1">
          <h1 id={`${titleErrorId}-title`} data-screen-heading="" tabIndex={-1} className="min-w-0 scroll-mt-20">
            {canEdit ? (
              <textarea
                ref={titleRef}
                value={draft.title}
                rows={1}
                name="title"
                autoComplete="off"
                spellCheck
                maxLength={MAX_TITLE}
                aria-label="Titel der Seite"
                placeholder="Titel der Seite …"
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? titleErrorId : undefined}
                onChange={(event) => change({ title: event.target.value.replace(/\r?\n/g, ' ') })}
                onKeyDown={onTitleKeyDown}
                onBlur={() => void save.current()}
                className={cx(
                  'block w-full resize-none rounded-ctl bg-transparent px-1 py-0.5 font-display text-2xl font-extrabold tracking-display text-balance text-ink [field-sizing:content] placeholder:text-muted md:text-3xl',
                  titleError && 'shadow-[inset_0_-1.5px_0_var(--danger)]',
                )}
              />
            ) : (
              <span className="block px-1 py-0.5 font-display text-2xl font-extrabold tracking-display text-balance break-words text-ink md:text-3xl">{page.title}</span>
            )}
          </h1>
          <div aria-live="polite">
            {titleError && (
              <p id={titleErrorId} className="mt-1 px-1 text-sm font-medium text-danger">
                {titleError}
              </p>
            )}
          </div>
          <p className="mt-1 px-1 text-sm text-pretty text-muted">
            Zuletzt geändert von {editor} am {longDay(page.updated_at)}
          </p>
          {rights.denied && (
            <p className="mt-1 flex items-start gap-1.5 px-1 text-sm text-pretty text-muted">
              <Eye className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {rights.denied}
            </p>
          )}
        </div>
      </div>

      {conflict && canEdit && <ConflictBanner message={conflict.message} onReload={reload} onKeepMine={keepMine} className="mt-5" />}

      <div
        data-wiki-body=""
        className="wiki-body mt-6 md:mt-8"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void save.current();
        }}
      >
        {canEdit ? (
          <UploadOwnerContext.Provider value={owner}>
            <RichTextEditor value={draft.content} onChange={(doc) => change({ content: doc })} preset="page" projectId={projectId} onSubmit={() => void save.current()} />
          </UploadOwnerContext.Provider>
        ) : page.content && !isEmptyDoc(page.content) ? (
          <div className="wiki-read">
            <RichTextView value={page.content} />
          </div>
        ) : (
          <p className="text-ui text-muted">Diese Seite ist noch leer.</p>
        )}
      </div>

      <VersionsDialog page={page} open={versionsOpen} onOpenChange={setVersionsOpen} restoreReason={rights.denied} beforeRestore={flush} />
    </article>
  );
}
