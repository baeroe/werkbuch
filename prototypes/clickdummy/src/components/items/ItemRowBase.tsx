/*
 * An item as a list row (moodboard list): type icon, key and title, then the display fields as chips. Children are
 * indented by `depth` and hang on a line from their parent. The title is a link over the whole row; the chips are
 * pickers above it (state, priority, labels, dates, assignee), the rest of the fields is shown as it is.
 *
 * Keyboard: the chips are no tab stops (`tabIndex -1`), a row has one. The list moves its cursor with j/k and changes a
 * field with the item shortcuts (s, a, p, l, d …) of `useItemCommands`. A list with its own cursor passes `tabIndex`
 * to the row: then the row is the tab stop, Enter opens the item, and the link leaves the tab order.
 * On phones the chips only show their values (24 px are too small to aim at): a tap opens the item, whose fields are
 * 44 px tall.
 */

import { Archive } from 'lucide-react';
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import { AssigneePicker } from '@/components/fields/AssigneePicker';
import { DateField } from '@/components/fields/DateField';
import { formatPropertyValue } from '@/components/fields/format';
import { useItemWorkflow, useUserMap } from '@/components/fields/itemData';
import { LabelsPicker } from '@/components/fields/LabelsPicker';
import { PriorityPicker } from '@/components/fields/PriorityPicker';
import { isEmptyValue } from '@/components/fields/PropertyField';
import { StatePicker } from '@/components/fields/StatePicker';
import { TypeGlyph } from '@/components/fields/TypePicker';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { useOrganization } from '@/hooks/organization';
import { useProperties } from '@/hooks/properties';
import { useWorkItemMeta } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import type { WorkItem } from '@/types';
import { BlockedHint } from './BlockedHint';
import { ItemKey } from './ItemKey';
import { ItemLink, linkFocusRing } from './ItemLink';

/** The display fields a row knows, with their names (the display menu of a list can offer them). */
export const ROW_FIELDS: Record<string, string> = {
  key: 'Key',
  state: 'Status',
  assignee: 'Assignee',
  priority: 'Priorität',
  labels: 'Labels',
  start_date: 'Start-Date',
  due_date: 'Due-Date',
  project: 'Projekt',
  created_at: 'Erstellt',
  updated_at: 'Geändert',
};

const chip = 'inline-flex h-6 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-chip border border-line bg-surface px-1.5 text-sm text-ink';

const timestampFormats = new Map<string, Intl.DateTimeFormat>();
/** The day of a timestamp in the organisation's time zone, 28.10. */
function stampDay(iso: string, timeZone: string): string {
  let format = timestampFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone });
    timestampFormats.set(timeZone, format);
  }
  return format.format(new Date(iso));
}

type ItemRowBaseProps = Omit<ComponentProps<'div'>, 'children'> & {
  item: WorkItem;
  /** 0 for an item at the top, 1 for its children, and so on. */
  depth: number;
  /** The display fields in their order (`Display.fields`): key, state, assignee, priority, labels, start_date, due_date, project, created_at, updated_at, property:<key>. */
  fields: string[];
  onOpen: (itemId: string) => void;
  /** Before the type icon, after the indentation: e.g. the list's selection checkbox. */
  lead?: ReactNode;
  /** Part of the selection: the highlighter's wash. */
  selected?: boolean;
};

