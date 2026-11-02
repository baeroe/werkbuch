/*
 * All team views (spec 4.11, 5.2), ported from the clickdummy: who made them, how they look, and the star that puts a
 * view into the sidebar. A view belongs to the whole team: everybody may make one and save a copy of any view; only
 * the creator and org admins change or delete one, everyone else sees those two buttons off with the reason
 * (`usePermissions`, `ViewPolicy`). A delete takes the row away at once and has 5 seconds of undo (`useRemoval`); the
 * server takes the view out of every sidebar with it. The sidebar's "View anlegen" leads here with `?create=1` (the
 * page's prop `create`), which opens the dialog "Neue View".
 */

import { router } from '@inertiajs/react';
import { Layers, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { useRemoval } from '@/features/settings/frame/useRemoval';
import { useProjects } from '@/hooks/projects';
import { useCurrentUser } from '@/hooks/users';
import { useDeleteView, useSaveView, useViews } from '@/hooks/views';
import { useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useUiStore } from '@/store/ui';
import type { View } from '@/types';
import { ViewDialog } from './ViewDialog';
import { copyName } from './viewForm';
import { ViewRow } from './ViewRow';

/** Rows in the shape of the list while it loads. */
function ViewsSkeleton() {
  return (
    <SkeletonGroup label={t('views.loading')} className="flex flex-col gap-1">
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

export function ViewsScreen({ create }: { create: boolean }) {
  useDocumentTitle(t('views.title'));
  const views = useViews();
  // the query of the rights: the names of the projects a filter names
  const projects = useProjects({ include_archived: true });
  const saveView = useSaveView();
  const deleteView = useDeleteView();
  const { reason } = usePermissions();
  const me = useCurrentUser();
  const { hidden, remove } = useRemoval();
  const newViewButton = useRef<HTMLButtonElement>(null);

  /** The dialog and what it shows; the view stays while the dialog fades out, so its title does not change meanwhile. */
  const [dialog, setDialog] = useState<{ open: boolean; view: View | null }>({ open: false, view: null });
  /** Views whose copy is on its way. */
  const [copying, setCopying] = useState<ReadonlySet<string>>(() => new Set());

  // the sidebar's "View anlegen" comes as `?create=1`: it opens the dialog once and leaves nothing in the address
  useEffect(() => {
    if (!create) return;
    setDialog({ open: true, view: null });
    router.replace({ url: paths.views(), props: (props) => ({ ...props, create: false }), preserveState: true, preserveScroll: true });
  }, [create]);

  const visible = useMemo(() => {
    const collator = new Intl.Collator(intlLocale());
    return [...(views.data?.items ?? [])].filter((view) => !hidden.has(view.id)).sort((a, b) => collator.compare(a.name, b.name));
  }, [views.data, hidden]);

  const createReason = reason('view.create');
  const openCreate = () => setDialog({ open: true, view: null });
  // registered anew when the right arrives, so an open palette shows it then
  useCommand(
    {
      id: 'views.create',
      label: t('commands.views.create'),
      group: t('shell.nav.views'),
      icon: <Plus />,
      keywords: [t('commands.create.keywords')],
      run: openCreate,
      when: () => createReason === null,
    },
    [createReason],
  );

  /**
   * A copy of any view, for every member; the copy is theirs. Every copy ends itself (`mutateAsync`): with several
   * copies on their way, the callbacks of `mutate` would only be called for the last one.
   */
  async function copy(view: View) {
    setCopying((state) => new Set(state).add(view.id));
    try {
      const saved = await saveView.mutateAsync({ name: copyName(view.name), icon: view.icon, filter: view.filter, display: view.display });
      useUiStore.getState().flash(saved.id);
      toast({ title: t('views.created', { name: saved.name }), tone: 'success', action: { label: t('views.open'), onClick: () => router.visit(paths.view(saved.id)) } });
    } catch (error) {
      notifyError(t('views.not_duplicated', { name: view.name }), error, () => void copy(view));
    } finally {
      setCopying((state) => new Set([...state].filter((id) => id !== view.id)));
    }
  }

  /** The row goes at once, the call follows when the toast runs out; "Rückgängig" brings the row back. */
  function removeView(view: View) {
    remove({
      id: view.id,
      label: t('views.deleted', { name: view.name }),
      failureTitle: t('views.not_deleted', { name: view.name }),
      run: () => deleteView.mutateAsync(view.id),
      fallback: newViewButton.current,
    });
  }

  function saved(view: View, created: boolean) {
    setDialog((state) => ({ ...state, open: false }));
    toast({ title: t(created ? 'views.created' : 'views.saved', { name: view.name }), tone: 'success' });
    // a new view is empty: its filter is made in the view
    if (created) router.visit(paths.view(view.id));
  }

  let content;
  if (views.isPending) {
    content = <ViewsSkeleton />;
  } else if (views.isError && !views.data) {
    content = (
      <ErrorState
        title={t('views.load_failed')}
        description={views.error instanceof ApiError ? views.error.message : t('errors.no_answer')}
        onRetry={() => void views.refetch()}
        retrying={views.isFetching}
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        icon={Layers}
        title={t('views.empty.title')}
        description={t('views.empty.description')}
        actions={
          <Button variant="primary" icon={Plus} disabledReason={createReason} onClick={openCreate}>
            {t('views.new')}
          </Button>
        }
      />
    );
  } else {
    content = (
      <ul aria-label={t('views.list_label')} className="flex flex-col gap-0.5">
        {visible.map((view) => (
          <ViewRow
            key={view.id}
            view={view}
            projects={projects.data?.items}
            copying={copying.has(view.id)}
            manageReason={view.created_by === me?.id ? null : reason('view.manage_any')}
            onCopy={(target) => void copy(target)}
            onEdit={(target) => setDialog({ open: true, view: target })}
            onDelete={removeView}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-title text-ink">{t('views.title')}</h1>
          <p className="max-w-[65ch] text-ui text-pretty text-muted">{t('views.description')}</p>
        </div>
        <div className="ml-auto">
          <Button ref={newViewButton} variant="primary" icon={Plus} disabledReason={createReason} onClick={openCreate}>
            {t('views.new')}
          </Button>
        </div>
      </div>
      <div className="dots mt-4 rounded-card border border-line-strong bg-paper p-2 shadow-elev-1">{content}</div>
      <ViewDialog open={dialog.open} onOpenChange={(open) => setDialog((state) => ({ ...state, open }))} view={dialog.view} onSaved={saved} />
    </div>
  );
}
