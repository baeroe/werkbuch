/*
 * The head of the item detail (moodboard panel):
 * - `ItemHeader`: in the preview the project and the actions in one row (watch, copy link, open as page, more, close);
 *   on the page the path (project, parent items, key) with the same actions.
 * - `ItemTitle`: the title, edited in place (`e`, or a click): Enter saves, Escape takes it back (and is used up, so
 *   the preview stays open), leaving the field saves.
 * The "more" menu has the item's actions: sub-item, relation, archive (closed items only) or restore, delete (with the
 * right `item.delete`) and the demo of the description conflict. Archive and delete wait for their undo toast (5 s).
 */

import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowRightLeft, ChevronRight, CornerDownRight, Ellipsis, Eye, FlaskConical, Link2, Maximize2, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, type Page } from '@/api/client';
import { useEditReason } from '@/components/fields/itemData';
import { ItemKey } from '@/components/items/ItemKey';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { isClosedCategory } from '@/domain/workflow';
import { qk } from '@/hooks/keys';
import { useProjects } from '@/hooks/projects';
import { useArchiveWorkItem, useDeleteWorkItem, useRestoreWorkItem, useSetSubscribed, useUpdateWorkItem, useWorkItem } from '@/hooks/workItems';
import { usePermissions } from '@/lib/permissions';
import { runWithUndo } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import type { Project, WorkItem, WorkItemDetail } from '@/types';
import { useDetail, type DetailSurface } from './shared';

const MAX_TITLE = 255;

const denied = (reason: string) => toast({ title: 'Nicht möglich', description: reason, tone: 'error' });

/* ------------------------------------------------------------------------------- title */

