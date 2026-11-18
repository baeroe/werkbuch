/*
 * "Wiki öffnen …", "Vorlagen öffnen …" (WEBU-3) and "Projekteinstellungen öffnen …" (WEBU-12) in the palette: each
 * opens the list of the projects the person sees, archived ones included (their wiki, templates and settings stay
 * readable; the settings are where an archived project is restored), and leads to the part of the chosen one. The names
 * of the projects are keywords of the options only, never of the commands: as keywords of a command at the root, a
 * search for "WEB" would put the command before the hits and take their Enter. Hidden until the projects are loaded;
 * the sidebar reaches only the starred projects, this every one.
 */

import { router } from '@inertiajs/react';
import { BookOpen, LayoutTemplate, Settings, type LucideIcon } from 'lucide-react';
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

const SETTINGS: Part = {
  id: 'projects.open_settings',
  label: 'commands.project_settings.label',
  keywords: 'commands.project_settings.keywords',
  icon: Settings,
  href: (identifier) => paths.projectSettings(identifier),
};

export function useProjectPartCommands(): void {
  const projects = useProjects({ include_archived: true });
  const collator = new Intl.Collator(intlLocale(), { sensitivity: 'base' });
  const list: Project[] = [...(projects.data?.items ?? [])].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
  const shown = list.map((project) => `${project.id}:${project.identifier}:${project.name}:${project.archived_at ?? ''}`).join(' ');

  usePartCommand(WIKI, list, shown);
  usePartCommand(TEMPLATES, list, shown);
  usePartCommand(SETTINGS, list, shown);
}

/** One of the commands over the sorted projects; `shown` changes whenever what it offers changes. */
function usePartCommand(part: Part, list: Project[], shown: string): void {
  useCommand(
    {
      id: part.id,
      label: t(part.label),
      group: t(NAVIGATION),
      icon: <part.icon />,
      keywords: [t(part.keywords)],
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
