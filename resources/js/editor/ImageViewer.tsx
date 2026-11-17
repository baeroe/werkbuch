/*
 * The large view of a picture of a rich text (WEBU-7), held once by the shell: the original file (not the preview),
 * fitted into the window or at its own size (a click on the picture or „Originalgröße“ switches), its alternative
 * text as the caption and its file name. „Original öffnen“ (a new tab) and „Herunterladen“ (`?download=1`) are links.
 * Several pictures in the same text: ←/→ (and the two buttons) go through them, at either end nothing. Escape and ×
 * close it; the focus goes back to the picture that opened it.
 */

import { ChevronLeft, ChevronRight, Download, ExternalLink, ImageOff, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { attachmentUrl } from '@/api/attachments';
import { buttonClass } from '@/components/ui/Button';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { useAttachment } from '@/hooks/attachments';
import { t } from '@/lib/i18n';
import { closeImageViewer, showImage, useImageViewer, viewerNow } from './imageViewer';

export function ImageViewerHost() {
  const viewer = useImageViewer();
  const [full, setFull] = useState(false);
  const finalFocus = useRef<HTMLElement | null>(null);
  const image = viewer ? viewer.images[viewer.index] : undefined;
  const query = useAttachment(image?.attachmentId ?? null);
  const attachment = query.data;
  // every picture starts fitted into the window
  const index = viewer?.index;
  useEffect(() => setFull(false), [index]);
  if (viewer) finalFocus.current = viewer.returnFocus;

  const count = viewer?.images.length ?? 0;
  const name = image?.alt ?? attachment?.filename ?? t('editor.image.viewer.untitled');

  // ←/→ go through the pictures from anywhere in the dialog (the focus is on its buttons, not on the picture)
  const open = viewer !== null;
  useEffect(() => {
    if (!open) return;
    const listen = (event: globalThis.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      // Escape closes from anywhere too: a button at the end of the row that turns blocked takes the focus with it
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeImageViewer();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      showImage((viewerNow()?.index ?? 0) + (event.key === 'ArrowLeft' ? -1 : 1));
    };
    // in the capture phase: before anything of the page under the dialog can take the arrows
    document.addEventListener('keydown', listen, true);
    return () => document.removeEventListener('keydown', listen, true);
  }, [open]);

  return (
    <Dialog
      open={viewer !== null}
      onOpenChange={(open) => !open && closeImageViewer()}
      size="xl"
      title={name}
      description={count > 1 ? t('editor.image.viewer.counter', { index: (viewer?.index ?? 0) + 1, count }) : undefined}
      finalFocus={finalFocus}
      footer={
        viewer &&
        attachment && (
          <>
            {count > 1 && (
              <span className="mr-auto flex gap-1">
                <IconButton
                  icon={ChevronLeft}
                  label={t('editor.image.viewer.previous')}
                  shortcut="left"
                  disabledReason={viewer.index === 0 ? t('editor.image.viewer.first') : null}
                  onClick={() => showImage(viewer.index - 1)}
                />
                <IconButton
                  icon={ChevronRight}
                  label={t('editor.image.viewer.next')}
                  shortcut="right"
                  disabledReason={viewer.index === count - 1 ? t('editor.image.viewer.last') : null}
                  onClick={() => showImage(viewer.index + 1)}
                />
              </span>
            )}
            <Button variant="ghost" size="sm" icon={full ? Minimize2 : Maximize2} aria-pressed={full} onClick={() => setFull((current) => !current)}>
              {t('editor.image.viewer.full_size')}
            </Button>
            <a href={attachment.url} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'ghost', size: 'sm' }, 'gap-1.5')}>
              <ExternalLink className="size-3.5" aria-hidden="true" />
              {t('editor.image.viewer.open')}
            </a>
            <a href={attachmentUrl(attachment, { download: true })} download={attachment.filename} className={buttonClass({ variant: 'secondary', size: 'sm' }, 'gap-1.5')}>
              <Download className="size-3.5" aria-hidden="true" />
              {t('editor.image.viewer.download')}
            </a>
          </>
        )
      }
    >
      <div data-image-viewer="">
        {attachment ? (
          <figure className="flex flex-col gap-2">
            <div className={cx('flex max-h-[70vh] justify-center rounded-ctl bg-sunken', full ? 'overflow-auto' : 'overflow-hidden')}>
              {/* a click switches the size too; the button in the footer does it for the keyboard */}
              <img
                src={attachment.url}
                alt={image?.alt ?? ''}
                className={cx(full ? 'max-w-none cursor-zoom-out' : 'max-h-[70vh] max-w-full cursor-zoom-in object-contain')}
                onClick={() => setFull((current) => !current)}
              />
            </div>
            <figcaption className="text-sm text-muted">
              {image?.alt && <span className="text-ink">{image.alt} · </span>}
              <span translate="no">{attachment.filename}</span>
            </figcaption>
          </figure>
        ) : (
          <p className="flex items-center gap-2 text-muted" aria-busy={query.isPending || undefined}>
            <ImageOff className="size-4" aria-hidden="true" />
            {t(query.isPending ? 'editor.image.loading' : 'editor.image.unavailable')}
          </p>
        )}
      </div>
    </Dialog>
  );
}
