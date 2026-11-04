/*
 * Text typed into a wiki page that can no longer be saved (like A154): the page was deleted meanwhile, or the person
 * may no longer edit it (the project archived, the role lowered). The text stands read-only in a banner, with why when
 * there is a reason, "Kopieren" and "Verwerfen"; it is never sent, and leaving asks while it stands (`lib/drafts.ts`).
 * Nothing shows while the page holds no such text.
 */

import { useRef } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { isEmptyDoc } from '@/editor/RichTextEditor';
import { RichTextView } from '@/editor/RichTextView';
import { CopyButton } from '@/features/settings/tokens/CopyButton';
import { drafts, pageDraft, usePageDraft } from '@/lib/drafts';
import { t } from '@/lib/i18n';
import { docToText } from '@/lib/richtext';

export function ParkedDraft({ pageId, reason, className }: { pageId: string; reason?: string | null; className?: string }) {
  const key = pageDraft(pageId);
  const unsaved = usePageDraft(key);
  const parked = useRef<HTMLDivElement>(null);
  if (!unsaved) return null;
  return (
    <Banner tone="danger" role="alert" title={t('wiki.page.unsaved.title')} className={className}>
      {reason && <p>{reason}</p>}
      <div ref={parked} className="mt-2 rounded-md border border-line bg-surface p-3">
        <p className="font-display font-bold text-ink">{unsaved.title}</p>
        {unsaved.content && !isEmptyDoc(unsaved.content) && <RichTextView value={unsaved.content} preset="page" className="mt-1" />}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButton text={[unsaved.title, docToText(unsaved.content)].filter(Boolean).join('\n\n')} target={() => parked.current} size="sm" />
        <Button variant="secondary" size="sm" onClick={() => drafts.setPage(key, null)}>
          {t('wiki.page.unsaved.discard')}
        </Button>
      </div>
    </Banner>
  );
}
