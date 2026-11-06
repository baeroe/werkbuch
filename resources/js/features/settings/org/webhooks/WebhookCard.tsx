/*
 * One webhook in the list (spec 6.3): its name and state (on, switched off by somebody, shut down by the system after 24
 * hours without a success), the address, the scope, the first three events and how many more, the bot it is limited to
 * and the day it was made, with the way to its log of deliveries, to the form and to removing it.
 */

import { Link } from '@inertiajs/react';
import { Pencil, ScrollText, Send, Trash2 } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Project, User, Webhook } from '@/types';
import { formatDateTime, useOrgZone } from '../../frame/format';
import { eventLabel } from './catalog';
import { DisabledNotice, StateBadge, usePingAction } from './webhookParts';

/** "Gesamte Organisation", or the project by identifier and name; a project the list does not know is "Ein Projekt". */
export function scopeOf(webhook: Webhook, projects: Project[]): string {
  if (webhook.project_id === null) return t('settings.webhooks.scope_org');
  const project = projects.find((entry) => entry.id === webhook.project_id);
  return project ? `${project.identifier} ${project.name}` : t('settings.webhooks.scope_unknown');
}

const SHOWN_EVENTS = 3;

type WebhookCardProps = {
  webhook: Webhook;
  projects: Project[];
  bots: User[];
  onEdit: () => void;
  onDelete: () => void;
};

export function WebhookCard({ webhook, projects, bots, onEdit, onDelete }: WebhookCardProps) {
  const zone = useOrgZone();
  const ping = usePingAction(webhook);
  const bot = bots.find((entry) => entry.id === webhook.bot_id);
  const shown = webhook.events.slice(0, SHOWN_EVENTS);
  const titleId = `webhook-${webhook.id}`;

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-elev-1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="font-display text-lg font-bold tracking-title break-words text-ink">
              {webhook.name}
            </h3>
            <StateBadge webhook={webhook} />
          </div>
          <p className="mt-0.5 text-ui break-all text-muted" translate="no">
            {webhook.url}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={paths.webhookDeliveries(webhook.id)} aria-label={t('settings.webhooks.deliveries_of', { name: webhook.name })} className={buttonClass({ variant: 'secondary' })}>
            <ScrollText className="size-4 text-muted" aria-hidden="true" />
            {t('settings.webhooks.deliveries')}
          </Link>
          <Button variant="secondary" icon={Send} pending={ping.pending} aria-label={t('settings.webhooks.ping_named', { name: webhook.name })} onClick={ping.run}>
            {t('settings.webhooks.ping')}
          </Button>
          <Button variant="ghost" icon={Pencil} aria-label={t('settings.webhooks.edit_named', { name: webhook.name })} onClick={onEdit}>
            {t('settings.webhooks.edit')}
          </Button>
          <Button variant="ghost" icon={Trash2} aria-label={t('settings.webhooks.delete_named', { name: webhook.name })} onClick={onDelete}>
            {t('settings.webhooks.delete')}
          </Button>
        </div>
      </div>

      <DisabledNotice webhook={webhook} />

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-muted">{t('settings.webhooks.scope')}</dt>
        <dd className="text-ink">{scopeOf(webhook, projects)}</dd>
        <dt className="text-muted">{t('settings.webhooks.events')}</dt>
        <dd className="min-w-0">
          <ul aria-label={t('settings.webhooks.events')} className="flex flex-wrap gap-1.5">
            {shown.map((event) => (
              <li key={event}>
                <Chip>{eventLabel(event)}</Chip>
              </li>
            ))}
            {webhook.events.length > SHOWN_EVENTS && (
              <li>
                <Chip>{t('settings.webhooks.more_events', { count: webhook.events.length - SHOWN_EVENTS })}</Chip>
              </li>
            )}
          </ul>
        </dd>
        {bot && (
          <>
            <dt className="text-muted">{t('settings.webhooks.bot_only')}</dt>
            <dd className="text-ink">{bot.name}</dd>
          </>
        )}
        <dt className="text-muted">{t('settings.webhooks.created_at')}</dt>
        <dd className="text-ink">{formatDateTime(webhook.created_at, zone)}</dd>
      </dl>
    </article>
  );
}
