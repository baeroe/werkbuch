/*
 * The three parts of a project: its items, its wiki and its templates (WEBU-3). The same tabs stand under the header of
 * each, so one gets from one part to the others without a star in the sidebar. Plain links like MyTabs: each part is a
 * page of its own. The part one is in carries `aria-current`: `page` on its own page, `true` below it (a page of the
 * wiki, a template), where its link leads back up.
 */

import { Link } from '@inertiajs/react';
import { t, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Project } from '@/types';

export type ProjectSection = 'items' | 'wiki' | 'templates';

export const PROJECT_SECTIONS: readonly { section: ProjectSection; label: TranslationKey; href: (identifier: string) => string }[] = [
  { section: 'items', label: 'projects.sections.items', href: (identifier) => paths.project(identifier) },
  { section: 'wiki', label: 'projects.sections.wiki', href: (identifier) => paths.wiki(identifier) },
  { section: 'templates', label: 'projects.sections.templates', href: (identifier) => paths.templates(identifier) },
];

interface ProjectSectionsProps {
  project: Pick<Project, 'identifier' | 'name'>;
  current: ProjectSection;
  /** The screen shows something below the part (a wiki page, a template), not the part itself. */
  below?: boolean;
}

export function ProjectSections({ project, current, below = false }: ProjectSectionsProps) {
  return (
    <nav aria-label={t('projects.sections.label', { name: project.name })} className="mt-2">
      <ul className="flex gap-1 overflow-x-auto border-b border-line">
        {PROJECT_SECTIONS.map((part) => (
          <li key={part.section}>
            <Link
              href={part.href(project.identifier)}
              aria-current={part.section === current ? (below ? 'true' : 'page') : undefined}
              className="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-2.5 text-ui font-medium whitespace-nowrap text-muted transition-colors duration-120 [--focus-offset:-2px] hover:text-ink [&[aria-current]]:border-accent [&[aria-current]]:text-ink md:h-9"
            >
              {t(part.label)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
