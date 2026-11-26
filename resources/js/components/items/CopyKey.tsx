import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { toast } from '@/components/ui/toast';
import { copyOrSelect } from '@/features/settings/tokens/CopyButton';
import { t } from '@/lib/i18n';

/** An item key (or its tab) that copies the key when it is clicked; the toast says it, the focus stays on the button. */
export function CopyKey({ itemKey, className, children }: { itemKey: string; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={t('items.key.copy', { key: itemKey })}
      title={t('items.key.copy', { key: itemKey })}
      className={cx('cursor-copy rounded-chip', className)}
      onClick={(event) => {
        void copyOrSelect(itemKey, event.currentTarget).then((result) =>
          toast(result === 'copied' ? { title: t('common.copied'), tone: 'success' } : { title: t('settings.tokens.copy_failed'), tone: 'error' }),
        );
      }}
    >
      {children}
    </button>
  );
}
