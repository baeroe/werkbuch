/*
 * "Wiki öffnen …" and "Vorlagen öffnen …" in the palette (WEBU-3): each opens the list of the projects the person sees,
 * archived ones included (their wiki and templates stay readable), and leads to the part of the chosen one. The names
 * and identifiers of the projects are keywords of the command, so "wiki web" finds it from the root of the palette.
 * Hidden until the projects are loaded; the sidebar reaches only the starred projects, this every one.
 */

import { router } from '@inertiajs/react';
import { BookOpen, LayoutTemplate, type LucideIcon } from 'lucide-react';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { useProjects } from '@/hooks/projects';
import { SHELL_COMMAND_GROUPS, useCommand } from '@/lib/commands';
import { intlLocale, t, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Project } from '@/types';

const [, NAVIGATION] = SHELL_COMMAND_GROUPS;

interface Part {
  id: string;
  label: TranslationKey;
  keywords: TranslationKey;
  icon: LucideIcon;
  href: (identifier: string) => string;
}

const WIKI: Part = { id: 'projects.open_wiki', label: 'commands.project_wiki.label', keywords: 'commands.project_wiki.keywords', icon: BookOpen, href: (identifier) => paths.wiki(identifier) };
const TEMPLATES: Part = {
  id: 'projects.open_templates',
  label: 'commands.project_templates.label',
  keywords: 'commands.project_templates.keywords',
  icon: LayoutTemplate,
  href: (identifier) => paths.templates(identifier),
};

export function useProjectPartCommands(): void {
  const projects = useProjects({ include_archived: true });
  const collator = new Intl.Collator(intlLocale(), { sensitivity: 'base' });
  const list: Project[] = [...(projects.data?.items ?? [])].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
  const shown = list.map((project) => `${project.id}:${project.identifier}:${project.name}:${project.archived_at ?? ''}`).join(' ');

  usePartCommand(WIKI, list, shown);
  usePartCommand(TEMPLATES, list, shown);
}

/** One of the two commands over the sorted projects; `shown` changes whenever what it offers changes. */
function usePartCommand(part: Part, list: Project[], shown: string): void {
  useCommand(
    {
      id: part.id,
      label: t(part.label),
      group: t(NAVIGATION),
      icon: <part.icon />,
      keywords: [t(part.keywords), ...list.flatMap((project) => [project.name, project.identifier])],
      when: () => list.length > 0,
      run: () => {},
      subpage: () => ({
        placeholder: t('commands.project_part.placeholder'),
        emptyText: t('commands.project_part.empty'),
        options: list.map((project) => ({
          id: project.id,
          label: project.name,
          // the badge is 20 px; the margin fits it into the 16 px slot of an option's icon
          icon: <ProjectBadge project={project} className="-m-0.5" />,
          hint: project.archived_at !== null ? t('commands.project_part.archived', { identifier: project.identifier }) : project.identifier,
          keywords: [project.identifier],
          run: () => router.visit(part.href(project.identifier)),
        })),
      }),
    },
    // registered anew when the projects change, so an open palette shows them
    [shown],
  );
}
