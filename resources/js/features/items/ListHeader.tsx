/*
 * The header of an item list: what the list is (a project in the header all its parts share, `ProjectHeader`; a view
 * with its icon under "Views"; or "Meine Items" with its three tabs), the star that puts a project or view into the
 * sidebar, and the switch of the layout. The layouts also switch with 1–4 (`list.layout.*` of the catalog, A7); the focus stays where it is.
 */

import { Link } from '@inertiajs/react';
import { ChartGantt, ChevronRight, List, SquareKanban, Table2 } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ViewIcon } from '@/components/ui/ViewIcon';
import type { ItemsPreset } from '@/domain/viewState';
import { FavoriteToggle } from '@/features/favorites/FavoriteToggle';
import { ProjectHeader } from '@/features/projects/ProjectHeader';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Display, Project, View } from '@/types';
import { LAYOUT_OPTIONS } from './layouts';
import { isMyPreset, MyTabs } from './MyTabs';

const LAYOUT_ICONS = { list: List, board: SquareKanban, table: Table2, timeline: ChartGantt };

const TITLE = 'truncate font-display text-lg font-bold tracking-title text-ink';

interface ListHeaderProps {
  preset: ItemsPreset;
  project?: Project;
  view?: View;
  layout: Display['layout'];
  onLayout(layout: Display['layout']): void;
}

export function ListHeader({ preset, project, view, layout, onLayout }: ListHeaderProps) {
  useShortcut('list.layout.list', () => onLayout('list'));
  useShortcut('list.layout.board', () => onLayout('board'));
  useShortcut('list.layout.table', () => onLayout('table'));
  useShortcut('list.layout.timeline', () => onLayout('timeline'));

  const options = LAYOUT_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.label),
    shortcut: SHORTCUTS[option.shortcut].keys,
    icon: LAYOUT_ICONS[option.value],
  }));

  const layoutSwitch = (
    <>
      <SegmentedControl label={t('items.screen.layout')} size="sm" value={layout} onValueChange={onLayout} options={options} className="max-sm:hidden" />
      <SegmentedControl label={t('items.screen.layout')} size="sm" iconOnly value={layout} onValueChange={onLayout} options={options} className="sm:hidden" />
    </>
  );

  // a project: the header every part of it shares (WEBU-13), the project itself as the h1
  if (project) {
    return (
      <ProjectHeader
        project={project}
        section="items"
        heading="project"
        after={<FavoriteToggle kind="project" id={project.id} name={project.name} />}
        actions={layoutSwitch}
      />
    );
  }

  return (
    <>
      <header className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          {view && (
            <>
              <Link
                href={paths.views()}
                className="inline-flex min-h-11 shrink-0 items-center text-ui font-medium text-muted underline-offset-2 hover:text-ink hover:underline md:min-h-6"
              >
                {t('items.screen.views')}
              </Link>
              <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
              <ViewIcon icon={view.icon} className="text-muted" />
              <h1 className={TITLE}>{view.name}</h1>
              <FavoriteToggle kind="view" id={view.id} name={view.name} />
            </>
          )}
          {isMyPreset(preset) && <h1 className={TITLE}>{t('items.my.title')}</h1>}
        </div>
        <div className="ml-auto">{layoutSwitch}</div>
      </header>
      {isMyPreset(preset) && <MyTabs preset={preset} />}
    </>
  );
}
