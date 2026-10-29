/*
 * The inside of one palette row, per kind: a command with its shortcut, the jump to a key, an item with its type,
 * key and status, a wiki page, a project, a person or bot, a view (moodboard: grouped hits with kbd hints).
 */

import { ArrowRight, ChevronRight, FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { cx } from '@/components/ui/cx';
import { Kbd } from '@/components/ui/Kbd';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { typeIcon } from '@/components/ui/TypeTab';
import { ViewIcon } from '@/components/ui/ViewIcon';
import type { CommandOption } from '@/lib/commands';
import type { Project, State, WorkItemType } from '@/types';
import { Highlight } from './Highlight';
import type { PaletteEntry } from './model';

/** What the rows look up: types and states of items, projects of pages. */
export interface RowLookups {
  typeOf: (id: string) => WorkItemType | undefined;
  stateOf: (id: string) => State | undefined;
  projectOf: (id: string) => Project | undefined;
}

/** 16 px slot at the start of a row, so all labels line up. */
function Lead({ children, tone }: { children?: ReactNode; tone?: string }) {
  return (
    <span data-tone={tone} aria-hidden="true" className={cx('inline-flex size-4 shrink-0 [&>svg]:size-4', tone ? 'text-[var(--tab-ink)]' : 'text-muted')}>
      {children}
    </span>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="min-w-0 flex-1 truncate">{children}</span>;
}

function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('ml-auto inline-flex shrink-0 items-center gap-1 pl-2 text-sm text-muted', className)}>{children}</span>;
}

export function EntryRow({ entry, terms, lookups }: { entry: PaletteEntry; terms: string[]; lookups: RowLookups }) {
  switch (entry.kind) {
    case 'command': {
      const { command } = entry;
      return (
        <>
          <Lead>{command.icon}</Lead>
          <Label>
            <Highlight text={command.label} terms={terms} />
          </Label>
          {command.keys && <Kbd keys={command.keys} />}
          {command.subpage && <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />}
        </>
      );
    }
    case 'jump':
      return (
        <>
          <Lead>
            <ArrowRight />
          </Lead>
          <Label>
            <span translate="no" className="font-semibold tabular-nums">
              {entry.key}
            </span>{' '}
            öffnen
          </Label>
        </>
      );
    case 'item': {
      const { item } = entry;
      const type = lookups.typeOf(item.type_id);
      const state = lookups.stateOf(item.state_id);
      const Icon = typeIcon(type?.icon ?? 'square-check');
      return (
        <>
          <Lead tone={type?.tone ?? 'sky'}>
            <Icon />
          </Lead>
          <span translate="no" className="min-w-12 shrink-0 text-sm font-semibold text-muted tabular-nums">
            {item.key}
          </span>
          <Label>
            <Highlight text={item.title} terms={terms} />
          </Label>
          {state && (
            <Meta className="max-sm:hidden">
              <StatusIcon icon={state.icon} category={state.category} label={state.name} className="size-3.5" aria-hidden="true" />
              {state.name}
            </Meta>
          )}
        </>
      );
    }
    case 'page': {
      const project = lookups.projectOf(entry.page.project_id);
      return (
        <>
          <Lead>
            <FileText />
          </Lead>
          <Label>
            <Highlight text={entry.page.title} terms={terms} />
          </Label>
          {project && (
            <Meta>
              Wiki <span translate="no">{project.identifier}</span>
            </Meta>
          )}
        </>
      );
    }
    case 'project':
      return (
        <>
          <ProjectBadge project={entry.project} className="-my-0.5" />
          <Label>
            <Highlight text={entry.project.name} terms={terms} />
          </Label>
          <Meta>
            <span translate="no">{entry.project.identifier}</span>
          </Meta>
        </>
      );
    case 'person':
      return (
        <>
          <Avatar user={entry.user} size="sm" decorative className="-my-0.5" />
          <Label>
            <Highlight text={entry.user.name} terms={terms} />
          </Label>
          <Meta>{entry.user.type === 'bot' ? 'Bot' : `@${entry.user.handle}`}</Meta>
        </>
      );
    case 'view':
      return (
        <>
          <Lead>
            <ViewIcon icon={entry.view.icon} />
          </Lead>
          <Label>
            <Highlight text={entry.view.name} terms={terms} />
          </Label>
        </>
      );
  }
}

/**
 * One option of a command's sub-list. Its hint can be a name people chose (a template's project, up to 120 characters):
 * it takes at most a good third of the row and truncates, so the option's own label always stays readable.
 */
export function OptionRow({ option, terms }: { option: CommandOption; terms: string[] }) {
  return (
    <>
      <Lead>{option.icon}</Lead>
      <Label>
        <Highlight text={option.label} terms={terms} />
      </Label>
      {option.hint && <span className="ml-auto max-w-[40%] min-w-0 truncate pl-2 text-sm text-muted">{option.hint}</span>}
    </>
  );
}
