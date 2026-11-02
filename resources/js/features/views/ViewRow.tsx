/*
 * One row of the views overview, ported from the clickdummy: the icon, the name as the link to the view (it covers the
 * whole row), the projects its filter names and how it is grouped, the layout, who made it, and its actions: the star
 * for the sidebar, "duplicate" for everybody, "edit" and "delete" for the creator and org admins (for everyone else off
 * with the reason). Every action is a tab stop of its own after the link (13c). A project of the filter the reader
 * does not see is "Verborgenes Projekt" (P21): the name of a private project never shows.
 */

import { Link } from '@inertiajs/react';
import { Copy, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
import { useUserMap } from '@/components/fields/itemData';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { ViewIcon } from '@/components/ui/ViewIcon';
import { FavoriteToggle } from '@/features/favorites/FavoriteToggle';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useUiStore } from '@/store/ui';
import type { Project, View } from '@/types';
import { groupingText, LAYOUTS, namedProjects } from './viewForm';

/** The row shows the focus ring of its link, which covers the whole row; its own controls sit above the link. */
const linkFocusRing =
  'has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-solid has-[[data-row-link]:focus-visible]:outline-(--focus-ring) has-[[data-row-link]:focus-visible]:[box-shadow:var(--focus-halo)]';

type ViewRowProps = {
  view: View;
  /** The projects the reader sees (archived ones included), or undefined while they load. */
  projects: Project[] | undefined;
  copying: boolean;
  /** Why the person may not change or delete the view, or null when they may. */
  manageReason: string | null;
  onCopy: (view: View) => void;
  onEdit: (view: View) => void;
  onDelete: (view: View) => void;
};

/** "Website-Relaunch, Verborgenes Projekt": the projects the filter names; nothing while the projects load. */
function scopeText(view: View, projects: Project[] | undefined): string | null {
  const ids = namedProjects(view.filter);
  if (ids.length === 0 || !projects) return null;
  return ids.map((id) => projects.find((project) => project.id === id)?.name ?? t('items.group.hidden.project')).join(', ');
}

export function ViewRow({ view, projects, copying, manageReason, onCopy, onEdit, onDelete }: ViewRowProps) {
  const creator = useUserMap().get(view.created_by);
  const flashing = useUiStore((state) => state.flashIds.includes(view.id));
  const layout = LAYOUTS[view.display.layout];
  const scope = scopeText(view, projects);

  return (
    <li
      className={cx(
        'relative grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-ctl px-2 py-2 transition-colors duration-120',
        'md:grid-cols-[2rem_minmax(0,1fr)_7rem_11.5rem_auto]',
        flashing ? 'bg-wash' : 'hover:bg-hover',
        linkFocusRing,
      )}
    >
      <span
        aria-hidden="true"
        className="row-span-3 inline-flex size-8 items-center justify-center self-start rounded-ctl border border-line bg-surface text-muted shadow-elev-1 md:row-span-1 md:self-center"
      >
        <ViewIcon icon={view.icon} />
      </span>
      <div className="col-start-2 min-w-0">
        <Link
          href={paths.view(view.id)}
          data-row-link=""
          data-focus-ring="none"
          className="block truncate rounded-chip text-ui font-medium text-ink no-underline outline-none after:absolute after:inset-0 after:rounded-ctl"
        >
          {view.name}
        </Link>
        <p className="truncate text-sm text-muted">{scope ? `${scope} · ${groupingText(view.display.group_by)}` : groupingText(view.display.group_by)}</p>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
        <Chip icon={<layout.icon className="size-3.5 text-muted" />} className="justify-self-start md:col-start-3">
          {t(layout.label)}
        </Chip>
        <span className="inline-flex min-w-0 items-center gap-2 text-sm text-muted md:col-start-4">
          {creator && <Avatar user={creator} size="sm" decorative />}
          <span className="min-w-0 truncate">
            <span className="sr-only">{t('views.created_by')} </span>
            {creator?.name ?? t('views.creator_unknown')}
          </span>
        </span>
      </div>
      <div className="relative z-10 col-start-2 flex items-center justify-end gap-0.5 md:col-start-5">
        <FavoriteToggle kind="view" id={view.id} name={view.name} />
        <IconButton
          icon={copying ? LoaderCircle : Copy}
          label={t('views.row.duplicate', { name: view.name })}
          className={cx(copying && '[&>svg]:animate-spin')}
          aria-busy={copying || undefined}
          onClick={() => {
            if (!copying) onCopy(view);
          }}
        />
        <IconButton icon={Pencil} label={t('views.row.edit', { name: view.name })} disabledReason={manageReason} onClick={() => onEdit(view)} />
        <IconButton icon={Trash2} label={t('views.row.delete', { name: view.name })} disabledReason={manageReason} onClick={() => onDelete(view)} />
      </div>
    </li>
  );
}
