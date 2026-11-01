/*
 * An item as a list row (moodboard list), ported from the clickdummy: type icon, key and title, then the display
 * fields as chips. Children are indented by `depth` and hang on a line from their parent. The title is a link over the
 * whole row; the chips are pickers above it (state, priority, labels, dates, assignee), the rest of the fields is shown
 * as it is. Days of the timestamps (created, changed) are counted in the organisation's time zone.
 *
 * Keyboard: the chips are no tab stops (`tabIndex -1`). A row of a list with its own keyboard cursor gets `cursor`
 * (true for the one row that is the list's tab stop, false for the others): then the row is the element of the
 * cursor (`data-nav-target`), names itself and whether it is selected, Enter on it opens the item's page (`onOpen`),
 * and the title link leaves the tab order. Without `cursor` the title link is the tab stop. A plain click on the title
 * opens the preview (`onPeek`); without it the title leads to the page. The list moves its cursor with j/k
 * (`useSelection`) and changes a field with the item shortcuts (s, a, p, l, d …).
 * On phones the chips only show their values (24 px are too small to aim at): a tap opens the item, whose fields are
 * 44 px tall.
 */

import { Archive } from 'lucide-react';
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import { AssigneePicker } from '@/components/fields/AssigneePicker';
import { DateField } from '@/components/fields/DateField';
import { formatPropertyValue, formatShortDay } from '@/components/fields/format';
import { useItemWorkflow, useUserMap } from '@/components/fields/itemData';
import { LabelsPicker } from '@/components/fields/LabelsPicker';
import { PriorityPicker } from '@/components/fields/PriorityPicker';
import { readsEmpty } from '@/components/fields/property/parse';
import { StatePicker } from '@/components/fields/StatePicker';
import { TypeGlyph } from '@/components/fields/TypeGlyph';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { cachedZone } from '@/domain/tz';
import { useOrganization } from '@/hooks/organization';
import { useProperties } from '@/hooks/properties';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t, type TranslationKey } from '@/lib/i18n';
import type { ListedItem } from '@/types';
import { BlockedHint } from './BlockedHint';
import { ItemKey } from './ItemKey';
import { ItemLink, linkFocusRing } from './ItemLink';

/** The display fields a row knows (besides `title` and `property:<key>`), with their names for the display menu. */
export const ROW_FIELDS = {
  key: 'items.fields.row.key',
  state: 'items.fields.row.state',
  assignee: 'items.fields.row.assignee',
  priority: 'items.fields.row.priority',
  labels: 'items.fields.row.labels',
  start_date: 'items.fields.row.start_date',
  due_date: 'items.fields.row.due_date',
  project: 'items.fields.row.project',
  created_at: 'items.fields.row.created_at',
  updated_at: 'items.fields.row.updated_at',
} as const satisfies Record<string, TranslationKey>;

export type RowField = keyof typeof ROW_FIELDS;

const chip = 'inline-flex h-6 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-chip border border-line bg-surface px-1.5 text-sm text-ink';

/** The name of a row or card of a list with a keyboard cursor: key, title, and whether it is selected. */
export const listItemName = (item: Pick<ListedItem, 'key' | 'title'>, selected: boolean, ...more: string[]): string =>
  [t('items.row.name', { key: item.key, title: item.title }), ...more, ...(selected ? [t('items.row.selected')] : [])].join(', ');

type ItemRowBaseProps = Omit<ComponentProps<'div'>, 'children'> & {
  item: ListedItem;
  /** 0 for an item at the top, 1 for its children, and so on. */
  depth: number;
  /** The display fields in their order (`Display.fields`): key, state, assignee, priority, labels, start_date, due_date, project, created_at, updated_at, property:<key>. */
  fields: readonly string[];
  /** Enter on the row of a list with a cursor: the item's page. */
  onOpen: (itemId: string) => void;
  /** A plain click on the title: the preview. Without it the title leads to the item's page. */
  onPeek?: (itemId: string) => void;
  /** Before the type icon, after the indentation: e.g. the list's selection checkbox. */
  lead?: ReactNode;
  /** Part of the selection: the highlighter's wash. */
  selected?: boolean;
  /** The row belongs to a list with a keyboard cursor: true for its tab stop, false for the other rows (see above). */
  cursor?: boolean;
};

export function ItemRowBase({ item, depth, fields, onOpen, onPeek, lead, selected = false, cursor, className, style, onKeyDown, ...rest }: ItemRowBaseProps) {
  const type = useWorkItemTypes().data?.items.find((entry) => entry.id === item.type_id);
  const properties = useProperties().data?.items;
  const { project } = useItemWorkflow(item);
  const users = useUserMap();
  const zone = cachedZone(useOrganization().data.timezone);
  const progress = item.children_progress;
  const navTarget = cursor !== undefined;

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
            <span className="text-muted">{t(field === 'created_at' ? 'items.row.created' : 'items.row.updated')}</span>
            {formatShortDay(zone.date(new Date(item[field])))}
          </span>
        );
      default: {
        if (!field.startsWith('property:')) return null;
        const property = properties?.find((entry) => entry.key === field.slice('property:'.length));
        const value = property ? item.values[property.key] : undefined;
        // a yes/no field that is off reads like no value (A89)
        if (!property || readsEmpty(property, value)) return null;
        const option = property.field_type === 'dropdown' && !property.settings.multiple ? property.options.find((entry) => entry.id === value) : undefined;
        return (
          <span key={field} className={cx(chip, 'bg-sunken')}>
            {option ? <ToneDot tone={option.color} /> : <span className="shrink-0 text-muted">{property.label}</span>}
            {option && <span className="sr-only">{property.label}: </span>}
            <span className="truncate">{formatPropertyValue(property, value, (id) => users.get(id)?.name ?? t('items.fields.property.unknown_person'))}</span>
          </span>
        );
      }
    }
  }

  const chips = fields.filter((field) => field !== 'key' && field !== 'title' && field !== 'assignee').map(chipFor);

  return (
    <div
      {...(navTarget && { 'data-nav-target': '', role: 'group', 'aria-label': listItemName(item, selected), tabIndex: cursor ? 0 : -1 })}
      {...rest}
      data-selected={selected || undefined}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        // Enter on the row opens the page; a click on the title opens the preview
        if (!event.defaultPrevented && navTarget && event.key === 'Enter' && event.target === event.currentTarget && !event.nativeEvent.isComposing) {
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
      <ItemLink item={item} onOpen={onPeek} tabIndex={navTarget ? -1 : undefined} className="flex min-w-0 flex-1 items-center gap-2 text-ui text-ink after:rounded-ctl">
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
            <span className="sr-only">{t('items.row.children_done')} </span>
            {progress.done}/{progress.total}
          </span>
        )}
        {item.archived_at && (
          <span className={cx(chip, 'text-muted')}>
            <Archive className="size-3.5" aria-hidden="true" />
            {t('items.row.archived')}
          </span>
        )}
        {chips}
        {fields.includes('assignee') && <AssigneePicker item={item} tabIndex={-1} look="avatar" />}
      </span>
    </div>
  );
}
