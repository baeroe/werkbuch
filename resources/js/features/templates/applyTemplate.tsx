/*
 * "Vorlage anwenden …" in the palette (spec 4.12, 4.17, A215): the templates of every project where the person may
 * create items, each with the badge and the name of its project, the projects in their order (by name) and the
 * templates by name within. Choosing one opens the create dialog with the project and the template, and the dialog
 * applies it (`CreateForm`). The palette reads the lean templates (K24): it names them, the dialog asks the server for
 * the draft.
 *
 * Without a template to apply, the command says why in a toast instead of opening an empty list (13c): the person may
 * create items nowhere (the reason of the rights; no template is asked for then), the projects where she may have no
 * template (with where templates are made), or the templates did not load ("Erneut versuchen"). It stays out of the
 * palette while the templates, the projects and the rights load, and while the create dialog is open (the dialog has
 * its own choice of template).
 */

import { LayoutTemplate } from 'lucide-react';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { toast } from '@/components/ui/toast';
import { useProjects } from '@/hooks/projects';
import { useTemplateSummaries } from '@/hooks/templates';
import { SHELL_COMMAND_GROUPS, useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';

const [ACTIONS] = SHELL_COMMAND_GROUPS;

const ui = () => useUiStore.getState();

export function useApplyTemplateCommand(): void {
  const { can, reason, loading } = usePermissions();
  // the same list as the rights: no request of its own
  const projects = useProjects({ include_archived: true });
  const mayCreate = !loading && can('item.create');
  const templates = useTemplateSummaries(undefined, { enabled: mayCreate });
  const projectList = projects.data?.items;
  const failed = templates.isError && templates.data === undefined ? templates : undefined;
  const ready = !loading && (!mayCreate || failed !== undefined || (templates.data !== undefined && projectList !== undefined));

  const collator = new Intl.Collator(intlLocale(), { sensitivity: 'base' });
  const usable = (mayCreate ? (templates.data?.items ?? []) : [])
    .flatMap((template) => {
      const project = projectList?.find((entry) => entry.id === template.project_id);
      return project && can('item.create', project.id) ? [{ template, project }] : [];
    })
    .sort((a, b) => collator.compare(a.project.name, b.project.name) || a.project.id.localeCompare(b.project.id) || collator.compare(a.template.name, b.template.name));
  const offers = usable.length > 0 && failed === undefined;

  /** Why there is nothing to choose: the templates did not load, the person may create items nowhere, or no template. */
  function explain() {
    if (failed) {
      notifyError(t('templates.apply.failed'), failed.error, () => void failed.refetch());
      return;
    }
    toast({ title: t('templates.apply.none.title'), description: reason('item.create') ?? t('templates.apply.none.description'), tone: 'error' });
  }

  useCommand(
    {
      id: 'items.apply_template',
      label: t('templates.apply.label'),
      group: t(ACTIONS),
      icon: <LayoutTemplate />,
      keywords: [t('templates.apply.keywords')],
      when: () => ready && !ui().createOpen,
      // with templates to choose from, the palette opens their list instead
      run: () => {
        if (!offers) explain();
      },
      subpage: offers
        ? () => ({
            placeholder: t('templates.apply.placeholder'),
            options: usable.map(({ template, project }) => ({
              id: template.id,
              label: template.name,
              // the badge is 20 px; the margin fits it into the 16 px slot of an option's icon
              icon: <ProjectBadge project={project} className="-m-0.5" />,
              hint: project.name,
              keywords: [project.name, project.identifier],
              run: () => ui().openCreate({ project_id: project.id, template_id: template.id }),
            })),
          })
        : undefined,
    },
    // registered anew when what it offers changes, so an open palette shows that
    [ready, offers, usable.map(({ template }) => template.id).join(' ')],
  );
}
