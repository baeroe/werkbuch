/*
 * The header of every part of a project (WEBU-13): items, wiki, templates and settings. One row badge › project › part,
 * an action at the end of it, and the tabs of the parts (`ProjectSections`) right below, so the four screens put the
 * same header in the same place and nothing jumps when one switches between them.
 * - On the items the project itself is the h1 (the list is the project); the part follows in pencil, then the star.
 * - On the wiki, the templates and the settings the part is the h1 (`data-screen-heading`, the place the focus goes to
 *   when what had it is gone), the project a link to its items.
 * - Below a part (a page of the wiki, a template) the part is text: the screen has its own h1, and the tab right below
 *   is the one link back up.
 */

import { Link } from '@inertiajs/react';
import { ChevronRight } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { cx } from '@/components/ui/cx';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { t, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Project } from '@/types';
import { ProjectSections, type ProjectSection } from './ProjectSections';

/** The name of each part in the header. */
const PART_TITLE: Record<ProjectSection, TranslationKey> = {
  items: 'items.screen.items',
  wiki: 'wiki.title',
  templates: 'templates.title',
  settings: 'settings.project.title',
};

const TITLE = 'font-display text-lg font-bold tracking-title text-ink';

interface ProjectHeaderProps {
  project: Project;
  section: ProjectSection;
  /**
   * What the h1 of the header is: the project (the items), the part (the default) or nothing, when the screen shows
   * something below the part with a heading of its own (a page of the wiki, a template).
   */
  heading?: 'project' | 'part' | 'none';
  /** The screen shows something below the part: its tab leads back up (`aria-current="true"`). */
  below?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  /** After the name of the part, e.g. the star of the project. */
  after?: ReactNode;
  /** At the end of the row, e.g. "Neue Seite" or the switch of the layout. */
  actions?: ReactNode;
}

export function ProjectHeader({ project, section, heading = 'part', below = false, headingRef, after, actions }: ProjectHeaderProps) {
  const part = t(PART_TITLE[section]);
  return (
    <>
      <header className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <ProjectBadge project={project} />
          {heading === 'project' ? (
            <h1 ref={headingRef} className={cx('truncate', TITLE)}>
              {project.name}
            </h1>
          ) : (
            <Link
              href={paths.project(project.identifier)}
              className="inline-flex min-h-11 min-w-0 items-center text-ui font-medium text-muted no-underline hover:text-ink hover:underline md:min-h-0"
            >
              <span className="truncate">{project.name}</span>
            </Link>
          )}
          <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          {heading === 'project' && <span className="shrink-0 text-ui font-medium text-muted">{part}</span>}
          {heading === 'none' && <span className={cx('shrink-0', TITLE)}>{part}</span>}
          {heading === 'part' && (
            <h1 ref={headingRef} data-screen-heading="" tabIndex={-1} className={cx('shrink-0 scroll-mt-20', TITLE)}>
              {part}
            </h1>
          )}
          {after}
        </div>
        {actions && <div className="ml-auto">{actions}</div>}
      </header>
      <ProjectSections project={project} current={section} below={below} />
    </>
  );
}

/**
 * The header in outline while the project loads, in the height of the real one (tabs of 44 px below md and on touch):
 * the row of badge and names, then the line of the tabs. Only a picture: the skeleton group around it, or the skeleton
 * of the content below, says that the screen loads.
 */
export function ProjectHeaderSkeleton() {
  return (
    <div aria-hidden="true" data-project-header-skeleton="">
      <div className="flex min-h-8 items-center gap-2">
        <Skeleton className="size-5 rounded-chip" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="mt-2 flex h-11 items-center gap-3 border-b border-line md:h-9 pointer-coarse:h-11">
        <Skeleton className="h-3.5 w-12" />
        <Skeleton className="h-3.5 w-10" />
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3.5 w-20" />
      </div>
    </div>
  );
}
