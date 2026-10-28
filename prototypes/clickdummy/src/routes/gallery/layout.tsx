/*
 * The frame of the component gallery (/_components): sections, specimens and the state rows beside them.
 */

import { useId, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';

export function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-20">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line-strong pb-3">
        <h2 id={id} className="scroll-mt-6 font-display text-2xl font-bold tracking-title text-ink">
          {title}
        </h2>
        <p className="text-ui text-muted">{intro}</p>
      </div>
      <div className="mt-8 grid gap-x-12 gap-y-14 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

export function Specimen({ title, note, wide = false, children }: { title: string; note?: ReactNode; wide?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx('min-w-0', wide && 'md:col-span-2 xl:col-span-3')}>
      <h3 id={id} className="font-display text-lg font-bold tracking-title text-ink">
        {title}
      </h3>
      {note && <p className="mt-1 max-w-[65ch] text-sm text-pretty text-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** States side by side: the state in pencil on the left, the specimen on the right. */
export function States({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-y-3">{children}</dl>;
}

export function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="mt-2 text-sm text-muted first:mt-0 sm:mt-0">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2.5">{children}</dd>
    </>
  );
}

