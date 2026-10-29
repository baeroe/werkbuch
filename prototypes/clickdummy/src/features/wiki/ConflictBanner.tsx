/*
 * The edit conflict of a wiki page (spec 4.15): somebody else saved while this window typed, and the server refused the
 * save (409 `page_conflict`). The banner names who, and offers the two ways out: load their version, or save this one
 * over it. Taking over keeps theirs as a version first, so nothing is lost either way.
 */

import { RotateCw } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';

type ConflictBannerProps = {
  /** The server's sentence: "Jonas Feld hat die Seite inzwischen geändert." */
  message: string;
  onReload: () => void;
  onKeepMine: () => void;
  className?: string;
};

export function ConflictBanner({ message, onReload, onKeepMine, className }: ConflictBannerProps) {
  return (
    <Banner tone="danger" role="alert" title={message} className={className}>
      <p className="max-w-[65ch]">Deine Fassung steht noch im Editor. Lade die neue Fassung oder übernimm deine. Die andere bleibt dann als Version erhalten.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={RotateCw} onClick={onReload}>
          Neu laden
        </Button>
        <Button variant="primary" size="sm" onClick={onKeepMine}>
          Meine Fassung übernehmen
        </Button>
      </div>
    </Banner>
  );
}
