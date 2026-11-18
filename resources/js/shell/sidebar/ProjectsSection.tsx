/*
 * The starred projects of the sidebar, in the order of the favorites (archived ones and those the person no longer
 * sees are left out). The name of a project is a link to its items (WEBU-10); the chevron beside it opens the project to
 * Items, Wiki, Templates and Settings, the one of the current page starts open.
 */

import { Link, usePage } from '@inertiajs/react';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, ChevronDown, LayoutTemplate, Settings, SquareKanban } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { isPlainClick } from '@/components/items/ItemLink';
import { cx } from '@/components/ui/cx';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { useProjects } from '@/hooks/projects';
import { useFavorites } from '@/hooks/views';
import { t, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { AddLink, SectionError, SectionHeader, SectionLoading, SideLink } from './parts';

/** The areas of a project under its name in the sidebar; Items, Wiki and Templates open with their phases. */
const PROJECT_AREAS: { href: (identifier: string) => string; label: TranslationKey; icon: LucideIcon; end?: boolean }[] = [
  { href: (identifier) => paths.project(identifier), label: 'shell.nav.project_items', icon: SquareKanban, end: true },
  { href: (identifier) => paths.wiki(identifier), label: 'shell.nav.project_wiki', icon: BookOpen },
  { href: (identifier) => paths.templates(identifier), label: 'shell.nav.project_templates', icon: LayoutTemplate },
  { href: (identifier) => paths.projectSettings(identifier), label: 'shell.nav.project_settings', icon: Settings },
];

/** The identifier of the project the current page belongs to, if any. */
function useCurrentProject(): string | undefined {
  const { url } = usePage();
  return /^\/projects\/([^/?#]+)/.exec(url)?.[1];
}

/** The starred projects (archived ones and those the person no longer sees are left out), and the link to all of them. */
export function ProjectsSection() {
  const id = useId();
  const favorites = useFavorites();
  // the query of the rights (archived ones included), so the list loads once; archived projects stay out of the sidebar
  const projects = useProjects({ include_archived: true });
  const { reason } = usePermissions();
  const current = useCurrentProject();
  // the project of the current page starts open; the chevron overrides that per project
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const favoriteProjects = (favorites.data?.items ?? [])
    .filter((favorite) => favorite.kind === 'project')
    .flatMap((favorite) => projects.data?.items.filter((project) => project.id === favorite.id && project.archived_at === null) ?? []);

  let rows: ReactNode;
  if (favorites.isError || projects.isError) {
    rows = (
      <SectionError
        message={t('shell.nav.projects_failed')}
        onRetry={() => {
          void favorites.refetch();
          void projects.refetch();
        }}
      />
    );
  } else if (!favorites.data || !projects.data) {
    rows = <SectionLoading label={t('shell.nav.projects_loading')} />;
  } else if (favoriteProjects.length === 0) {
    rows = <li className="px-2 py-1 text-sm text-pretty text-muted">{t('shell.nav.starred_projects_empty')}</li>;
  } else {
    rows = favoriteProjects.map((project) => {
      const open = toggled[project.id] ?? project.identifier === current;
      const areasId = `${id}-${project.id}`;
      return (
        <li key={project.id}>
          <div className="flex min-w-0 items-center rounded-ctl transition-colors duration-120 hover:bg-hover">
            {/* the name opens the items; going there opens the project as the current one, so a closing of the
                chevron from before no longer holds (not for a click into a new tab: this page stays) */}
            <Link
              href={paths.project(project.identifier)}
              onClick={(event) => isPlainClick(event) && setToggled(({ [project.id]: _dropped, ...rest }) => rest)}
              className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-ctl pl-2 text-ui font-medium text-ink md:h-8"
            >
              <ProjectBadge project={project} />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </Link>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={areasId}
              aria-label={t('shell.nav.project_parts', { name: project.name })}
              onClick={() => setToggled((state) => ({ ...state, [project.id]: !open }))}
              className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-ctl text-muted hover:text-ink md:size-8"
            >
              <ChevronDown className={cx('size-3.5 transition-transform duration-160', !open && '-rotate-90')} aria-hidden="true" />
            </button>
          </div>
          {open && (
            <ul id={areasId} className="mt-0.5 flex flex-col gap-0.5">
              {PROJECT_AREAS.map(({ href, label, icon: Icon, end }) => (
                <li key={label}>
                  <SideLink href={href(project.identifier)} end={end} indent leading={<Icon className="size-4" aria-hidden="true" />}>
                    {t(label)}
                  </SideLink>
                </li>
              ))}
            </ul>
          )}
        </li>
      );
    });
  }

  return (
    <section aria-labelledby={id}>
      <SectionHeader
        id={id}
        title={t('shell.nav.projects')}
        action={<AddLink href={paths.newProject()} label={t('shell.nav.create_project')} reason={reason('project.create')} />}
      />
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {rows}
        <li>
          <SideLink href={paths.projects()} end indent quiet>
            {t('shell.nav.all_projects')}
          </SideLink>
        </li>
      </ul>
    </section>
  );
}
