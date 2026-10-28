/*
 * The hint of a blocked item (spec 4.9): another item that is still open blocks it. Nothing is enforced, the hint only
 * says it, in three sizes:
 * - `chip` (rows): "Blockiert"
 * - `card`: "Blockiert von OPS-12"
 * - `banner` (detail, right under the title): every blocker with status, key and title, each a link to it
 * A blocker the reader may not see stays hidden: "verborgenes Item", without key or title.
 */

import { Ban } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import { Banner } from '@/components/ui/Banner';
import { cx } from '@/components/ui/cx';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { isClosedCategory } from '@/domain/workflow';
import { useRelationTypes } from '@/hooks/catalog';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItem, useWorkItemMeta } from '@/hooks/workItems';
import type { RelationEntry, State, WorkItem } from '@/types';
import { ItemKey } from './ItemKey';

type Blocker = { item: WorkItem; state: State | undefined } | { item: null; state: undefined };

/** The open items that block this one, from its detail; undefined until the detail has loaded. */
function useBlockers(itemId: string, enabled: boolean): Blocker[] | undefined {
  const detail = useWorkItem(itemId, { enabled });
  const relationTypes = useRelationTypes().data?.items;
  const workflows = useWorkflows().data?.items;
  if (!detail.data || !relationTypes || !workflows) return undefined;
  const blocks = relationTypes.find((type) => type.built_in === 'blocks');
  const stateOf = (stateId: string) => workflows.flatMap((workflow) => workflow.states).find((state) => state.id === stateId);
  return detail.data.relations
    .filter((entry: RelationEntry) => entry.direction === 'inward' && entry.relation.type_id === blocks?.id)
    .flatMap((entry): Blocker[] => {
      // a hidden blocker counts: the server already decided that the item is blocked
      if (!entry.other) return [{ item: null, state: undefined }];
      const state = stateOf(entry.other.state_id);
      return state && isClosedCategory(state.category) ? [] : [{ item: entry.other, state }];
    });
}

const keysOf = (blockers: Blocker[]) => blockers.map((blocker) => blocker.item?.key ?? 'einem verborgenen Item').join(', ');

type BlockedHintProps = {
  item: WorkItem;
  variant?: 'chip' | 'card' | 'banner';
  /** Banner: opens a blocker (the page or the preview); without it the links lead to the item's page (router link). */
  onOpen?: (itemId: string) => void;
  className?: string;
};

export function BlockedHint({ item, variant = 'chip', onOpen, className }: BlockedHintProps) {
  const blocked = useWorkItemMeta().data?.blocked.includes(item.id) ?? false;
  const blockers = useBlockers(item.id, blocked && variant !== 'chip');
  if (!blocked) return null;

  if (variant === 'chip') {
    return (
      <span className={cx('inline-flex h-6 shrink-0 items-center gap-1 rounded-chip bg-danger-soft px-1.5 text-sm font-medium text-danger', className)}>
        <Ban className="size-3.5" aria-hidden="true" />
        Blockiert
      </span>
    );
  }

  if (variant === 'card') {
    return (
      <p className={cx('inline-flex max-w-full items-center gap-1 rounded-chip bg-danger-soft px-1.5 py-0.5 text-sm font-medium text-danger', className)}>
        <Ban className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{blockers && blockers.length > 0 ? `Blockiert von ${keysOf(blockers)}` : 'Blockiert'}</span>
      </p>
    );
  }

  const shown = blockers ?? [];
  const title = shown.length === 0 ? 'Blockiert' : `Blockiert, solange ${keysOf(shown)} offen ${shown.length === 1 ? 'ist' : 'sind'}`;
  const open = (event: MouseEvent, id: string) => {
    if (!onOpen || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(id);
  };
  return (
    <Banner tone="danger" icon={Ban} title={title} className={className}>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {shown.map((blocker, index) =>
            blocker.item ? (
              <li key={blocker.item.id}>
                <Link
                  to={`/items/${blocker.item.key}`}
                  onClick={(event) => open(event, blocker.item!.id)}
                  className="-mx-1 flex min-h-11 min-w-0 items-center gap-1.5 rounded-chip px-1 text-ink underline-offset-2 hover:underline md:min-h-6"
                >
                  {blocker.state && <StatusIcon icon={blocker.state.icon} category={blocker.state.category} label={`Status ${blocker.state.name}`} className="size-3.5" />}
                  <ItemKey value={blocker.item.key} className="shrink-0" />
                  <span className="min-w-0 truncate">{blocker.item.title}</span>
                </Link>
              </li>
            ) : (
              <li key={`hidden-${index}`} className="text-muted">
                verborgenes Item
              </li>
            ),
          )}
        </ul>
      )}
    </Banner>
  );
}
