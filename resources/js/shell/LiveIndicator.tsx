/*
 * Live updates (spec 7.2, risk in spec 14): while the live connection is down, a banner above the screen says so, as
 * the app will warn when a proxy blocks the websocket.
 */

import { RotateCw, WifiOff } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useLiveConnected } from '@/hooks/live';
import { t } from '@/lib/i18n';

export function LiveIndicator() {
  const connected = useLiveConnected();
  // the region stays rendered, so screen readers announce the banner when it appears
  return (
    <div role="status">
      {!connected && (
        <Banner
          tone="info"
          icon={WifiOff}
          title={t('shell.live.paused_title')}
          action={
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => window.location.reload()}>
              {t('common.reload')}
            </Button>
          }
          className="mb-4"
        >
          {t('shell.live.paused_description')}
        </Banner>
      )}
    </div>
  );
}
