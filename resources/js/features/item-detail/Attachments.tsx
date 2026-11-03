/*
 * The files of an item (spec 4.16, kind `file`): name, size and a download (`?download=1`, also for pictures); pictures
 * with a small preview (`preview_url` once the queue made one, otherwise the file). Files come in by "Datei hochladen"
 * or by dropping them on the section; each file is a call of its own with its own line, whose bar follows the bytes
 * that went out, and its own result (`useSettle`: of two uploads at once, neither line hangs; a toast per failure,
 * "Erneut versuchen" for a failure worth repeating). Removing waits for its undo toast; a failure brings the file back.
 * Images and files inside texts (kind `inline`) live in their texts, not here.
 *
 * Only with `item.edit` on an item that is not archived (`useEditReason`): otherwise the list is read only, "Datei
 * hochladen" says why, and without files there is no section at all.
 */

import { File as FileGlyph, FileText, Paperclip, Upload, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { attachmentUrl } from '@/api/attachments';
import { formatSize } from '@/components/fields/format';
import { useEditReason } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { toast } from '@/components/ui/toast';
import { useDeleteAttachment, usePrimeAttachments, useUploadAttachment } from '@/hooks/attachments';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import { runWithUndo } from '@/lib/undo';
import type { Attachment, WorkItemDetail } from '@/types';
import '@/editor/editor.css';
import { focusWhenLost, Section } from './shared';

function FileIcon({ attachment }: { attachment: Attachment }) {
  if (attachment.inline) {
    return <img src={attachmentUrl(attachment, { preview: true })} alt="" className="size-8 shrink-0 rounded-chip border border-line object-cover" />;
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

export function Attachments({ detail }: { detail: WorkItemDetail }) {
  const settle = useSettle();
  const { item } = detail;
  const editReason = useEditReason(item);
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment();
  const input = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  /** Removed, while their undo toast stands. */
  const [gone, setGone] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  // the files come with the detail: a text that shows one of them does not ask for it again
  usePrimeAttachments(detail.attachments);

  const files = detail.attachments.filter((attachment) => !gone.includes(attachment.id));
  if (files.length === 0 && pending.length === 0 && editReason) return null;

  /** Every file is a call of its own, with its own line and result (calls that overlap keep their own answer). */
  function send(list: readonly File[]) {
    for (const file of list) {
      pendingCounter += 1;
      const id = pendingCounter;
      setPending((current) => [...current, { id, name: file.name, progress: 0 }]);
      const onProgress = (progress: number) => setPending((current) => current.map((entry) => (entry.id === id ? { ...entry, progress } : entry)));
      settle(upload.mutateAsync({ project_id: item.project_id, file, owner: { type: 'work_item', id: item.id }, kind: 'file', onProgress }), {
        onSuccess: () => toast({ title: t('items.attachments.uploaded', { name: file.name }), tone: 'success' }),
        onError: (error) => notifyError(t('items.attachments.upload_failed', { name: file.name }), error, () => send([file])),
        onSettled: () => setPending((current) => current.filter((entry) => entry.id !== id)),
      });
    }
  }

  function removeFile(attachment: Attachment) {
    setGone((current) => [...current, attachment.id]);
    // its button goes with it: the focus moves on to "Datei hochladen"
    focusWhenLost(() => uploadButton.current);
    const back = () => setGone((current) => current.filter((id) => id !== attachment.id));
    runWithUndo({
      label: t('items.attachments.removed', { name: attachment.filename }),
      undo: back,
      failureTitle: t('items.attachments.remove_failed', { name: attachment.filename }),
      run: async () => {
        try {
          await remove.mutateAsync(attachment.id);
        } catch (error) {
          back();
          throw error;
        }
      },
    });
  }

  const drop = editReason
    ? {}
    : {
        onDragOver: (event: DragEvent) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setOver(true);
        },
        onDragLeave: (event: DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
        },
        onDrop: (event: DragEvent) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          setOver(false);
          send([...event.dataTransfer.files]);
        },
      };

  return (
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
        {...drop}
        data-over={over ? '' : undefined}
        className={cx('-mx-2 mt-1 rounded-ctl transition-colors duration-120', over && 'bg-accent-soft outline-2 outline-offset-2 outline-(--accent) outline-dashed')}
      >
        {files.length > 0 || pending.length > 0 ? (
          <ul className="flex flex-col">
            {files.map((attachment) => (
              <li key={attachment.id} className="flex min-h-11 items-center gap-2.5 rounded-ctl px-2 py-1 hover:bg-hover">
                <FileIcon attachment={attachment} />
                <a
                  href={attachmentUrl(attachment, { download: true })}
                  download={attachment.filename}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-chip text-ui text-ink no-underline hover:underline md:min-h-0"
                >
                  <span className="block truncate font-medium">{attachment.filename}</span>
                  <span className="block text-sm text-muted tabular-nums">{formatSize(attachment.size)}</span>
                </a>
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
  );
}
