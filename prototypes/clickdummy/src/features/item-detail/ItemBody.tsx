/*
 * The item detail, shared by the preview and the page (spec 5.2).
 * - `ItemDetailProvider` goes around a whole detail (header and body): where it is shown, how other items open there,
 *   the actions of the shortcuts e (title), m (comment) and r (relation), registered here in detail scope, and the
 *   owner of what the editors inside upload (the item). The screens key it by the item, so nothing of one item's
 *   drafts carries over to the next. m and r always act. So does e on the page; in the preview e acts only while the
 *   focus is in its panel, on an item row or nowhere in particular (`previewKeysAct`), so a screen beside it that
 *   binds e itself keeps it: in the inbox, e marks the notification under the cursor read.
 * - `ItemBody`: title, the archived and blocked notes, the fields, description, children, relations, attachments and
 *   the activity with its comment box. In the preview one column, as in the moodboard panel; on the page the fields
 *   stand in a column on the right from lg on (they stay in view while the main column scrolls), below lg they follow
 *   the title. The reading order is the same everywhere.
 */

import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useNavigate } from 'react-router';
import { BlockedHint } from '@/components/items/BlockedHint';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { Attachment, WorkItem, WorkItemDetail } from '@/types';
import { UploadOwnerContext } from '@/features/editor/pasteImages';
import { usePrimeAttachments } from '@/hooks/attachments';
import { Activity } from './Activity';
import { Attachments } from './Attachments';
import { Children } from './Children';
import { Description } from './Description';
import { FieldsPanel } from './FieldsPanel';
import { ArchivedNote, ItemTitle } from './ItemHeader';
import { Relations } from './Relations';
import { DetailContext, type DetailActions, type DetailContextValue, type DetailSurface } from './shared';

/**
 * Whether the preview's e ("Titel bearbeiten") acts now: the focus is in the preview's panel, on an item row or inside
 * one (its title link after a click; the preview beside a list follows the list's cursor), or nowhere in particular.
 * On anything else of the screen beside the preview it yields to that screen's own e, the inbox's "Als gelesen
 * markieren". The inbox binds no m or r, so those reach the preview from its rows.
 */
function previewKeysAct(panel: RefObject<HTMLElement | null> | undefined): boolean {
  const focus = document.activeElement;
  if (!focus || focus === document.body || focus.id === 'main') return true;
  return Boolean(panel?.current?.contains(focus)) || focus.closest('[data-nav-target]') !== null;
}

type DetailShortcutsProps = { surface: DetailSurface; actions: DetailContextValue['actions']; panel?: RefObject<HTMLElement | null> };

function DetailShortcuts({ surface, actions, panel }: DetailShortcutsProps) {
  const common = { scope: 'detail', group: 'Item' } as const;
  const titleWhen = surface === 'peek' ? () => previewKeysAct(panel) : undefined;
  useShortcut({ ...common, id: `detail.title.${surface}`, keys: 'e', label: 'Titel bearbeiten', when: titleWhen, run: () => actions.current.editTitle?.() });
  useShortcut({ ...common, id: `detail.comment.${surface}`, keys: 'm', label: 'Kommentar schreiben', run: () => actions.current.writeComment?.() });
  useShortcut({ ...common, id: `detail.relation.${surface}`, keys: 'r', label: 'Relation hinzufügen', run: () => actions.current.addRelation?.() });
  return null;
}

type ItemDetailProviderProps = {
  detail: WorkItemDetail;
  surface: DetailSurface;
  /** The preview's panel (`PeekHost`): with the focus inside, the preview's e acts (see `previewKeysAct`). */
  panel?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function ItemDetailProvider({ detail, surface, panel, children }: ItemDetailProviderProps) {
  const navigate = useNavigate();
  const actions = useRef<DetailActions>({});
  const itemId = detail.item.id;

  // the images and files of the item's texts come with the detail: they show without asking for each one
  usePrimeAttachments(detail.attachments);

  const context = useMemo<DetailContextValue>(
    () => ({
      surface,
      actions,
      open: (other: Pick<WorkItem, 'id' | 'key'>) => {
        if (surface === 'peek') useUiStore.getState().openPeek(other.id);
        else navigate(`/items/${other.key}`);
      },
    }),
    [surface, navigate],
  );
  const owner = useMemo<Attachment['owner']>(() => ({ type: 'work_item', id: itemId }), [itemId]);

  return (
    <DetailContext.Provider value={context}>
      <UploadOwnerContext.Provider value={owner}>
        <DetailShortcuts surface={surface} actions={actions} panel={panel} />
        {children}
      </UploadOwnerContext.Provider>
    </DetailContext.Provider>
  );
}

export function ItemBody({ detail, surface }: { detail: WorkItemDetail; surface: DetailSurface }) {
  const { item } = detail;
  const head: ReactNode = (
    <>
      <ItemTitle item={item} />
      <ArchivedNote item={item} />
      <BlockedHint item={item} variant="banner" onOpen={surface === 'peek' ? (id) => useUiStore.getState().openPeek(id) : undefined} className="mt-3" />
    </>
  );
  const main: ReactNode = (
    <>
      <Description detail={detail} />
      <Children detail={detail} />
      <Relations detail={detail} />
      <Attachments detail={detail} />
      <Activity detail={detail} />
    </>
  );

  if (surface === 'peek') {
    return (
      <div className="flex flex-col px-5 pt-4 pb-6">
        {head}
        <div className="mt-4">
          <FieldsPanel detail={detail} />
        </div>
        {main}
      </div>
    );
  }
  return (
    <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:[grid-template-areas:'head_side'_'main_side']">
      <div className="min-w-0 lg:[grid-area:head]">{head}</div>
      <aside aria-label="Felder" className="mt-4 min-w-0 lg:sticky lg:top-4 lg:mt-0 lg:self-start lg:border-l lg:border-edge lg:pl-6 lg:[grid-area:side]">
        <FieldsPanel detail={detail} />
      </aside>
      <div className="min-w-0 lg:[grid-area:main]">{main}</div>
    </div>
  );
}
