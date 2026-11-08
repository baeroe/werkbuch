/*
 * The wiki pages that reference the item (a `#` reference to it in their text, spec 4.15, A456): each in a line with
 * its emoji (or the page glyph) and title as a link into the wiki of its project, and the wiki's identifier beside it.
 * The section is there only when the reader sees at least one page: nothing while they load or when there are none.
 * A list that cannot be read at all says so with "Erneut versuchen"; a reload that fails keeps the list. The pages
 * come from `GET /work-items/{item}/pages` (only those the reader sees); live updates of the wiki (`page.*`) make the
 * list load again (`qk.pages.all`), and a page the server no longer lists is gone from it.
 */

import { Link } from '@inertiajs/react';
import { useEffect, useRef, type FocusEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { linkFocusRing } from '@/components/items/ItemLink';
import { focusWhenLost } from '@/lib/focusOrigin';
import { PageGlyph } from '@/features/wiki/PageGlyph';
import { useItemPages } from '@/hooks/pages';
import { useProjects } from '@/hooks/projects';
import { intlLocale, t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { WorkItemDetail } from '@/types';
import { Section } from './shared';

export function WikiPages({ detail }: { detail: WorkItemDetail }) {
  const { item } = detail;
  const pages = useItemPages(item.id, item.project_id);
  const projects = useProjects({ include_archived: true }).data?.items;
  const list = pages.data?.items ?? [];
  const root = useRef<HTMLUListElement>(null);
  /** The row that has the focus: when a live update takes it away, the focus goes on to its neighbour (M9). */
  const focused = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const was = focused.current;
    if (!was || pages.data?.items.some((page) => page.id === was.id)) return;
    focused.current = null;
    focusWhenLost(() => {
      const links = root.current?.querySelectorAll<HTMLElement>('a') ?? [];
      return links[Math.min(was.index, links.length - 1)] ?? document.querySelector<HTMLElement>('[data-item-detail] [data-item-title]');
    });
  }, [pages.data]);
  const track = (event: FocusEvent<HTMLUListElement>) => {
    const row = (event.target as Element).closest('li');
    const id = row?.getAttribute('data-page-id');
    if (row && id) focused.current = { id, index: [...row.parentElement!.children].indexOf(row) };
  };

  if (!pages.data) {
    if (!pages.isError) return null;
    return (
      <Section title={t('items.detail.pages.title')}>
        <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-ui text-muted">
          {t('items.detail.pages.failed')}
          <Button variant="ghost" size="sm" onClick={() => void pages.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </Section>
    );
  }
  if (list.length === 0) return null;

  return (
    <Section title={t('items.detail.pages.title')} aside={<span className="tabular-nums">{new Intl.NumberFormat(intlLocale()).format(list.length)}</span>}>
      <ul ref={root} aria-label={t('items.detail.pages.list')} onFocus={track} className="-mx-2 mt-2 flex flex-col">
        {list.map((page) => {
          // until the projects are there the project's id leads to the same wiki (the server answers with the identifier)
          const known = projects?.find((project) => project.id === page.project_id)?.identifier;
          const place = known ? t('wiki.place', { identifier: known }) : null;
          return (
            <li key={page.id} data-page-id={page.id}>
              <div className={cx('relative flex min-h-11 min-w-0 items-center gap-2 rounded-ctl px-2 transition-colors duration-120 hover:bg-hover md:min-h-8', linkFocusRing)}>
                <span className="flex w-4 shrink-0 justify-center text-sm">
                  <PageGlyph emoji={page.emoji} className="" />
                </span>
                <Link
                  data-item-link=""
                  href={paths.wiki(known ?? page.project_id, page.id)}
                  aria-label={place ? `${page.title}, ${place}` : undefined}
                  className="min-w-0 flex-1 truncate text-ui text-ink outline-none after:absolute after:inset-0"
                >
                  {page.title}
                </Link>
                {place && <span aria-hidden="true" className="shrink-0 text-sm text-muted">{place}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
