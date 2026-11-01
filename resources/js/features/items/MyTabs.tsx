/*
 * The three lists of "Meine Items" share the entry of the sidebar; tabs switch between them (spec 5.2): assigned to me,
 * created by me, watched by me. Plain links: each list is a page of its own with its own address.
 */

import { Link } from '@inertiajs/react';
import type { ItemsPreset } from '@/domain/viewState';
import { t, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';

type MyPreset = Extract<ItemsPreset, 'my' | 'created' | 'subscribed'>;

export const MY_TABS: readonly { preset: MyPreset; href: string; label: TranslationKey; title: TranslationKey }[] = [
  { preset: 'my', href: paths.myItems(), label: 'items.my.tab.assigned', title: 'items.my.title' },
  { preset: 'created', href: paths.created(), label: 'items.my.tab.created', title: 'items.created.title' },
  { preset: 'subscribed', href: paths.subscribed(), label: 'items.my.tab.subscribed', title: 'items.subscribed.title' },
];

export const isMyPreset = (preset: ItemsPreset): preset is MyPreset => MY_TABS.some((tab) => tab.preset === preset);

export function MyTabs({ preset }: { preset: MyPreset }) {
  return (
    <nav aria-label={t('items.my.title')} className="mt-2">
      <ul className="flex gap-1 overflow-x-auto border-b border-line">
        {MY_TABS.map((tab) => (
          <li key={tab.preset}>
            <Link
              href={tab.href}
              aria-current={tab.preset === preset ? 'page' : undefined}
              className="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-2.5 text-ui font-medium whitespace-nowrap text-muted transition-colors duration-120 [--focus-offset:-2px] hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink md:h-9"
            >
              {t(tab.label)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
