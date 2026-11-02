/*
 * The rows of the timeline: per project its name, then its epics with dates, one row each. Virtualized in the
 * timeline's own scroll box (R34): only the rows in view (and a few around them) are rendered, the row of the cursor
 * always, so it keeps the focus while it scrolls away. Every row has its height (a project 32 px, an epic 44 px), so
 * nothing needs measuring. A project stays a region of its own (its name and its rows), drawn wherever any of it is
 * in view.
 */

import { defaultRangeExtractor, useVirtualizer, type Range, type VirtualItem } from '@tanstack/react-virtual';
import { useCallback, useId, useMemo, type ReactNode, type RefObject } from 'react';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import type { ListedItem, Project } from '@/types';
import { AXIS_HEIGHT } from './TimelineAxis';

/** The height of a project's name, and of an epic's row. */
export const PROJECT_ROW = 32;
export const EPIC_ROW = 44;

export interface TimelineSection {
  key: string;
  label: string;
  project?: Project;
  /** Its epics with dates, in the order of the server. */
  items: ListedItem[];
}

type Entry = { kind: 'project'; section: TimelineSection } | { kind: 'epic'; item: ListedItem; section: TimelineSection };

/** The rows of the sections and the virtualizer over them, in the scroll box below the axis. */
export function useTimelineRows(sections: readonly TimelineSection[], scroller: RefObject<HTMLElement | null>, cursorId: string | null) {
  const entries = useMemo<Entry[]>(
    () => sections.flatMap((section) => [{ kind: 'project' as const, section }, ...section.items.map((item) => ({ kind: 'epic' as const, item, section }))]),
    [sections],
  );
  // the cursor row stays rendered while it scrolls away, so it keeps the focus
  const cursorIndex = entries.findIndex((entry) => entry.kind === 'epic' && entry.item.id === cursorId);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      return cursorIndex < 0 || indexes.includes(cursorIndex) ? indexes : [...indexes, cursorIndex].sort((a, b) => a - b);
    },
    [cursorIndex],
  );
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => (entries[index]!.kind === 'project' ? PROJECT_ROW : EPIC_ROW),
    getItemKey: (index) => {
      const entry = entries[index]!;
      return entry.kind === 'project' ? `project:${entry.section.key}` : entry.item.id;
    },
    overscan: 8,
    rangeExtractor,
    // the rows begin below the axis, which sticks to the top of the box and covers what passes beneath it
    scrollMargin: AXIS_HEIGHT,
    scrollPaddingStart: AXIS_HEIGHT,
    useFlushSync: false,
  });
  /** Where an epic's row stands among the rows, or -1. */
  const indexOf = useCallback((id: string) => entries.findIndex((entry) => entry.kind === 'epic' && entry.item.id === id), [entries]);
  return { entries, virtualizer, indexOf };
}

interface TimelineRowsProps {
  entries: Entry[];
  virtual: VirtualItem[];
  totalSize: number;
  renderRow(item: ListedItem): ReactNode;
}

/** The rows in view, each project as a region with its name. */
export function TimelineRows({ entries, virtual, totalSize, renderRow }: TimelineRowsProps) {
  const sections = new Map<TimelineSection, { top: number; rows: { item: ListedItem; top: number }[] }>();
  // where a project's rows begin: its name is the first of them
  const tops = new Map<TimelineSection, number>();
  let offset = 0;
  for (const entry of entries) {
    if (entry.kind === 'project') tops.set(entry.section, offset);
    offset += entry.kind === 'project' ? PROJECT_ROW : EPIC_ROW;
  }
  for (const row of virtual) {
    const entry = entries[row.index]!;
    const top = tops.get(entry.section)!;
    const shown = sections.get(entry.section) ?? { top, rows: [] };
    // a row stands in the list below its project's name
    if (entry.kind === 'epic') shown.rows.push({ item: entry.item, top: row.start - AXIS_HEIGHT - top - PROJECT_ROW });
    sections.set(entry.section, shown);
  }
  return (
    <div className="relative" style={{ height: totalSize }}>
      {[...sections].map(([section, shown]) => (
        <ProjectRows key={section.key} section={section} top={shown.top}>
          {shown.rows.map(({ item, top }) => (
            <li key={item.id} className="absolute inset-x-0" style={{ top }}>
              {renderRow(item)}
            </li>
          ))}
        </ProjectRows>
      ))}
    </div>
  );
}

/** One project's epics under its name. */
function ProjectRows({ section, top, children }: { section: TimelineSection; top: number; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="absolute inset-x-0" style={{ top, height: PROJECT_ROW + section.items.length * EPIC_ROW }}>
      <div className="flex h-8 w-full items-center border-t border-line">
        <h3 id={headingId} className="sticky left-0 z-10 flex h-full w-(--label-w) shrink-0 items-center gap-2 bg-paper px-4 text-sm font-semibold whitespace-nowrap text-muted">
          {section.project && <ProjectBadge project={section.project} />}
          <span className="min-w-0 truncate">{section.label}</span>
        </h3>
      </div>
      <ul className="relative">{children}</ul>
    </section>
  );
}
