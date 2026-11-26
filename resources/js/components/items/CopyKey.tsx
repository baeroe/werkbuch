import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { toast } from '@/components/ui/toast';
import { copyOrSelect } from '@/features/settings/tokens/CopyButton';
import { t } from '@/lib/i18n';
import { isMac } from '@/lib/platform';

/** An item key (or its tab) that copies the key when it is clicked; the toast says it, the focus stays on the button. */
export function CopyKey({ itemKey, className, tabIndex, children }: { itemKey: string; className?: string; tabIndex?: number; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={tabIndex}
      aria-label={t('items.key.copy', { key: itemKey })}
      title={t('items.key.copy', { key: itemKey })}
      className={cx('cursor-copy rounded-chip focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-(--focus-ring) focus-visible:[box-shadow:var(--focus-halo)]', className)}
      onClick={(event) => {
        // on a card the tab would otherwise open the item
        event.stopPropagation();
        void copyOrSelect(itemKey, event.currentTarget).then((result) =>
          toast(result === 'copied' ? { title: t('common.copied'), tone: 'success' } : {
                title: t('settings.tokens.copy_failed'),
                description: t('settings.tokens.copy_failed_description', { keys: isMac() ? '⌘C' : `${t('kbd.text.ctrl')}+C` }),
                tone: 'error',
              }),
        );
      }}
    >
      {children}
    </button>
  );
}