export function ItemTitle({ item }: { item: WorkItem }) {
  const { surface, actions } = useDetail();
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editing = useRef(false);
  const refocus = useRef(false);
  const errorId = useId();
  const hintId = useId();
  const Heading = surface === 'page' ? 'h1' : 'h2';
  const look = surface === 'page' ? 'text-2xl tracking-display' : 'text-xl tracking-title';

  const start = () => {
    if (reason) return denied(reason);
    editing.current = true;
    setError(null);
    setDraft(item.title);
  };

  useEffect(() => {
    const own = actions.current;
    own.editTitle = start;
    return () => {
      if (own.editTitle === start) own.editTitle = undefined;
    };
  });

  useEffect(() => {
    if (draft !== null && field.current && document.activeElement !== field.current) {
      // the caret at the end: most edits correct or extend the title
      field.current.focus();
      field.current.setSelectionRange(field.current.value.length, field.current.value.length);
    }
    if (draft === null && refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  }, [draft]);

  function finish(save: boolean, { keepFocus = true } = {}) {
    if (!editing.current || draft === null) return;
    const title = draft.trim();
    if (save && title === '') return setError('Der Titel darf nicht leer sein.');
    if (save && title.length > MAX_TITLE) return setError(`Höchstens ${MAX_TITLE} Zeichen, jetzt sind es ${title.length}.`);
    editing.current = false;
    refocus.current = keepFocus;
    setDraft(null);
    setError(null);
    if (!save || title === item.title) return;
    update.mutate(
      { id: item.id, patch: { title } },
      {
        // the hook rolls back and names the cause in a toast; a field error goes back into the field
        onError: (failure) => {
          const message = failure instanceof ApiError ? failure.errors?.title?.[0] : undefined;
          if (!message) return;
          editing.current = true;
          setDraft(title);
          setError(message);
        },
      },
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      // the field takes the Escape for itself: the preview stays open
      event.preventDefault();
      finish(false);
    }
  };

  if (draft !== null) {
    return (
      <div className="flex flex-col">
        <textarea
          ref={field}
          value={draft}
          rows={1}
          name="title"
          autoComplete="off"
          aria-label="Titel"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          maxLength={MAX_TITLE + 50}
          onChange={(event) => {
            setDraft(event.target.value.replace(/\n/g, ' '));
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => finish(true, { keepFocus: false })}
          className={cx(
            '-mx-2 block w-[calc(100%+1rem)] resize-none rounded-ctl border bg-surface px-2 py-1 font-display font-bold text-balance text-ink [field-sizing:content]',
            look,
            error ? 'border-danger shadow-[inset_0_-1.5px_0_var(--danger)]' : 'border-line shadow-[inset_0_-1.5px_0_var(--line-input)]',
          )}
        />
        <div aria-live="polite">
          {error && (
            <p id={errorId} className="mt-1.5 text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Heading className={cx('font-display font-bold text-balance break-words text-ink', look)}>
      {reason ? (
        item.title
      ) : (
        <Tooltip content="Titel bearbeiten" shortcut="e" side="bottom">
          <button
            ref={trigger}
            type="button"
            onClick={start}
            aria-keyshortcuts="E"
            aria-describedby={hintId}
            className="-mx-1 cursor-text rounded-chip px-1 text-left text-balance transition-colors duration-120 hover:bg-hover"
          >
            {item.title}
          </button>
        </Tooltip>
      )}
      {/* what the button does, for screen readers (the tooltip is visual only) */}
      {!reason && (
        <span id={hintId} hidden>
          Titel bearbeiten
        </span>
      )}
    </Heading>
  );
}

/* ---------------------------------------------------------------------------- actions */

function WatchButton({ detail }: { detail: WorkItemDetail }) {
  const watch = useSetSubscribed();
  const { item, subscribed } = detail;
  const toggle = () =>
    watch.mutate(
      { id: item.id, on: !subscribed },
      {
        onSuccess: () =>
          toast(
            subscribed
              ? { title: `Du beobachtest ${item.key} nicht mehr`, description: 'Erst eine neue Erwähnung oder Zuweisung meldet dich wieder an.' }
              : { title: `Du beobachtest ${item.key}`, description: 'Änderungen und Kommentare kommen in deine Inbox.', tone: 'success' },
          ),
      },
    );
  return <IconButton icon={Eye} label="Beobachten" aria-pressed={subscribed} onClick={toggle} />;
}

function CopyLinkButton({ item }: { item: WorkItem }) {
  const copy = async () => {
    const url = `${window.location.origin}/items/${item.key}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: `Link zu ${item.key} kopiert`, tone: 'success' });
    } catch {
      toast({ title: 'Link nicht kopiert', description: `Der Browser erlaubt das Kopieren gerade nicht. Der Link: ${url}`, tone: 'error' });
    }
  };
  return <IconButton icon={Link2} label="Link kopieren" onClick={() => void copy()} />;
}

const isPage = (data: unknown): data is Page<WorkItem> => typeof data === 'object' && data !== null && Array.isArray((data as Page<WorkItem>).items);

/**
 * Archive and delete from the detail: the lists drop the item at once and the preview closes (the page leaves for the
 * project after a delete); the change itself runs when the undo toast is over. Undo puts everything back.
 */
function useRemoval(item: WorkItem, project: Project | undefined, surface: DetailSurface) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const archive = useArchiveWorkItem();
  const remove = useDeleteWorkItem();

  function hideFromLists(): () => void {
    const listKey = [...qk.workItems.all, 'list'];
    const before = queryClient.getQueriesData<unknown>({ queryKey: listKey });
    queryClient.setQueriesData({ queryKey: listKey }, (data: unknown) =>
      isPage(data) ? { ...data, items: data.items.filter((entry) => entry.id !== item.id), total: Math.max(0, data.total - 1) } : data,
    );
    return () => {
      before.forEach(([key, data]) => queryClient.setQueryData(key, data));
      void queryClient.invalidateQueries({ queryKey: qk.workItems.all });
    };
  }

  const closePeek = () => {
    if (surface === 'peek') useUiStore.getState().openPeek(null);
  };
  const reopenPeek = () => {
    if (surface === 'peek') useUiStore.getState().openPeek(item.id);
  };

  return {
    archive() {
      const restore = hideFromLists();
      closePeek();
      runWithUndo({
        label: `${item.key} archiviert`,
        undo: () => {
          restore();
          reopenPeek();
        },
        run: async () => {
          try {
            await archive.mutateAsync(item.id);
          } catch {
            // the item mutation names the cause itself (with "Erneut versuchen" where it helps)
            restore();
          }
        },
      });
    },
    remove() {
      const restore = hideFromLists();
      closePeek();
      if (surface === 'page' && project) navigate(`/projects/${project.identifier}`);
      runWithUndo({
        label: `${item.key} gelöscht`,
        undo: () => {
          restore();
          reopenPeek();
          if (surface === 'page') navigate(`/items/${item.key}`);
        },
        failureTitle: `${item.key} nicht gelöscht`,
        run: async () => {
          try {
            await remove.mutateAsync(item.id);
          } catch (error) {
            restore();
            throw error;
          }
        },
      });
    },
  };
}

function ItemMenu({ detail, project }: { detail: WorkItemDetail; project: Project | undefined }) {
  const { surface, actions } = useDetail();
  const { item, state } = detail;
  const { can, reason } = usePermissions();
  const restore = useRestoreWorkItem();
  const removal = useRemoval(item, project, surface);
  const editReason = useEditReason(item);
  const archived = item.archived_at !== null;
  const closed = isClosedCategory(state.category);
  const canDelete = can('item.delete', item.project_id);
  const canCreate = !archived && can('item.create', item.project_id);
  const canRestore = archived && reason('item.edit', item.project_id) === null;
  const canArchive = !archived && closed && !editReason;

  // the menu holds only what the person may do; with nothing to offer there is no menu
  const sections: ReactNode[] = [
    (canCreate || !editReason) && (
      <MenuGroup key="add">
        {canCreate && (
          <MenuItem icon={CornerDownRight} onClick={() => useUiStore.getState().openCreate({ project_id: item.project_id, parent_id: item.id })}>
            Sub-Item anlegen …
          </MenuItem>
        )}
        {!editReason && (
          <MenuItem icon={ArrowRightLeft} shortcut="r" onClick={() => actions.current.addRelation?.()}>
            Relation hinzufügen …
          </MenuItem>
        )}
      </MenuGroup>
    ),
    (canRestore || canArchive || canDelete) && (
      <MenuGroup key="remove">
        {canRestore && (
          <MenuItem icon={ArchiveRestore} onClick={() => restore.mutate(item.id, { onSuccess: () => toast({ title: `${item.key} wiederhergestellt`, tone: 'success' }) })}>
            Wiederherstellen
          </MenuItem>
        )}
        {canArchive && (
          <MenuItem icon={Archive} shortcut="mod+backspace" onClick={removal.archive}>
            Archivieren
          </MenuItem>
        )}
        {canDelete && (
          <MenuItem icon={Trash2} danger shortcut={canArchive ? undefined : 'mod+backspace'} onClick={removal.remove}>
            Löschen
          </MenuItem>
        )}
      </MenuGroup>
    ),
    !editReason && (
      <MenuGroup key="demo">
        <MenuGroupLabel>Demo</MenuGroupLabel>
        <MenuItem icon={FlaskConical} onClick={() => actions.current.simulateConflict?.()}>
          Beschreibungskonflikt simulieren
        </MenuItem>
      </MenuGroup>
    ),
  ].filter(Boolean);
  if (sections.length === 0) return null;

  return (
    <Menu>
      <MenuTrigger render={<IconButton icon={Ellipsis} label="Weitere Aktionen" tooltip={false} />} />
      <MenuContent align="end" className="w-64">
        {sections.map((section, index) => (
          <Fragment key={index}>
            {index > 0 && <MenuSeparator />}
            {section}
          </Fragment>
        ))}
      </MenuContent>
    </Menu>
  );
}

/* -------------------------------------------------------------------------------- path */

/** The parents of an item on the path, the farthest first; at most three, the rest is "…". */
function ParentCrumbs({ id, depth }: { id: string; depth: number }) {
  const parent = useWorkItem(id).data?.item;
  if (!parent) return null;
  return (
    <>
      {depth < 2 && parent.parent_id ? (
        <ParentCrumbs id={parent.parent_id} depth={depth + 1} />
      ) : parent.parent_id ? (
        <li className="flex items-center gap-1.5" aria-hidden="true">
          …<ChevronRight className="size-3.5 shrink-0" />
        </li>
      ) : null}
      <li className="flex min-w-0 items-center gap-1.5">
        <Link to={`/items/${parent.key}`} className="flex min-h-11 min-w-0 items-center gap-1.5 rounded-chip text-muted hover:text-ink md:min-h-6">
          <ItemKey value={parent.key} />
          <span className="hidden min-w-0 truncate md:inline">{parent.title}</span>
        </Link>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
      </li>
    </>
  );
}

function Path({ item, project }: { item: WorkItem; project: Project | undefined }) {
  return (
    <nav aria-label="Pfad" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
        <li className="flex min-w-0 shrink-0 items-center gap-1.5">
          {project ? (
            <Link to={`/projects/${project.identifier}`} className="flex min-h-11 items-center gap-1.5 rounded-chip hover:text-ink md:min-h-6">
              <ProjectBadge project={project} />
              <span className="max-w-40 truncate">{project.name}</span>
            </Link>
          ) : (
            <Skeleton className="h-4 w-28" />
          )}
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        </li>
        {item.parent_id && <ParentCrumbs id={item.parent_id} depth={0} />}
        <li aria-current="page" className="shrink-0 text-ink">
          <ItemKey value={item.key} />
        </li>
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------------------ header */

type ItemHeaderProps = {
  detail: WorkItemDetail | undefined;
  surface: DetailSurface;
  /** The preview's close button. */
  onClose?: () => void;
};

export function ItemHeader({ detail, surface, onClose }: ItemHeaderProps) {
  const projects = useProjects({ include_archived: true }).data?.items;
  const item = detail?.item;
  const project = item ? projects?.find((entry) => entry.id === item.project_id) : undefined;

  const actions = detail && item && (
    <>
      <WatchButton detail={detail} />
      <CopyLinkButton item={item} />
      {surface === 'peek' && (
        <Tooltip content="Als Seite öffnen">
          <Link
            to={`/items/${item.key}`}
            aria-label="Als Seite öffnen"
            className="inline-flex size-11 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink md:size-7"
          >
            <Maximize2 className="size-4" aria-hidden="true" />
          </Link>
        </Tooltip>
      )}
      <ItemMenu detail={detail} project={project} />
    </>
  );

  if (surface === 'page') {
    return item ? (
      <div className="flex min-h-11 items-center gap-2">
        <Path item={item} project={project} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>
      </div>
    ) : null;
  }

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-edge pr-2 pl-4 md:h-11">
      {detail && item ? (
        <>
          {/* below md the panel starts under the top bar: the key sits in the row instead of on a tab */}
          <span
            data-tone={detail.type.tone}
            translate="no"
            className="inline-flex h-6 shrink-0 items-center rounded-chip bg-[var(--tab-bg)] px-2 text-xs font-semibold text-[var(--tab-ink)] tabular-nums md:hidden"
          >
            {item.key}
          </span>
          {project ? (
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted" title={project.name}>
              <ProjectBadge project={project} />
              {/* on phones the row needs the room for its 44 px buttons */}
              <span className="hidden truncate md:inline">{project.name}</span>
              <span className="sr-only md:hidden">{project.name}</span>
            </span>
          ) : (
            <Skeleton className="h-4 w-28" />
          )}
        </>
      ) : (
        <Skeleton className="h-4 w-32" />
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {actions}
        <IconButton icon={X} label="Vorschau schließen" shortcut="escape" onClick={onClose} />
      </div>
    </div>
  );
}

const ARCHIVED_DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });

/** Archived: read-only and out of the lists; who may change the item can bring it back. */
export function ArchivedNote({ item }: { item: WorkItem }) {
  const { reason } = usePermissions();
  const restore = useRestoreWorkItem();
  if (item.archived_at === null) return null;
  const allowed = reason('item.edit', item.project_id) === null;
  return (
    <div role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ctl bg-sunken px-3 py-2">
      <Archive className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-ui text-pretty text-ink">
        <span className="font-semibold">Archiviert am {ARCHIVED_DAY.format(new Date(item.archived_at))}.</span> Schreibgeschützt und in Listen ausgeblendet, bis
        jemand es wiederherstellt.
      </p>
      {allowed && (
        <button
          type="button"
          // the item mutation names a failure itself
          onClick={() => restore.mutate(item.id, { onSuccess: () => toast({ title: `${item.key} wiederhergestellt`, tone: 'success' }) })}
          disabled={restore.isPending}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-ctl border border-line-strong bg-surface px-2.5 text-sm font-semibold text-ink shadow-elev-1 transition-colors duration-120 hover:bg-sunken md:h-7"
        >
          <ArchiveRestore className="size-4 text-muted" aria-hidden="true" />
          Wiederherstellen
        </button>
      )}
    </div>
  );
}
