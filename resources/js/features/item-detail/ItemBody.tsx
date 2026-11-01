/*
 * The item detail, shared by the preview and the page (spec 5.2).
 * - `ItemDetailProvider` goes around a whole detail (header and body): where it is shown and the actions of its
 *   shortcuts, registered here in detail scope: `e` edits the title, `r` adds a relation. The screens key it by the
 *   item, so nothing of one item's drafts carries over to the next. On the page `e` always acts; in the preview only
 *   while the focus is in its panel or nowhere in particular (`previewKeysAct`), so the screen beside it keeps the key
 *   otherwise. `r` always acts, as in the clickdummy: no screen beside a preview binds it.
 * - `ItemBody`: the title, the archived and blocked notes, the fields, the description, the children, the relations and
 *   the activity (the history; comments come with Phase 7). In the preview one column, as in the moodboard panel; on
 *   the page the fields stand in a column on the right from lg on (they stay in view while the main column scrolls),
 *   below lg they follow the title. The reading order is the same everywhere.
 */

import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { BlockedHint } from '@/components/items/BlockedHint';
import { previewKeysAct } from '@/components/fields/commands/context';
import { t } from '@/lib/i18n';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { WorkItemDetail } from '@/types';
import { Activity } from './activity/Activity';
import { Children } from './Children';
import { Description } from './Description';
import { FieldsPanel } from './FieldsPanel';
import { ArchivedNote } from './header/ArchivedNote';
import { ItemTitle } from './header/ItemTitle';
import { Relations } from './Relations';
import { DetailContext, type DetailActions, type DetailContextValue, type DetailSurface } from './shared';

type ItemDetailProviderProps = {
  surface: DetailSurface;
  /** The preview's panel (`PeekHost`): with the focus inside, the preview's e acts (see `previewKeysAct`). */
  panel?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function ItemDetailProvider({ surface, panel, children }: ItemDetailProviderProps) {
  const actions = useRef<DetailActions>({});
  const context = useMemo<DetailContextValue>(() => ({ surface, actions }), [surface]);
  useShortcut('item.title', () => actions.current.editTitle?.(), {
    instance: surface,
    when: surface === 'peek' ? () => previewKeysAct(panel) : undefined,
  });
  useShortcut('item.relation', () => actions.current.addRelation?.(), { instance: surface });
  return <DetailContext.Provider value={context}>{children}</DetailContext.Provider>;
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
      <Activity detail={detail} />
    </>
  );

  if (surface === 'peek') {
    return (
      <div data-item-detail="" className="flex flex-col px-5 pt-4 pb-6">
        {head}
        <div className="mt-4">
          <FieldsPanel detail={detail} />
        </div>
        {main}
      </div>
    );
  }
  return (
    <div data-item-detail="" className="grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:[grid-template-areas:'head_side'_'main_side']">
      <div className="min-w-0 lg:[grid-area:head]">{head}</div>
      <aside
        aria-label={t('items.detail.fields.label')}
        className="mt-4 min-w-0 lg:sticky lg:top-4 lg:mt-0 lg:self-start lg:border-l lg:border-edge lg:pl-6 lg:[grid-area:side]"
      >
        <FieldsPanel detail={detail} />
      </aside>
      <div className="min-w-0 lg:[grid-area:main]">{main}</div>
    </div>
  );
}
