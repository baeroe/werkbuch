/*
 * The files of an item (spec 4.16, kind `file`): name, size and a download; images with a small preview. Files come
 * in by "Datei hochladen" or by dropping them on the section; while one uploads, its line shows a bar. Deleting waits
 * for its undo toast. Images and files inside texts (kind `inline`) live in their texts, not here.
 */

import { File, FileText, Paperclip, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { useEditReason } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { toast } from '@/components/ui/toast';
import { useDeleteAttachment, useUploadAttachment } from '@/hooks/attachments';
import { notifyError } from '@/lib/errors';
import { runWithUndo } from '@/lib/undo';
import type { Attachment, WorkItemDetail } from '@/types';
import '@/features/editor/editor.css';
import { isInlineImage } from '@/features/editor/pasteImages';
import { focusWhenLost, Section } from './shared';

const SIZE_BYTE = new Intl.NumberFormat('de-DE', { style: 'unit', unit: 'byte', unitDisplay: 'long' });
const SIZE_KB = new Intl.NumberFormat('de-DE', { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 });
const SIZE_MB = new Intl.NumberFormat('de-DE', { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 });

/** 454 Byte, 12,3 kB, 1,2 MB */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return SIZE_BYTE.format(bytes);
  if (bytes < 1_000_000) return SIZE_KB.format(bytes / 1000);
  return SIZE_MB.format(bytes / 1_000_000);
}

function FileIcon({ attachment }: { attachment: Attachment }) {
  if (isInlineImage(attachment.mime)) {
    return <img src={attachment.url} alt="" className="size-8 shrink-0 rounded-chip border border-line object-cover" />;
  }
  const Icon = attachment.mime === 'application/pdf' || attachment.mime.startsWith('text/') ? FileText : File;
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-chip border border-line bg-sunken" aria-hidden="true">
      <Icon className="size-4 text-muted" />
    </span>
  );
}

interface Pending {
  id: string;
  name: string;
}

let pendingCounter = 0;

export function Attachments({ detail }: { detail: WorkItemDetail }) {
  const { item } = detail;
  const editReason = useEditReason(item);
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment();
  const input = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const [pending, setPending] = useState<Pending[]>([]);
  /** Deleted, while their undo toast stands. */
  const [gone, setGone] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const files = detail.attachments.filter((attachment) => attachment.kind === 'file' && !gone.includes(attachment.id));
  if (files.length === 0 && pending.length === 0 && editReason) return null;

  function send(list: readonly File[]) {
    for (const file of list) {
      const entry = { id: `pending-${(pendingCounter += 1)}`, name: file.name };
      setPending((current) => [...current, entry]);
      upload.mutate(
        { project_id: item.project_id, file, owner: { type: 'work_item', id: item.id }, kind: 'file' },
        {
          onSuccess: () => toast({ title: `„${file.name}“ angehängt`, tone: 'success' }),
          onError: (error) => notifyError(`„${file.name}“ nicht hochgeladen`, error, () => send([file])),
          onSettled: () => {
            if (mounted.current) setPending((current) => current.filter((other) => other.id !== entry.id));
          },
        },
      );
    }
  }

  function removeFile(attachment: Attachment) {
    setGone((current) => [...current, attachment.id]);
    // its delete button goes with it: the focus moves on to "Datei hochladen"
    focusWhenLost(() => uploadButton.current);
    const back = () => setGone((current) => current.filter((id) => id !== attachment.id));
    runWithUndo({
      label: `„${attachment.filename}“ gelöscht`,
      undo: back,
      failureTitle: `„${attachment.filename}“ nicht gelöscht`,
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
      title="Anhänge"
      aside={files.length > 0 ? <span className="tabular-nums">{new Intl.NumberFormat('de-DE').format(files.length)}</span> : null}
      actions={
        !editReason && (
          <>
            <input
              ref={input}
              id={inputId}
              type="file"
              name="attachments"
              multiple
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              onChange={(event) => {
                const chosen = [...(event.target.files ?? [])];
                event.target.value = '';
                if (chosen.length > 0) send(chosen);
              }}
            />
            <Button ref={uploadButton} variant="ghost" size="sm" icon={Upload} onClick={() => input.current?.click()}>
              Datei hochladen
            </Button>
          </>
        )
      }
    >
      <div {...drop} className={cx('-mx-2 mt-1 rounded-ctl transition-colors duration-120', over && 'bg-accent-soft outline-2 outline-offset-2 outline-dashed outline-(--accent)')}>
        {files.length > 0 || pending.length > 0 ? (
          <ul className="flex flex-col">
            {files.map((attachment) => (
              <li key={attachment.id} className="flex min-h-11 items-center gap-2.5 rounded-ctl px-2 py-1 hover:bg-hover">
                <FileIcon attachment={attachment} />
                <a
                  href={attachment.url}
                  download={attachment.filename}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-chip text-ui text-ink no-underline hover:underline md:min-h-0"
                >
                  <span className="block truncate font-medium">{attachment.filename}</span>
                  <span className="block text-sm text-muted tabular-nums">{formatSize(attachment.size)}</span>
                </a>
                {!editReason && <IconButton icon={X} size="sm" label={`„${attachment.filename}“ löschen`} onClick={() => removeFile(attachment)} />}
              </li>
            ))}
            {pending.map((entry) => (
              <li key={entry.id} className="flex min-h-11 items-center gap-2.5 px-2 py-1" aria-busy="true">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-chip border border-dashed border-line-strong" aria-hidden="true">
                  <Paperclip className="size-4 text-muted" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui text-muted">{entry.name}</span>
                  <span role="progressbar" aria-label={`${entry.name} wird hochgeladen`} className="rt-upload-bar mt-1">
                    <span className="rt-upload-fill" />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-1 text-ui text-pretty text-muted">Noch keine Dateien. Lade eine hoch oder zieh sie hierher.</p>
        )}
      </div>
    </Section>
  );
}
