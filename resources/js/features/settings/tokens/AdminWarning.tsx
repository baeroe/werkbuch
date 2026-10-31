/*
 * The warning that comes up wherever tokens of the default bot do (spec 4.2): the default bot is an org admin, so that
 * automations may act in every project, and a token always acts with the rights of its account.
 */

import { ShieldAlert } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { t } from '@/lib/i18n';

export function AdminWarning({ title }: { title: string }) {
  return (
    <Banner tone="danger" icon={ShieldAlert} title={title} role="note">
      {t('settings.tokens.admin_warning.text')}
    </Banner>
  );
}
