/*
 * The events of a webhook as a tree (spec 6.3): one row per group with the events below it. Ticking a group takes all
 * its events and is stored as `work_item.*`, so events added to the group later reach the webhook too; ticking single
 * events stores their names. A group with some of its events ticked shows the dash of a mixed checkbox and starts open.
 * With `invalid` the first box is marked, so a refusal of the server lands the focus on the tree.
 */

import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { t, tn } from '@/lib/i18n';
import { FieldGroup } from '../../frame/parts';
import { EVENT_GROUPS, eventLabel, groupLabel, type EventGroup } from './catalog';
import { eventsOf, selectionOf } from './events';

type EventTreeProps = {
  /** The stored event names, e.g. `['work_item.*', 'bot.assigned']`. */
  value: readonly string[];
  onChange: (events: string[]) => void;
  error?: string;
};

type GroupRowProps = {
  group: EventGroup;
  ticked: readonly string[];
  open: boolean;
  invalid: boolean;
  onToggleOpen: () => void;
  onGroup: (on: boolean) => void;
  onEvent: (event: string, on: boolean) => void;
};

function GroupRow({ group, ticked, open, invalid, onToggleOpen, onGroup, onEvent }: GroupRowProps) {
  const listId = useId();
  const all = ticked.length === group.events.length;
  const label = groupLabel(group.group);
  return (
    <li>
      <div className="flex items-center gap-2 pr-1 pl-3">
        <Checkbox
          className="min-w-0 flex-1"
          aria-invalid={invalid ? true : undefined}
          label={
            <span className="min-w-0 truncate">
              <span className="font-medium">{label}</span>{' '}
              <span className="text-sm text-muted" translate="no">
                {group.group}.*
              </span>
            </span>
          }
          checked={all}
          indeterminate={ticked.length > 0 && !all}
          onCheckedChange={onGroup}
        />
        <span className="shrink-0 text-sm text-muted tabular-nums">{t('settings.webhooks.tree.of', { ticked: ticked.length, total: group.events.length })}</span>
        <IconButton
          icon={ChevronDown}
          label={open ? t('settings.webhooks.tree.hide', { group: label }) : t('settings.webhooks.tree.show', { group: label })}
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggleOpen}
          className={cx('[&>svg]:transition-transform [&>svg]:duration-160', open && '[&>svg]:rotate-180')}
        />
      </div>
      {open && (
        <ul id={listId} className="grid gap-x-4 pr-3 pb-2 pl-10 sm:grid-cols-2">
          {group.events.map((event) => (
            <li key={event}>
              <Checkbox
                label={
                  <span className="min-w-0">
                    <span className="block truncate">{eventLabel(`${group.group}.${event}`)}</span>
                    <span className="block truncate text-xs text-muted" translate="no">
                      {group.group}.{event}
                    </span>
                  </span>
                }
                checked={ticked.includes(event)}
                onCheckedChange={(on) => onEvent(event, on)}
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
    <FieldGroup legend={t('settings.webhooks.events')} hint={total === 0 ? t('settings.webhooks.tree.hint') : tn('settings.webhooks.tree.chosen', total)} error={error}>
      <ul data-event-tree className="divide-y divide-line rounded-ctl border border-line bg-surface">
        {EVENT_GROUPS.map((group, index) => (
          <GroupRow
            key={group.group}
            group={group}
            ticked={selection[group.group] ?? []}
            open={open.has(group.group)}
            invalid={Boolean(error) && index === 0}
            onToggleOpen={() => toggleOpen(group.group)}
            onGroup={(on) => onChange(eventsOf({ ...selection, [group.group]: on ? group.events : [] }))}
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