export function ItemRowBase({ item, depth, fields, onOpen, lead, selected = false, className, style, onKeyDown, tabIndex, ...rest }: ItemRowBaseProps) {
  const type = useWorkItemTypes().data?.items.find((entry) => entry.id === item.type_id);
  const meta = useWorkItemMeta().data;
  const properties = useProperties().data?.items;
  const { project } = useItemWorkflow(item);
  const users = useUserMap();
  const timeZone = useOrganization().data?.timezone ?? 'Europe/Berlin';
  const progress = meta?.progress[item.id];
  const rowFocus = tabIndex !== undefined;

  function chipFor(field: string): ReactNode {
    const picker = { item, tabIndex: -1 } as const;
    switch (field) {
      case 'state':
        return <StatePicker key={field} {...picker} look="chip" />;
      case 'priority':
        return <PriorityPicker key={field} {...picker} look="chip" />;
      case 'labels':
        return item.label_ids.length > 0 ? <LabelsPicker key={field} {...picker} look="chip" /> : null;
      case 'start_date':
      case 'due_date':
        return item[field] ? <DateField key={field} {...picker} field={field} look="chip" /> : null;
      case 'project':
        return project ? (
          <span key={field} className={chip}>
            <ProjectBadge project={project} className="size-4" />
            <span translate="no" className="font-semibold tabular-nums">
              {project.identifier}
            </span>
          </span>
        ) : null;
      case 'created_at':
      case 'updated_at':
        return (
          <span key={field} className={cx(chip, 'tabular-nums')}>
            <span className="text-muted">{field === 'created_at' ? 'erstellt' : 'geändert'}</span>
            {stampDay(item[field], timeZone)}
          </span>
        );
      default: {
        if (!field.startsWith('property:')) return null;
        const property = properties?.find((entry) => entry.key === field.slice('property:'.length));
        const value = property ? item.values[property.key] : undefined;
        if (!property || isEmptyValue(value)) return null;
        const option = property.field_type === 'dropdown' && !property.settings.multiple ? property.options.find((entry) => entry.id === value) : undefined;
        return (
          <span key={field} className={cx(chip, 'bg-sunken')}>
            {option ? <ToneDot tone={option.color} /> : <span className="shrink-0 text-muted">{property.label}</span>}
            {option && <span className="sr-only">{property.label}: </span>}
            <span className="truncate">{formatPropertyValue(property, value, (id) => users.get(id)?.name ?? 'Unbekannt')}</span>
          </span>
        );
      }
    }
  }

  const chips = fields.filter((field) => field !== 'key' && field !== 'title' && field !== 'assignee').map(chipFor);

  return (
    <div
      {...rest}
      tabIndex={tabIndex}
      data-selected={selected || undefined}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && rowFocus && event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault();
          onOpen(item.id);
        }
      }}
      // children hang on a line from their parent
      style={{ marginLeft: depth > 0 ? `${depth * 1.75}rem` : undefined, ...style }}
      className={cx(
        'relative flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-ctl px-2 py-1 transition-colors duration-120 sm:min-h-9',
        selected ? 'bg-wash' : 'hover:bg-hover',
        depth > 0 && 'before:absolute before:top-0 before:-left-3.5 before:h-1/2 before:w-3 before:rounded-bl-chip before:border-b before:border-l before:border-line-strong',
        linkFocusRing,
        className,
      )}
    >
      {lead && <span className="relative z-10 inline-flex shrink-0">{lead}</span>}
      {type && <TypeGlyph type={type} />}
      {/* the key is part of the link, so the link is named "WEB-42 Task: Startseite …" */}
      <ItemLink item={item} onOpen={onOpen} tabIndex={rowFocus ? -1 : undefined} className="flex min-w-0 flex-1 items-center gap-2 text-ui text-ink after:rounded-ctl">
        {fields.includes('key') ? <ItemKey value={item.key} className="w-14 shrink-0 text-sm text-muted" /> : <span className="sr-only">{item.key} </span>}
        {type && <span className="sr-only">{` ${type.name}: `}</span>}
        <span className={cx('min-w-0 truncate', type?.is_epic && 'font-medium', item.archived_at && 'text-muted')}>{item.title}</span>
      </ItemLink>
      <span className="relative z-10 flex basis-full flex-wrap items-center gap-1.5 pl-8 max-md:pointer-events-none sm:basis-auto sm:pl-0">
        <BlockedHint item={item} />
        {progress && (
          <span className={cx(chip, 'gap-1.5 tabular-nums')}>
            <span aria-hidden="true" className="relative h-1.5 w-12 overflow-hidden rounded-full bg-line">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, backgroundColor: `var(--${type?.tone ?? 'slate'})` }}
              />
            </span>
            <span className="sr-only">Kind-Items fertig: </span>
            {progress.done}/{progress.total}
          </span>
        )}
        {item.archived_at && (
          <span className={cx(chip, 'text-muted')}>
            <Archive className="size-3.5" aria-hidden="true" />
            Archiviert
          </span>
        )}
        {chips}
        {fields.includes('assignee') && <AssigneePicker item={item} tabIndex={-1} look="avatar" />}
      </span>
    </div>
  );
}
