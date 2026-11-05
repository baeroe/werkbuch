/*
 * The templates of a project (spec 4.12), ported from the clickdummy: sorted by name in the language of the page, each
 * with its schedule and its next run (`TemplateRow`). "Neue Vorlage" stands in the header and in the empty state, only
 * for whoever may manage templates (`template.manage`); a viewer reads the line that says why instead. Deleting takes
 * the row away at once with five seconds of undo (`useRemoval`, which runs `runWithUndo`); the focus goes to the
 * neighbouring row, else to "Neue Vorlage", else to the heading. A delete that fails brings the row back with "Erneut
 * versuchen". The palette offers "Neue Vorlage" (`templates.create`) with the right.
 */

import { router } from '@inertiajs/react';
import { Eye, LayoutTemplate, Plus } from 'lucide-react';
import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useRemoval } from '@/features/settings/frame/useRemoval';
import { useDeleteTemplate, useTemplates } from '@/hooks/templates';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useCommand } from '@/lib/commands';
import { intlLocale, t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Project, Template } from '@/types';
import type { TemplateRights } from './rights';
import { TemplateRow } from './TemplateRow';

/** The id under which the editor makes a new template (`/projects/<KENNUNG>/templates/new`). */
export const NEW_TEMPLATE = 'new';

function ListSkeleton() {
  return (
    <SkeletonGroup label={t('templates.loading')} className="flex flex-col gap-1">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-start gap-3 px-2 py-3">
          <Skeleton className="size-8 rounded-ctl" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-8 w-40 md:block" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

type TemplateListProps = {
  project: Project;
  /** The header of the screen (project, "Vorlagen"). */
  header: ReactNode;
  /** The heading of the screen: where the focus goes when nothing else is left after a delete. */
  heading: RefObject<HTMLHeadingElement | null>;
  rights: TemplateRights;
};

export function TemplateList({ project, header, heading, rights }: TemplateListProps) {
  const templates = useTemplates(project.id);
  const types = useWorkItemTypes().data?.items;
  const deleteTemplate = useDeleteTemplate();
  const { hidden, remove } = useRemoval();
  const newButton = useRef<HTMLButtonElement>(null);
  const canManage = rights.ready && rights.denied === null;

  const visible = useMemo(() => {
    const collator = new Intl.Collator(intlLocale());
    return (templates.data?.items ?? []).filter((template) => !hidden.has(template.id)).sort((a, b) => collator.compare(a.name, b.name));
  }, [templates.data, hidden]);

  const create = () => router.visit(paths.templates(project.identifier, NEW_TEMPLATE));
  // registered anew when the right arrives, so an open palette shows it then
  useCommand(
    {
      id: 'templates.create',
      label: t('templates.new'),
      group: t('templates.command_group', { identifier: project.identifier }),
      icon: <Plus />,
      keywords: [t('templates.command_keywords')],
      run: create,
      when: () => canManage,
    },
    [canManage, project.identifier],
  );

  function removeTemplate(template: Template) {
    remove({
      id: template.id,
      label: t('templates.deleted', { name: template.name }),
      failureTitle: t('templates.not_deleted', { name: template.name }),
      run: () => deleteTemplate.mutateAsync(template.id),
      fallback: newButton.current ?? heading.current,
    });
  }

  // while the rights load, the button says so; a viewer gets no button, but the line that says why
  const newTemplate = (ref?: RefObject<HTMLButtonElement | null>) =>
    rights.denied === null || !rights.ready ? (
      <Button ref={ref} variant="primary" icon={Plus} disabledReason={rights.denied} onClick={create}>
        {t('templates.new')}
      </Button>
    ) : null;

  let content;
  if (templates.isPending) content = <ListSkeleton />;
  else if (templates.isError && !templates.data) {
    content = (
      <ErrorState
        title={t('templates.load_failed')}
        description={templates.error instanceof ApiError ? templates.error.message : t('errors.no_answer')}
        onRetry={() => void templates.refetch()}
        retrying={templates.isFetching}
      />
    );
  } else if (visible.length === 0) {
    content = <EmptyState icon={LayoutTemplate} title={t('templates.empty.title')} description={t('templates.empty.description')} actions={newTemplate()} />;
  } else {
    content = (
      <ul aria-label={t('templates.list_label', { project: project.name })} className="flex flex-col gap-0.5">
        {visible.map((template) => (
          <TemplateRow
            key={template.id}
            template={template}
            href={paths.templates(project.identifier, template.id)}
            type={types?.find((type) => type.id === template.payload.type_id)}
            onDelete={canManage ? removeTemplate : undefined}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="max-w-5xl min-w-0">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          {header}
          <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{t('templates.description')}</p>
          {rights.ready && rights.denied !== null && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-pretty text-muted">
              <Eye className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {rights.denied}
            </p>
          )}
        </div>
        <div className="ml-auto">{newTemplate(newButton)}</div>
      </div>
      <div className={cx('mt-4', visible.length > 0 && 'dots rounded-card border border-line-strong bg-paper p-2 shadow-elev-1')}>{content}</div>
    </div>
  );
}
