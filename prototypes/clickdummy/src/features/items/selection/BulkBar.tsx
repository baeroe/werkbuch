/*
 * The bar of a selection (spec 5.3, Review Focus 3): changes status, assignee, priority or labels of all selected items
 * in one go (`useBulkUpdateWorkItems`, optimistic), or archives them with 5 s to take it back.
 *
 * Every item follows its own rules on the server: what they refuse (a transition its workflow forbids, an open item to
 * archive, a project the person may only read) stays as it was, the rest changes, and the toast names each refused
 * item with the reason. A move to Completed or Canceled asks for the resolution first, as everywhere.
 * It stands in the screen's sticky toolbar below the filter bar while something is selected (the toasts at the bottom
 * would cover a bar down there right when they report on it).
 */

import { Archive, CircleDashed, LoaderCircle, Signal, Tag, UserRound, UserRoundCheck, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { reasonText } from '@/api/client';
import type { BulkPatch } from '@/api/workItems';
import { personOption } from '@/components/fields/AssigneePicker';
import { askResolution } from '@/components/fields/ItemDialogs';
import { archivedReason } from '@/components/fields/itemData';
import { labelOption } from '@/components/fields/LabelsPicker';
import type { PickerOption } from '@/components/fields/Picker';
import { PRIORITY_OPTIONS } from '@/components/fields/PriorityPicker';
import { stateOption } from '@/components/fields/StatePicker';
import { UnassignedAvatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { toast } from '@/components/ui/toast';
import { isClosedCategory, statesInOrder } from '@/domain/workflow';
import { useLabels } from '@/hooks/catalog';
import { useMembers, useProjects } from '@/hooks/projects';
import { useCurrentUser, useUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { useBulkUpdateWorkItems } from '@/hooks/workItems';
import { usePermissions } from '@/lib/permissions';
import type { BulkResult, Priority, State, User, WorkItem } from '@/types';

const count = new Intl.NumberFormat('de-DE');
const COLLATOR = new Intl.Collator('de-DE');

/** "WEB-47" or "3 Items". */
export const subjectOf = (items: readonly WorkItem[]) => (items.length === 1 ? items[0].key : `${count.format(items.length)} Items`);

/**
 * The toast after a bulk change: what changed, and each refused item with its reason. `done` is the participle of the
 * title when some were refused: "2 von 3 Items geändert" or "… archiviert".
 */
export function bulkToast(items: readonly WorkItem[], result: BulkResult, what: string, done = 'geändert'): void {
  const keyOf = (id: string) => items.find((item) => item.id === id)?.key ?? id;
  if (result.rejected.length === 0) {
    toast({ title: `${subjectOf(items)}: ${what}`, tone: 'success' });
    return;
  }
  toast({
    title: result.updated.length === 0 ? `Keines der ${count.format(items.length)} Items ${done}` : `${count.format(result.updated.length)} von ${count.format(items.length)} Items ${done}`,
    description: result.rejected.map((entry) => `${keyOf(entry.id)}: ${reasonText(entry.reason)}`).join(' '),
    tone: result.updated.length === 0 ? 'error' : 'neutral',
    duration: 8000,
  });
}

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
 * An action with a menu. A change on its way shows on the bar (`aria-busy` and a spinner), not by disabling the button:
 * the focus comes back to it when the menu closes, and a disabled button would drop it.
 */
function ActionMenu({ label, icon, disabledReason, children }: { label: string; icon: typeof Archive; disabledReason: string | null; children: ReactNode }) {
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

type BulkBarProps = {
  /** The selected items, in the order of the list. */
  items: WorkItem[];
  /** How many items the list has (for "alle auswählen"). */
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  /** Archives the items with undo; the screen takes them out of the list meanwhile. */
  onArchive: (items: WorkItem[]) => void;
};

export function BulkBar({ items, total, onSelectAll, onClear, onArchive }: BulkBarProps) {
  const bulk = useBulkUpdateWorkItems();
  const projects = useProjects({ include_archived: true }).data?.items ?? [];
  const workflows = useWorkflows().data?.items ?? [];
  const users = useUsers().data?.items ?? [];
  const members = useMembers().data?.items ?? [];
  const labels = useLabels().data?.items ?? [];
  const me = useCurrentUser();
  const { reason } = usePermissions();

  const subject = subjectOf(items);
  const workflowOf = (item: WorkItem) => workflows.find((workflow) => workflow.id === projects.find((project) => project.id === item.project_id)?.workflow_id);
  const stateOf = (item: WorkItem) => workflowOf(item)?.states.find((state) => state.id === item.state_id);

  // when none of them can be changed, say why up front; otherwise the server names the ones it refuses
  const reasons = items.map((item) => (item.archived_at !== null ? archivedReason(item.key) : reason('item.edit', item.project_id)));
  const editDenied = reasons.every(Boolean) ? reasons[0] : null;
  const closed = items.filter((item) => {
    const state = stateOf(item);
    return item.archived_at === null && state !== undefined && isClosedCategory(state.category);
  });
  const archiveDenied = editDenied ?? (closed.length === 0 ? 'Nur geschlossene Items lassen sich archivieren. Setze sie zuerst auf einen Status wie Done.' : null);

  /**
   * Waits for the answer outside the life of this bar: Esc during the request clears the selection and takes the bar
   * away, and the refused items must still be named.
   */
  async function change(what: string, patch: BulkPatch) {
    const targets = items;
    try {
      const result = await bulk.mutateAsync({ ids: targets.map((item) => item.id), patch });
      bulkToast(targets, result, what);
    } catch {
      // the mutation says what failed itself, with "Erneut versuchen"
    }
  }

  function moveTo(state: State) {
    if (!isClosedCategory(state.category)) {
      void change(`Status ${state.name}`, { state_id: state.id });
      return;
    }
    const [first] = items;
    const from = items.length === 1 ? stateOf(first) : undefined;
    askResolution({
      subject,
      target: state,
      from: from ? { category: from.category, resolutionId: first.resolution_id } : undefined,
      onConfirm: (resolutionId) => void change(`Status ${state.name}`, { state_id: state.id, resolution_id: resolutionId }),
    });
  }

  // the states of the workflows involved; with several, the workflow's name tells them apart
  const involved = [...new Map(items.flatMap((item) => workflowOf(item) ?? []).map((workflow) => [workflow.id, workflow])).values()];

  // people who are in every project of the selection
  const projectIds = [...new Set(items.map((item) => item.project_id))];
  const common = users
    .filter((user) => user.disabled_at === null && projectIds.every((projectId) => members.some((member) => member.project_id === projectId && member.user_id === user.id)))
    .sort((a, b) => (a.type === b.type ? COLLATOR.compare(a.name, b.name) : a.type === 'person' ? -1 : 1));
  const assign = (user: User | null) => void change(user ? `zugewiesen an ${user.name}` : 'nicht mehr zugewiesen', { assignee_id: user?.id ?? null });

  const all = items.length === total;

  return (
    <div
      aria-busy={bulk.isPending || undefined}
      className="flex min-h-[2.375rem] flex-wrap items-center gap-2 rounded-ctl border border-line bg-surface px-1.5 py-0.5 shadow-elev-1"
    >
      <span className="flex shrink-0 items-center gap-2 pl-0.5">
        {/* the name stays, the state (all, some) says the rest */}
        <Checkbox aria-label="Alle Items auswählen" checked={all} indeterminate={!all} onCheckedChange={() => (all ? onClear() : onSelectAll())} />
        <span className="text-ui font-semibold text-ink tabular-nums">
          {count.format(items.length)}
          <span className="font-normal text-muted"> von {count.format(total)} ausgewählt</span>
        </span>
        {bulk.isPending && <LoaderCircle className="size-3.5 animate-spin text-muted" aria-hidden="true" />}
      </span>
      <span className="hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
      <ActionMenu label="Status" icon={CircleDashed} disabledReason={editDenied}>
        {involved.map((workflow, index) => (
          <MenuGroup key={workflow.id}>
            {index > 0 && <MenuSeparator />}
            {involved.length > 1 && <MenuGroupLabel>{workflow.name}</MenuGroupLabel>}
            {statesInOrder(workflow).map((state) => (
              <MenuItem key={state.id} onClick={() => moveTo(state)}>
                <Choice option={stateOption(state)} />
              </MenuItem>
            ))}
          </MenuGroup>
        ))}
      </ActionMenu>
      <ActionMenu label="Assignee" icon={UserRound} disabledReason={editDenied}>
        {me && common.some((user) => user.id === me.id) && (
          <MenuItem icon={UserRoundCheck} onClick={() => assign(me)}>
            Mir zuweisen
          </MenuItem>
        )}
        <MenuItem onClick={() => assign(null)}>
          <Choice option={{ value: '', label: 'Nicht zugewiesen', icon: <UnassignedAvatar /> }} />
        </MenuItem>
        {common.length > 0 && <MenuSeparator />}
        {common.map((user) => (
          <MenuItem key={user.id} onClick={() => assign(user)}>
            <Choice option={personOption(user)} />
          </MenuItem>
        ))}
      </ActionMenu>
      <ActionMenu label="Priorität" icon={Signal} disabledReason={editDenied}>
        {PRIORITY_OPTIONS.map((option) => (
          <MenuItem key={option.value} onClick={() => void change(`Priorität ${option.label}`, { priority: option.value as Priority })}>
            <Choice option={option} />
          </MenuItem>
        ))}
      </ActionMenu>
      <ActionMenu label="Labels" icon={Tag} disabledReason={editDenied}>
        {[...labels]
          .sort((a, b) => COLLATOR.compare(a.name, b.name))
          .map((label) => {
            // a label all of them have comes off, any other goes on
            const everywhere = items.every((item) => item.label_ids.includes(label.id));
            return (
              <MenuItem
                key={label.id}
                onClick={() =>
                  void change(`Label ${label.name} ${everywhere ? 'entfernt' : 'gesetzt'}`, everywhere ? { remove_label_ids: [label.id] } : { add_label_ids: [label.id] })
                }
              >
                <Choice option={{ ...labelOption(label), hint: everywhere ? 'bei allen, entfernen' : undefined }} />
              </MenuItem>
            );
          })}
      </ActionMenu>
      <Button variant="secondary" size="sm" icon={Archive} disabledReason={archiveDenied} onClick={() => onArchive(items)}>
        Archivieren
      </Button>
      <IconButton icon={X} label="Auswahl aufheben" shortcut="escape" onClick={onClear} className="ml-auto" />
    </div>
  );
}
