/*
 * The files of an item (spec 4.16, kind `file`): name, size and a download (`?download=1`); a picture opens in a new tab
 * as itself (the server serves it inline with its sandbox), its download stands beside it, and its small preview
 * (`preview_url` once the queue made one, otherwise the file) loads only when it comes into view (F28). Files come in by "Datei hochladen"
 * or by dropping them on the section; each file is a call of its own with its own line, whose bar follows the bytes
 * that went out, and its own result (`useSettle`: of two uploads at once, neither line hangs). The result is a toast
 * whether the view is still there or not (the preview moved on with j/k, another page): a failure with the server's
 * sentence and "Erneut versuchen" for a failure worth repeating, which reports its own result the same way; once the
 * view is gone the toast names the item, and a stored file offers "Öffnen" (the preview of the item). Only the lines
 * belong to the view. While an upload is on its way, leaving or reloading the page asks first (`drafts.hold()`, at
 * module level, so it outlives the view). Removing waits for its undo toast; a failure brings the file back, "Erneut
 * versuchen" hides it again at once. The files hidden that way are the module's (`hiddenFiles`), so a view opened
 * again meanwhile leaves them out too; a 404 (gone meanwhile) counts as removed (F27). Files dropped anywhere on the
 * section upload; without the right to change the item the drop says why instead of leaving the page.
 * Images and files inside texts (kind `inline`) live in their texts, not here.
 *
 * Only with `item.edit` on an item that is not archived (`useEditReason`): otherwise the list is read only, "Datei
 * hochladen" says why, and without files there is no section at all.
 */

import { Download, File as FileGlyph, FileText, Paperclip, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { attachmentUrl } from '@/api/attachments';
import { ApiError } from '@/api/client';
import { formatSize } from '@/components/fields/format';
import { useEditReason } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { toast } from '@/components/ui/toast';
import { useDeleteAttachment, usePrimeAttachments, useUploadAttachment } from '@/hooks/attachments';
import { useSettle } from '@/hooks/mutation';
import { drafts } from '@/lib/drafts';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import { runWithUndo } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import type { Attachment, WorkItemDetail } from '@/types';
import '@/editor/editor.css';
import { focusWhenLost, Section } from './shared';

function FileIcon({ attachment }: { attachment: Attachment }) {
  if (attachment.inline) {
    return (
      <img
        src={attachmentUrl(attachment, { preview: true })}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-8 shrink-0 rounded-chip border border-line object-cover"
      />
    );
  }
  const Icon = attachment.mime === 'application/pdf' || attachment.mime.startsWith('text/') ? FileText : FileGlyph;
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-chip border border-line bg-sunken" aria-hidden="true">
      <Icon className="size-4 text-muted" />
    </span>
  );
}

/** An upload on its way: its line and the share of the file that went out, 0 to 1. */
interface Pending {
  id: number;
  name: string;
  progress: number;
}

let pendingCounter = 0;

/** Files removed while their undo toast stands (and after: a removed file never comes back), for every view. */
let hiddenFiles: ReadonlySet<string> = new Set();
const hiddenListeners = new Set<() => void>();

function setFileHidden(id: string, on: boolean): void {
  if (hiddenFiles.has(id) === on) return;
  const next = new Set(hiddenFiles);
  if (on) next.add(id);
  else next.delete(id);
  hiddenFiles = next;
  hiddenListeners.forEach((listener) => listener());
}

function useHiddenFiles(): ReadonlySet<string> {
  const subscribe = useCallback((listener: () => void) => {
    hiddenListeners.add(listener);
    return () => hiddenListeners.delete(listener);
  }, []);
  return useSyncExternalStore(subscribe, () => hiddenFiles);
}

