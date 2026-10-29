/*
 * Live updates (spec 7.2, risk in spec 14): while the live connection is down, a banner above the screen says so, as
 * the app will warn when a proxy blocks the websocket. Live events themselves are handled by `useLiveSync` in the
 * shell: the screens load again and the changed card or row lights up for two seconds (`flash`).
 */

import { RotateCw, WifiOff } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useLiveConnected } from '@/hooks/live';

export function LiveIndicator() {
  const connected = useLiveConnected();
  // the region stays rendered, so screen readers announce the banner when it appears
  return (
    <div role="status">
      {!connected && (
        <Banner
          tone="info"
          icon={WifiOff}
          title="Live-Updates pausiert"
          action={
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => window.location.reload()}>
              Neu laden
            </Button>
          }
          className="mb-4"
        >
          Änderungen anderer erscheinen erst nach dem Neuladen.
        </Banner>
      )}
    </div>
  );
}
