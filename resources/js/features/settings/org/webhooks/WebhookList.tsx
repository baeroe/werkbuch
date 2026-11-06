/*
 * The list of webhooks (spec 6.3): one card each, "Webhook anlegen" above them and in the empty state. Removing takes
 * the card away at once with five seconds to undo (⌘Z); the dialog of a new webhook hands its secret to the screen,
 * which shows it once and then lets go of it.
 */

import { Plus, Webhook as WebhookIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useProjects } from '@/hooks/projects';
import { useAllUsers } from '@/hooks/users';
import { useDeleteWebhook, useWebhooks } from '@/hooks/webhooks';
import { t } from '@/lib/i18n';
import type { Webhook } from '@/types';
import { Loaded, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { useDialogRound } from '../../frame/useDialogRound';
import { useRemoval } from '../../frame/useRemoval';
import { SecretDialog, type Secret } from './SecretDialog';
import { WebhookCard } from './WebhookCard';
import { WebhookDialog } from './WebhookDialog';

export function WebhookList() {
  const webhooks = useWebhooks();
  const projects = useProjects({ include_archived: true });
  const bots = useAllUsers({ type: 'bot' });
  const remove = useDeleteWebhook();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const dialog = useDialogRound<Webhook>();
  const [secret, setSecret] = useState<Secret | null>(null);
  const projectList = projects.data?.items ?? [];
  const botList = bots.data?.items ?? [];

  const create = (
    <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
      {t('settings.webhooks.create')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.org.section.webhooks')} description={t('settings.webhooks.description')} actions={create} />
      <Loaded queries={[webhooks, projects, bots]} failure={t('settings.webhooks.load_failed')} skeleton={<RowsSkeleton rows={3} label={t('settings.webhooks.loading')} />}>
        {() => {
          const shown = (webhooks.data?.items ?? []).filter((webhook) => !hidden.has(webhook.id));
          if (shown.length === 0) {
            return <EmptyState icon={WebhookIcon} title={t('settings.webhooks.empty.title')} description={t('settings.webhooks.empty.description')} actions={create} />;
          }
          return (
            <ul className="flex flex-col gap-3">
              {shown.map((webhook) => (
                <li key={webhook.id}>
                  <WebhookCard
                    webhook={webhook}
                    projects={projectList}
                    bots={botList}
                    onEdit={() => dialog.show(webhook)}
                    onDelete={() =>
                      removeWithUndo({
                        id: webhook.id,
                        label: t('settings.webhooks.deleted', { name: webhook.name }),
                        failureTitle: t('settings.webhooks.not_deleted', { name: webhook.name }),
                        run: () => remove.mutateAsync(webhook.id),
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
      <WebhookDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} webhook={dialog.target} projects={projectList} bots={botList} onCreated={setSecret} />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}
