/*
 * Settings → Webhooks (spec 6.3, org admins): where werkbuch sends events, signed with a secret that is shown once.
 * The log of deliveries of one webhook is a view of this section (`?deliveries=<id>`, Task 14); members are told
 * "Nur für Admins" by the frame and load nothing.
 */

import type { SectionProps } from '../sections';
import { WebhookList } from './WebhookList';

export default function Webhooks(_props: SectionProps) {
  return <WebhookList />;
}
