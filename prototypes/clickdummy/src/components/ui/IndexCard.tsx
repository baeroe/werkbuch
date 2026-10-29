import type { ComponentProps, ReactNode } from 'react';
import type { TypeTone } from '@/types';
import { cx } from './cx';
import { TypeTab } from './TypeTab';

type IndexCardProps = ComponentProps<'article'> & {
  tone: TypeTone;
  /** Lucide name of the type icon in the tab. */
  icon: string;
  /** Text in the tab, usually the item key. */
  tabLabel: string;
  /** What stands before the tab in its row, e.g. the epic of a child item: it gives way first, the tab never truncates. */
  tabPrefix?: ReactNode;
  /** Stronger edge and elevation 2; the content marks the title with the highlighter (class "hl"). */
  selected?: boolean;
  /** Being dragged: lifted 6 px, 102 %, tilted −2° with the drag elevation; springs back when dropped. */
  lifted?: boolean;
};

/**
 * Index card: white, 1 px line, elevation 1 and a real tab at the top left that covers the card's edge.
 * The space for the tab is part of the card (top margin).
 */
export function IndexCard({ tone, icon, tabLabel, tabPrefix, selected = false, lifted = false, className, children, ...rest }: IndexCardProps) {
  return (
    <article
      data-tone={tone}
      data-selected={selected || undefined}
      data-lifted={lifted || undefined}
      // the lifted card is the picture being dragged: no text selection, no interaction
      inert={lifted || undefined}
      className={cx(
        'relative mt-5 rounded-card border bg-surface p-3 transition-transform duration-420 ease-spring',
        selected ? 'border-line-strong shadow-elev-2' : 'border-line shadow-elev-1',
        // the drag shadow fades in on its own layer instead of animating box-shadow
        'after:pointer-events-none after:absolute after:-inset-px after:rounded-card after:opacity-0 after:shadow-elev-drag after:transition-opacity after:duration-160',
        lifted && '-translate-y-1.5 scale-[1.02] -rotate-2 select-none after:opacity-100',
        className,
      )}
      {...rest}
    >
      <span className="absolute bottom-full left-3 flex max-w-[calc(100%-1.5rem)] items-center">
        {tabPrefix}
        <TypeTab tone={tone} icon={icon} label={tabLabel} size="sm" className="shrink-0" />
      </span>
      {children}
    </article>
  );
}