export function Attachments({ detail }: { detail: WorkItemDetail }) {
  const settle = useSettle();
  const { item } = detail;
  const editReason = useEditReason(item);
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment();
  const input = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  /** Removed, while their undo toast stands (also by a view that is gone). */
  const gone = useHiddenFiles();
  const [over, setOver] = useState(false);
  /** What a screen reader hears when an upload starts (the bars are no live region; results are toasts, F21). */
  const [said, setSaid] = useState('');
  /** Whether the view is still there when an upload answers: its toast says so. */
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);
  // the files come with the detail: a text that shows one of them does not ask for it again
  usePrimeAttachments(detail.attachments);

  const files = detail.attachments.filter((attachment) => !gone.has(attachment.id));
  if (files.length === 0 && pending.length === 0 && editReason) return null;

  /**
   * Every file is a call of its own, with its own line and result (calls that overlap keep their own answer). The line
   * goes with the view; the toast of the result and the guard against leaving the page do not.
   */
  function send(list: readonly File[]) {
    for (const file of list) {
      pendingCounter += 1;
      const id = pendingCounter;
      setPending((current) => [...current, { id, name: file.name, progress: 0 }]);
      setSaid(t('items.attachments.uploading', { name: file.name }));
      const onProgress = (progress: number) => setPending((current) => current.map((entry) => (entry.id === id ? { ...entry, progress } : entry)));
      const release = drafts.hold();
      const call = upload.mutateAsync({ project_id: item.project_id, file, owner: { type: 'work_item', id: item.id }, kind: 'file', onProgress });
      settle(call, { onSettled: () => setPending((current) => current.filter((entry) => entry.id !== id)) });
      call.then(
        () => {
          release();
          if (shown.current) toast({ title: t('items.attachments.uploaded', { name: file.name }), tone: 'success' });
          else
            toast({
              title: t('items.attachments.uploaded_to', { name: file.name, key: item.key }),
              tone: 'success',
              action: { label: t('items.attachments.open'), onClick: () => useUiStore.getState().openPeek(item.id) },
            });
        },
        (error: unknown) => {
          release();
          const title = shown.current ? t('items.attachments.upload_failed', { name: file.name }) : t('items.attachments.upload_failed_to', { name: file.name, key: item.key });
          notifyError(title, error, () => send([file]));
        },
      );
    }
  }

  function removeFile(attachment: Attachment) {
    setFileHidden(attachment.id, true);
    // its button goes with it: the focus moves on to "Datei hochladen"
    focusWhenLost(() => uploadButton.current);
    const back = () => setFileHidden(attachment.id, false);
    runWithUndo({
      label: t('items.attachments.removed', { name: attachment.filename }),
      undo: back,
      failureTitle: t('items.attachments.remove_failed', { name: attachment.filename }),
      run: async () => {
        // "Erneut versuchen" after a failure hides the file again at once, as the first try did
        setFileHidden(attachment.id, true);
        try {
          await remove.mutateAsync(attachment.id);
        } catch (error) {
          // gone meanwhile: removed either way
          if (error instanceof ApiError && error.status === 404) return;
          back();
          throw error;
        }
      },
    });
  }

  /** Files over the section: dropped they upload; without the right the drop says why, the browser never opens them. */
  const drop = {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      if (!editReason) setOver(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (event: DragEvent) => {
      if (event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      setOver(false);
      if (editReason) toast({ title: t('items.attachments.not_dropped'), description: editReason, tone: 'error' });
      else send([...event.dataTransfer.files]);
    },
  };

  return (
    // the whole section takes files, its heading and button too
    <div {...drop} data-attachments-drop="">
      <div aria-live="polite" className="sr-only" data-attachments-announcer="">
        {said}
      </div>
    <Section
      title={t('items.attachments.title')}
      aside={files.length > 0 ? <span className="tabular-nums">{new Intl.NumberFormat(intlLocale()).format(files.length)}</span> : null}
      actions={
        <>
          {!editReason && (
            <input
              ref={input}
              type="file"
              name="attachments"
              multiple
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              onChange={(event) => {
                const chosen = [...(event.target.files ?? [])];
                event.target.value = '';
                send(chosen);
              }}
            />
          )}
          <Button ref={uploadButton} variant="ghost" size="sm" icon={Upload} disabledReason={editReason} onClick={() => input.current?.click()}>
            {t('items.attachments.upload')}
          </Button>
        </>
      }
    >
      <div
        data-over={over ? '' : undefined}
        className={cx('-mx-2 mt-1 rounded-ctl transition-colors duration-120', over && 'bg-accent-soft outline-2 outline-offset-2 outline-(--accent) outline-dashed')}
      >
        {files.length > 0 || pending.length > 0 ? (
          <ul className="flex flex-col">
            {files.map((attachment) => (
              <li key={attachment.id} className="flex min-h-11 items-center gap-2.5 rounded-ctl px-2 py-1 hover:bg-hover">
                <FileIcon attachment={attachment} />
                {/* a picture opens as itself in a new tab, any other file is a download (F28) */}
                <a
                  href={attachmentUrl(attachment, { download: !attachment.inline })}
                  {...(attachment.inline ? { target: '_blank', rel: 'noopener noreferrer' } : { download: attachment.filename })}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-chip text-ui text-ink no-underline hover:underline md:min-h-0"
                >
                  <span className="block truncate font-medium">{attachment.filename}</span>
                  <span className="block text-sm text-muted tabular-nums">{formatSize(attachment.size)}</span>
                </a>
                {attachment.inline && (
                  <a
                    href={attachmentUrl(attachment, { download: true })}
                    download={attachment.filename}
                    aria-label={t('items.attachments.download', { name: attachment.filename })}
                    title={t('items.attachments.download', { name: attachment.filename })}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-ctl text-muted hover:bg-hover hover:text-ink md:size-7"
                  >
                    <Download className="size-4" aria-hidden="true" />
                  </a>
                )}
                {!editReason && <IconButton icon={X} size="sm" label={t('items.attachments.remove', { name: attachment.filename })} onClick={() => removeFile(attachment)} />}
              </li>
            ))}
            {pending.map((entry) => {
              const label = t('items.attachments.uploading', { name: entry.name });
              const percent = Math.round(entry.progress * 100);
              return (
                <li key={entry.id} className="flex min-h-11 items-center gap-2.5 px-2 py-1" aria-busy="true">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-chip border border-dashed border-line-strong" aria-hidden="true">
                    <Paperclip className="size-4 text-muted" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui text-muted">{entry.name}</span>
                    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="rt-upload-bar mt-1">
                      <span className="rt-upload-fill" style={{ width: `${percent}%` }} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-2 py-1 text-ui text-pretty text-muted">{t('items.attachments.empty')}</p>
        )}
      </div>
    </Section>
    </div>
  );
}
