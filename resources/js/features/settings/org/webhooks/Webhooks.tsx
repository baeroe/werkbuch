/*
 * Settings → Webhooks (spec 6.3, org admins): where werkbuch sends events, signed with a secret that is shown once.
 * The log of deliveries of one webhook is a view of this section (`?deliveries=<id>`); members are told "Nur für
 * Admins" by the frame and load nothing.
 */

import { useSearchParam } from '@/lib/links';
import type { SectionProps } from '../sections';
import { WebhookDeliveries } from './WebhookDeliveries';
import { WebhookList } from './WebhookList';

export default function Webhooks(_props: SectionProps) {
  const deliveries = useSearchParam('deliveries');
  return deliveries ? <WebhookDeliveries key={deliveries} webhookId={deliveries} /> : <WebhookList />;
}
