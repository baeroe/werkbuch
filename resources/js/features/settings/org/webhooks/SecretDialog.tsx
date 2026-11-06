/*
 * The one moment the secret of a webhook is shown (spec 6.3): after creating the webhook and after making a new secret.
 * The server keeps it encrypted and never answers it again. The text lives in the state of the screen that got it from
 * the call (the call's answer is reset at once, 13c) and here until the dialog has faded out; then it is gone. It cannot
 * be closed by accident: a click outside does nothing and Escape asks first; "Fertig" closes it.
 */

import { useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { CopyField } from '@/components/ui/CopyField';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { t } from '@/lib/i18n';

export interface Secret {
  /** What happened: the webhook is created, or it has a new secret. */
  kind: 'created' | 'rotated';
  /** The name of the webhook. */
  name: string;
  value: string;
}

export function SecretDialog({ secret, onClose }: { secret: Secret | null; onClose: () => void }) {
  // while the dialog fades out the screen has already let go of the secret; the last one is shown until it is gone,
  // and then let go of here as well
  const [shown, setShown] = useState<Secret | null>(null);
  if (secret && secret !== shown) setShown(secret);
  const current = secret ?? shown;
  if (!current) return null;

  return (
    <Dialog
      open={secret !== null}
      onOpenChange={(open) => !open && onClose()}
      onOpenChangeComplete={(open) => !open && setShown(null)}
      confirmClose={{ title: t('settings.webhooks.secret.close_title'), description: t('settings.webhooks.secret.once') }}
      title={current.kind === 'created' ? t('settings.webhooks.secret.created_title') : t('settings.webhooks.secret.rotated_title')}
      description={t('settings.webhooks.secret.description', { name: current.name })}
      footer={<DialogClose render={<Button variant="primary">{t('settings.webhooks.secret.done')}</Button>} />}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <Banner tone="info" role="status" title={t('settings.webhooks.secret.heading')}>
          {t('settings.webhooks.secret.once')}
        </Banner>
        <CopyField label={t('settings.webhooks.secret.label')} name="webhook_secret" value={current.value} buttonLabel={t('settings.webhooks.secret.copy')} />
      </div>
    </Dialog>
  );
}
