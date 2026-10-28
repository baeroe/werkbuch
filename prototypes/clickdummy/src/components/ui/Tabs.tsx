import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ComponentProps } from 'react';
import { cx } from './cx';

/*
 * Tabs for sections of one page (e.g. settings):
 *   <Tabs defaultValue="general"><TabsList aria-label="…"><Tab value="general">…</Tab></TabsList><TabsPanel value="general">…</TabsPanel></Tabs>
 */
export const Tabs = BaseTabs.Root;

export function TabsList({ className, ...rest }: Omit<ComponentProps<typeof BaseTabs.List>, 'className'> & { className?: string }) {
  return <BaseTabs.List className={cx('flex gap-1 overflow-x-auto border-b border-line', className)} {...rest} />;
}

/** The active tab is underlined in ink blue; switching is not animated (no layout motion). */
export function Tab({ className, ...rest }: Omit<ComponentProps<typeof BaseTabs.Tab>, 'className'> & { className?: string }) {
  return (
    <BaseTabs.Tab
      className={cx(
        '-mb-px inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-2.5 text-ui font-medium whitespace-nowrap text-muted transition-colors duration-120 hover:text-ink md:h-9',
        // the list scrolls sideways and clips: the focus ring sits inside the tab
        '[--focus-offset:-2px]',
        'data-active:border-accent data-active:text-ink data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
}

export function TabsPanel({ className, ...rest }: Omit<ComponentProps<typeof BaseTabs.Panel>, 'className'> & { className?: string }) {
  return <BaseTabs.Panel className={cx('pt-4', className)} {...rest} />;
}
