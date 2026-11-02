/*
 * The bar of a selection (spec 5.3, ported from the clickdummy): changes status, assignee, priority or labels of all
 * selected items in one go (`useBulkChange`, optimistic, in blocks of 100), or archives them with 5 s to take it
 * back.
 *
 * An action stands on the bar only when it does the same allowed thing to every selected item (A198, `selectionVerdict`):
 * while the selection mixes items it may change with archived ones or ones of a project the person only reads, or
 * closed items with open ones to archive, the action is left out, so it never changes a part of them; when it is
 * allowed for none, it stays and says why. What the server still refuses (a transition a workflow forbids) stays as it
 * was, and the toast names each refused item with the reason. A move to Completed or Canceled asks for the resolution
 * first, as everywhere. The status menu offers only the states every workflow of the selection has (A128).
 *
 * It stands in the screen's sticky toolbar below the rest of it while something is selected, so the filter (`/`, `f`)
 * stays within reach; the toasts at the bottom would cover a bar down there right when they report on it.
 */

import { Archive, CircleDashed, LoaderCircle, Signal, Tag, UserRound, UserRoundCheck, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BulkPatch } from '@/api/workItems';
import { personOption } from '@/components/fields/AssigneePicker';
import { closedIn } from '@/components/fields/commands/context';
import { askResolution } from '@/components/fields/ItemDialogs';
import { useCommonPeople } from '@/components/fields/itemData';
import { labelOption } from '@/components/fields/LabelsPicker';
import type { PickerOption } from '@/components/fields/Picker';
import { PRIORITY_OPTIONS } from '@/components/fields/PriorityPicker';
import { stateOption } from '@/components/fields/StatePicker';
import { UnassignedAvatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { isClosedCategory } from '@/domain/workflow';
import { useLabels } from '@/hooks/catalog';
import { useProjects } from '@/hooks/projects';
import { useCurrentUser } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { useBulkChange } from '@/hooks/workItems';
import { intlLocale, t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { ListedItem, Priority, State, User } from '@/types';
import { bulkChange, commonStates, selectionVerdict, subjectOf, type SelectionVerdict } from './bulk';

/** An entry of an action menu: its icon, its name and a muted hint. */
function Choice({ option }: { option: PickerOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {option.icon && (
        <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
          {option.icon}
        </span>
      )}
      <span className="min-w-0 truncate">{option.label}</span>
      {option.hint && <span className="shrink-0 text-sm text-muted">{option.hint}</span>}
    </span>
  );
}

/**
 * An action with a menu: left out for a mixed selection, disabled with the reason when it is allowed for none. A change
 * on its way shows on the bar (`aria-busy` and a spinner), not by disabling the button: the focus comes back to it when
 * the menu closes, and a disabled button would drop it.
 */
function ActionMenu({ label, icon, verdict, children }: { label: string; icon: typeof Archive; verdict: SelectionVerdict; children: ReactNode }) {
  if (verdict?.mixed) return null;
  const disabledReason = verdict?.reason;
  if (disabledReason) {
    return (
      <Button variant="secondary" size="sm" icon={icon} disabledReason={disabledReason}>
        {label}
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="secondary" size="sm" icon={icon}>
            {label}
          </Button>
        }
      />
      <MenuContent className="max-h-[min(24rem,var(--available-height))]">{children}</MenuContent>
    </Menu>
  );
}

export type BulkBarProps = {
  /** The selected items, in the order of the list. */
  items: ListedItem[];
  /** How many items the list has (for "Alle auswählen"). */
  total: number;
  /** Selects every item of the list, also those of pages not loaded yet. */
  onSelectAll: () => void;
  onClear: () => void;
  /** Archives the items with undo, all of them closed; they leave the list meanwhile. */
  onArchive: (items: ListedItem[]) => void;
};

export function BulkBar({ items, total, onSelectAll, onClear, onArchive }: BulkBarProps) {
  const bulk = useBulkChange();
  const projects = useProjects({ include_archived: true }).data?.items ?? [];
  const workflows = useWorkflows().data?.items ?? [];
  const labels = useLabels().data?.items ?? [];
  const people = useCommonPeople([...new Set(items.map((item) => item.project_id))]).people ?? [];
  const me = useCurrentUser();
  const { reason } = usePermissions();
  const count = new Intl.NumberFormat(intlLocale());

  const subject = subjectOf(items);
  const workflowOf = (item: ListedItem) => workflows.find((workflow) => workflow.id === projects.find((project) => project.id === item.project_id)?.workflow_id);
  const stateOf = (item: ListedItem) => workflowOf(item)?.states.find((state) => state.id === item.state_id);

  const rules = { reason, isClosed: (item: ListedItem) => closedIn(projects, workflows, item) };
  const edit = selectionVerdict(items, 'edit', rules);
  const archive = selectionVerdict(items, 'archive', rules);
  const states = commonStates(items, workflowOf);
  const state = edit ?? (states.length === 0 ? { reason: t('items.commands.empty.workflows'), mixed: false } : null);

  const change = (what: string, patch: BulkPatch) => void bulkChange(bulk, items, patch, what);

  function moveTo(state: State) {
    const what = t('items.commands.what.state', { state: state.name });
    if (!isClosedCategory(state.category)) {
      change(what, { state_id: state.id });
      return;
    }
    const [first] = items as [ListedItem];
    const from = items.length === 1 ? stateOf(first) : undefined;
    askResolution({
      subject,
      target: state,
      from: from && { category: from.category, resolutionId: first.resolution_id },
      onConfirm: (resolutionId) => change(what, { state_id: state.id, resolution_id: resolutionId }),
    });
  }

  const assign = (user: User | null) =>
    change(user ? t('items.commands.what.assigned', { name: user.name }) : t('items.commands.what.unassigned'), { assignee_id: user?.id ?? null });
  const collator = new Intl.Collator(intlLocale());
  const all = items.length === total;

  return (
    <div
      role="group"
      aria-label={t('items.bulk.label')}
      aria-busy={bulk.isPending || undefined}
      className="flex min-h-[2.375rem] flex-wrap items-center gap-2 rounded-ctl border border-line bg-surface px-1.5 py-0.5 shadow-elev-1"
    >
      <span className="flex shrink-0 items-center gap-2 pl-0.5">
        {/* the name stays, the state (all, some) says the rest */}
        <Checkbox
          aria-label={t('items.bulk.select_all', { count: count.format(total) })}
          checked={all}
          indeterminate={!all}
          onCheckedChange={() => (all ? onClear() : onSelectAll())}
        />
        <span className="text-ui font-semibold text-ink tabular-nums">
          {count.format(items.length)}
          <span className="font-normal text-muted"> {t('items.bulk.of_total', { total: count.format(total) })}</span>
        </span>
        {bulk.isPending && <LoaderCircle className="size-3.5 animate-spin text-muted" aria-hidden="true" />}
      </span>
      <span className="hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
      <ActionMenu label={t('items.bulk.state')} icon={CircleDashed} verdict={state}>
        {states.map((state) => (
          <MenuItem key={state.id} onClick={() => moveTo(state)}>
            <Choice option={stateOption(state)} />
          </MenuItem>
        ))}
      </ActionMenu>
      <ActionMenu label={t('items.bulk.assignee')} icon={UserRound} verdict={edit}>
        {me && people.some((user) => user.id === me.id) && (
          <MenuItem icon={UserRoundCheck} onClick={() => assign(me)}>
            {t('items.fields.assignee.me')}
          </MenuItem>
        )}
        <MenuItem onClick={() => assign(null)}>
          <Choice option={{ value: '', label: t('items.fields.assignee.nobody'), icon: <UnassignedAvatar /> }} />
        </MenuItem>
        {people.length > 0 && <MenuSeparator />}
        {people.map((user) => (
          <MenuItem key={user.id} onClick={() => assign(user)}>
            <Choice option={personOption(user)} />
          </MenuItem>
        ))}
      </ActionMenu>
      <ActionMenu label={t('items.bulk.priority')} icon={Signal} verdict={edit}>
        {PRIORITY_OPTIONS().map((option) => (
          <MenuItem key={option.value} onClick={() => change(t('items.commands.what.priority', { priority: option.label }), { priority: option.value as Priority })}>
            <Choice option={option} />
          </MenuItem>
        ))}
      </ActionMenu>
      <ActionMenu label={t('items.bulk.labels')} icon={Tag} verdict={edit}>
        {[...labels]
          .sort((a, b) => collator.compare(a.name, b.name))
          .map((label) => {
            // a label all of them have comes off, any other goes on
            const everywhere = items.every((item) => item.label_ids.includes(label.id));
            return (
              <MenuItem
                key={label.id}
                onClick={() =>
                  change(
                    t(everywhere ? 'items.commands.what.label_removed' : 'items.commands.what.label_added', { label: label.name }),
                    everywhere ? { remove_label_ids: [label.id] } : { add_label_ids: [label.id] },
                  )
                }
              >
                <Choice option={{ ...labelOption(label), hint: everywhere ? t('items.bulk.label_everywhere') : undefined }} />
              </MenuItem>
            );
          })}
      </ActionMenu>
      {!archive?.mixed && (
        <Button variant="secondary" size="sm" icon={Archive} disabledReason={archive?.reason} onClick={() => onArchive(items)}>
          {t('items.commands.archive')}
        </Button>
      )}
      <IconButton icon={X} label={t('items.bulk.clear')} shortcut={SHORTCUTS['list.clear'].keys} onClick={onClear} className="ml-auto" />
    </div>
  );
}
