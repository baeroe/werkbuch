/*
 * The edit conflict of a wiki page (spec 4.15; ported from the clickdummy): somebody else saved while this window typed,
 * and the server refused the save (409 `page_conflict`). The banner names who (the server's sentence, or that it was
 * the person's own save in another window, T4-M5) and offers the two ways out: load the other version, or save this one
 * over it ("Meine Fassung übernehmen"). Taking over keeps the other one as a version first (A307), so nothing is lost
 * either way. The buttons go with the banner: the caller gives the focus on into the text.
 */

import { RotateCw } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';

interface ConflictBannerProps {
  /** Who saved meanwhile: "Ida Brenner hat die Seite inzwischen geändert." */
  message: string;
  onReload: () => void;
  onKeepMine: () => void;
  className?: string;
}

export function ConflictBanner({ message, onReload, onKeepMine, className }: ConflictBannerProps) {
  return (
    <Banner tone="danger" role="alert" title={message} className={className}>
      <p className="max-w-[65ch]">{t('wiki.conflict.text')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={RotateCw} onClick={onReload}>
          {t('common.reload')}
        </Button>
        <Button variant="primary" size="sm" onClick={onKeepMine}>
          {t('wiki.conflict.keep_mine')}
        </Button>
      </div>
    </Banner>
  );
}
