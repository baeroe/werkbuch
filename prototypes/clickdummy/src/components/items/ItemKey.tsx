import { cx } from '@/components/ui/cx';

/** An item's key (`WEB-47`) in tabular figures; never translated. */
export function ItemKey({ value, className }: { value: string; className?: string }) {
  return (
    <span translate="no" className={cx('font-semibold whitespace-nowrap tabular-nums', className)}>
      {value}
    </span>
  );
}
