/*
 * All team views (spec 4.11, 5.2): who made them, how they look, and the star that puts a view into the sidebar. A view
 * belongs to the whole team: everybody may make one and save a copy of any view; only the creator and org admins
 * change or delete one, everyone else sees those two buttons off with the reason (`usePermissions`). A delete has
 * 5 seconds of undo. The sidebar's "View anlegen" leads here with `?create=1`, which opens the dialog "Neue View".
 */

import { Copy, Layers, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { useUserMap } from '@/components/fields/itemData';
import { linkFocusRing } from '@/components/items/ItemLink';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { ViewIcon } from '@/components/ui/ViewIcon';
import { useDeleteView, useSaveView, useViews } from '@/hooks/views';
import { useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import { runWithUndo } from '@/lib/undo';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useSession } from '@/store/session';
import { useUiStore } from '@/store/ui';
import type { View } from '@/types';
import { FavoriteStar } from './FavoriteStar';
import { ViewDialog } from './ViewDialog';
import { groupingText, LAYOUTS } from './viewForm';

const COLLATOR = new Intl.Collator('de-DE');

/** Rows in the shape of the list while it loads. */
function ViewsSkeleton() {
  return (
    <SkeletonGroup label="Views werden geladen …" className="flex flex-col gap-1">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="size-8 rounded-ctl" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-6 w-24 md:block" />
          <Skeleton className="hidden h-5 w-36 md:block" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

type ViewRowProps = {
  view: View;
  copying: boolean;
  /** Why the person may not change or delete the view, or null when they may. */
  manageReason: string | null;
  onCopy: (view: View) => void;
  onEdit: (view: View) => void;
  onDelete: (view: View) => void;
};

function ViewRow({ view, copying, manageReason, onCopy, onEdit, onDelete }: ViewRowProps) {
  const creator = useUserMap().get(view.created_by);
  const flashing = useUiStore((state) => state.flashIds.includes(view.id));
  const layout = LAYOUTS[view.display.layout];

  return (
    <li
      className={cx(
        'relative grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-ctl px-2 py-2 transition-colors duration-120',
        'md:grid-cols-[2rem_minmax(0,1fr)_7rem_11.5rem_auto]',
        flashing ? 'bg-wash' : 'hover:bg-hover',
        linkFocusRing,
      )}
    >
      <span aria-hidden="true" className="row-span-3 inline-flex size-8 items-center justify-center self-start rounded-ctl border border-line bg-surface text-muted shadow-elev-1 md:row-span-1 md:self-center">
        <ViewIcon icon={view.icon} />
      </span>
      <div className="col-start-2 min-w-0 md:col-start-2">
        <Link
          to={`/views/${view.id}`}
          data-item-link=""
          data-focus-ring="none"
          className="block truncate rounded-chip text-ui font-medium text-ink no-underline outline-none after:absolute after:inset-0 after:rounded-ctl"
        >
          {view.name}
        </Link>
        <p className="truncate text-sm text-muted">{groupingText(view.display.group_by)}</p>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
        <Chip icon={<layout.icon className="size-3.5 text-muted" />} className="justify-self-start md:col-start-3">
          {layout.label}
        </Chip>
        <span className="inline-flex min-w-0 items-center gap-2 text-sm text-muted md:col-start-4">
          {creator && <Avatar user={creator} size="sm" decorative />}
          <span className="min-w-0 truncate">
            <span className="sr-only">Erstellt von </span>
            {creator?.name ?? 'Unbekannt'}
          </span>
        </span>
      </div>
      <div className="relative z-10 col-start-2 flex items-center justify-end gap-0.5 md:col-start-5">
        <FavoriteStar kind="view" id={view.id} name={view.name} />
        <IconButton
          icon={copying ? LoaderCircle : Copy}
          label={`„${view.name}“ duplizieren`}
          className={cx(copying && '[&>svg]:animate-spin')}
          aria-busy={copying || undefined}
          onClick={() => {
            if (!copying) onCopy(view);
          }}
        />
        <IconButton icon={Pencil} label={`„${view.name}“ bearbeiten`} disabledReason={manageReason} onClick={() => onEdit(view)} />
        <IconButton icon={Trash2} label={`„${view.name}“ löschen`} disabledReason={manageReason} onClick={() => onDelete(view)} />
      </div>
    </li>
  );
}

export function ViewsScreen() {
  useDocumentTitle('Views');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const views = useViews();
  const saveView = useSaveView();
  const deleteView = useDeleteView();
  const { reason } = usePermissions();
  const me = useSession((state) => state.userId);

  /** The dialog and what it shows; the view stays while the dialog fades out, so its title does not change meanwhile. */
  const [dialog, setDialog] = useState<{ open: boolean; view: View | null }>({ open: false, view: null });
  /** Views waiting for their delete (the toast with "Rückgängig" runs), views whose copy is on its way. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [copying, setCopying] = useState<ReadonlySet<string>>(() => new Set());

  // the sidebar's "View anlegen" comes as `?create=1`: it opens the dialog once and leaves nothing in the address
  const createRequested = params.get('create') === '1';
  useEffect(() => {
    if (!createRequested) return;
    setDialog({ open: true, view: null });
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }, [createRequested, params, setParams]);

  const sorted = useMemo(() => [...(views.data?.items ?? [])].sort((a, b) => COLLATOR.compare(a.name, b.name)), [views.data]);
  const visible = sorted.filter((view) => !hidden.has(view.id));

  const createReason = reason('view.create');
  const openCreate = () => setDialog({ open: true, view: null });
  useCommand({ id: 'views.create', label: 'Neue View', group: 'Views', icon: <Plus />, keywords: ['anlegen', 'erstellen', 'view'], run: openCreate, when: () => createReason === null });

  /**
   * "Als neue View speichern": every member may, of any view. The copy is theirs. Every copy ends itself
   * (`mutateAsync`): with several copies on their way, the callbacks of `mutate` would only be called for the last one
   * (one hook, one observer), and the row of an earlier copy would stay busy for good.
   */
  async function copy(view: View) {
    setCopying((state) => new Set(state).add(view.id));
    try {
      const saved = await saveView.mutateAsync({ name: `${view.name} (Kopie)`, icon: view.icon, filter: view.filter, display: view.display });
      useUiStore.getState().flash(saved.id);
      toast({ title: `„${saved.name}“ angelegt`, tone: 'success', action: { label: 'Öffnen', onClick: () => void navigate(`/views/${saved.id}`) } });
    } catch (error) {
      notifyError(`„${view.name}“ nicht dupliziert`, error, () => void copy(view));
    } finally {
      setCopying((state) => new Set([...state].filter((id) => id !== view.id)));
    }
  }

  /** The row goes at once, the call follows when the toast runs out; "Rückgängig" brings the row back. */
  function remove(view: View) {
    setHidden((state) => new Set(state).add(view.id));
    const show = () => setHidden((state) => new Set([...state].filter((id) => id !== view.id)));
    runWithUndo({
      label: `„${view.name}“ gelöscht`,
      failureTitle: `„${view.name}“ nicht gelöscht`,
      undo: show,
      run: async () => {
        try {
          await deleteView.mutateAsync(view.id);
        } catch (error) {
          show();
          throw error;
        }
      },
    });
  }

  function saved(view: View, created: boolean) {
    setDialog((state) => ({ ...state, open: false }));
    toast({ title: `„${view.name}“ ${created ? 'angelegt' : 'gespeichert'}`, tone: 'success' });
    // a new view is empty: its filter is made in the view
    if (created) void navigate(`/views/${view.id}`);
  }

  const newViewButton = (
    <Button variant="primary" icon={Plus} disabledReason={createReason} onClick={openCreate}>
      Neue View
    </Button>
  );

  let content;
  if (views.isPending) {
    content = <ViewsSkeleton />;
  } else if (views.isError && !views.data) {
    content = (
      <ErrorState
        title="Die Views konnten nicht geladen werden"
        description={views.error instanceof ApiError ? views.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void views.refetch()}
        retrying={views.isFetching}
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        icon={Layers}
        title="Noch keine Views"
        description="Eine View speichert Filter und Darstellung für das ganze Team, zum Beispiel „Fällig diese Woche“ oder „Bugs in Produktion“."
        actions={newViewButton}
      />
    );
  } else {
    content = (
      <ul aria-label="Alle Views" className="flex flex-col gap-0.5">
        {visible.map((view) => (
          <ViewRow
            key={view.id}
            view={view}
            copying={copying.has(view.id)}
            manageReason={view.created_by === me ? null : reason('view.manage_any')}
            onCopy={copy}
            onEdit={(target) => setDialog({ open: true, view: target })}
            onDelete={remove}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-title text-ink">Views</h1>
          <p className="max-w-[65ch] text-ui text-pretty text-muted">Gemeinsame Ansichten für das ganze Team. Sie gelten projektübergreifend.</p>
        </div>
        <div className="ml-auto">{newViewButton}</div>
      </div>
      <div className="dots mt-4 rounded-card border border-line-strong bg-paper p-2 shadow-elev-1">{content}</div>
      <ViewDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((state) => ({ ...state, open }))}
        view={dialog.view}
        onSaved={saved}
      />
    </div>
  );
}
