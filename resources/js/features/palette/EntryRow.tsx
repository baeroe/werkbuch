/*
 * The inside of one palette row: a command with its icon and shortcut (a chevron when it opens a sub-list), or an
 * option of a sub-list with its hint. The rows of search results come with the search (Phase 6).
 */

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Kbd } from '@/components/ui/Kbd';
import type { CommandOption } from '@/lib/commands';
import { Highlight } from './Highlight';
import type { PaletteEntry } from './model';

/** 16 px slot at the start of a row, so all labels line up. */
function Lead({ children }: { children?: ReactNode }) {
  return (
    <span aria-hidden="true" className="inline-flex size-4 shrink-0 text-muted [&>svg]:size-4">
      {children}
    </span>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="min-w-0 flex-1 truncate">{children}</span>;
}

export function EntryRow({ entry, terms }: { entry: PaletteEntry; terms: string[] }) {
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

/**
 * One option of a command's sub-list. Its hint can be a name people chose: it takes at most a good third of the row and
 * truncates, so the option's own label always stays readable.
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
