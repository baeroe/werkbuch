/*
 * The events of a webhook as a tree (spec 6.3): six groups, each with its events. Ticking a group takes all its
 * events and is stored as `work_item.*`, so events added to the group later reach the webhook too; ticking single
 * events stores their names. A group with some of its events ticked shows the dash of a mixed checkbox and starts open.
 */

import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { EVENT_GROUPS, type EventGroup } from './catalog';
import { eventsOf, selectionOf } from './events';
import { counted } from './format';
import { FieldGroup } from './parts';

type EventTreeProps = {
  /** The stored event names, e.g. `['work_item.*', 'bot.assigned']`. */
  value: string[];
  onChange: (events: string[]) => void;
  error?: string;
};

function GroupRow({ group, ticked, open, onToggleOpen, onGroup, onEvent }: {
  group: EventGroup;
  ticked: string[];
  open: boolean;
  onToggleOpen: () => void;
  onGroup: (on: boolean) => void;
  onEvent: (event: string, on: boolean) => void;
}) {
  const listId = useId();
  const all = ticked.length === group.events.length;
  return (
    <li>
      <div className="flex items-center gap-2 pr-1 pl-3">
        <Checkbox
          className="min-w-0 flex-1"
          label={
            <span className="min-w-0 truncate">
              <span className="font-medium">{group.label}</span>{' '}
              <span className="text-sm text-muted" translate="no">
                {group.group}.*
              </span>
            </span>
          }
          checked={all}
          indeterminate={ticked.length > 0 && !all}
          onCheckedChange={onGroup}
        />
        <span className="shrink-0 text-sm text-muted tabular-nums">
          {ticked.length} von {group.events.length}
        </span>
        <IconButton
          icon={ChevronDown}
          label={`${group.label}: Ereignisse ${open ? 'ausblenden' : 'einzeln wählen'}`}
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggleOpen}
          className={cx('[&>svg]:transition-transform [&>svg]:duration-160', open && '[&>svg]:rotate-180')}
        />
      </div>
      {open && (
        <ul id={listId} className="grid gap-x-4 pr-3 pb-2 pl-10 sm:grid-cols-2">
          {group.events.map((entry) => (
            <li key={entry.event}>
              <Checkbox
                label={
                  <span className="min-w-0">
                    <span className="block truncate">{entry.label}</span>
                    <span className="block truncate text-xs text-muted" translate="no">
                      {group.group}.{entry.event}
                    </span>
                  </span>
                }
                checked={ticked.includes(entry.event)}
                onCheckedChange={(on) => onEvent(entry.event, on)}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function EventTree({ value, onChange, error }: EventTreeProps) {
  const selection = selectionOf(value);
  const total = Object.values(selection).reduce((sum, ticked) => sum + ticked.length, 0);
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(EVENT_GROUPS.filter((group) => (selection[group.group]?.length ?? 0) > 0 && (selection[group.group]?.length ?? 0) < group.events.length).map((group) => group.group)),
  );

  const toggleOpen = (name: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  return (
    <FieldGroup legend="Ereignisse" hint={total === 0 ? 'Wähle, wovon der Webhook erfährt. Eine ganze Gruppe schließt künftige Ereignisse ein.' : `${counted(total, 'Ereignis', 'Ereignisse')} gewählt.`} error={error}>
      <ul className="divide-y divide-line rounded-ctl border border-line bg-surface">
        {EVENT_GROUPS.map((group) => (
          <GroupRow
            key={group.group}
            group={group}
            ticked={selection[group.group] ?? []}
            open={open.has(group.group)}
            onToggleOpen={() => toggleOpen(group.group)}
            onGroup={(on) => onChange(eventsOf({ ...selection, [group.group]: on ? group.events.map((entry) => entry.event) : [] }))}
            onEvent={(event, on) => {
              const current = selection[group.group] ?? [];
              onChange(eventsOf({ ...selection, [group.group]: on ? [...current, event] : current.filter((entry) => entry !== event) }));
            }}
          />
        ))}
      </ul>
    </FieldGroup>
  );
}
