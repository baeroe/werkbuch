/*
 * The live connection of the tab (spec 7.2, phase plan 8 "Live"): connects to Reverb with the settings of the page
 * (`features.live`, nothing without them, A285), joins the channels of the projects the person sees
 * (`useProjects({ include_archived: true })`, the list the rights read too: a project joined or lost changes it, K14)
 * and lets the screens load again what others changed (`useLiveSync`). Renders nothing; the banner is `LiveIndicator`.
 */

import { useEffect } from 'react';
import { connectLive, watchProjects } from '@/api/live';
import { useLiveSync } from '@/hooks/live';
import { useProjects } from '@/hooks/projects';
import { useSharedProps } from '@/lib/page';

export function LiveHost() {
  const { features, auth } = useSharedProps();
  const live = features.live;
  const me = auth.user?.id;
  // the shared props come anew with every visit: connect again only when a setting changes
  const settings = live === null ? null : JSON.stringify(live);
  useEffect(() => {
    if (me === undefined || settings === null) return undefined;
    return connectLive(JSON.parse(settings) as NonNullable<typeof live>, me);
  }, [settings, me]);

  useLiveSync();

  const projects = useProjects({ include_archived: true });
  const ids = projects.data?.items.map((project) => project.id);
  const joined = ids === undefined ? null : ids.join(',');
  // after a new connection as well: closing one forgets the projects (`disconnectLive`)
  useEffect(() => {
    if (joined !== null) watchProjects(joined === '' ? [] : joined.split(','));
  }, [joined, settings, me]);

  return null;
}
