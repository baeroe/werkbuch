/*
 * Writing a comment (spec 4.10): "Kommentar schreiben …" with M opens the editor (`m` anywhere in the detail does the
 * same), mod+enter sends. Everybody who sees the project may comment, viewers too; archived items take no comments.
 * A comment that fails to send stays in the editor, and the toast offers "Erneut versuchen" where it can help.
 * "Später weiterschreiben" folds the editor up; an unsent text stays a draft of the item while the page lives, also
 * when the preview closes or another item opens in between.
 */

import { MessageSquare } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { archivedReason } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { toast } from '@/components/ui/toast';
import { useAddComment } from '@/hooks/comments';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import type { RichText, WorkItem } from '@/types';
import { isEmptyDoc, RichTextEditor } from '@/features/editor/RichTextEditor';
import { useDetail, useUnsavedGuard } from './shared';

/**
 * Unsent comments by item id, for this visit (a per-viewer convenience; nothing is stored). Always the text as it is
 * now, so sending reads it from here.
 */
const drafts = new Map<string, RichText>();

export function CommentComposer({ item }: { item: WorkItem }) {
  const { actions } = useDetail();
  const { reason } = usePermissions();
  const add = useAddComment();
  const [open, setOpen] = useState(false);
  const [draft, setDraftState] = useState<RichText | null>(() => drafts.get(item.id) ?? null);
  const setDraft = (next: RichText | null) => {
    if (next && !isEmptyDoc(next)) drafts.set(item.id, next);
    else drafts.delete(item.id);
    setDraftState(next);
  };
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  /** A send is on its way (a ref: the retry of an error toast runs an older render's `send`). */
  const sending = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = useId();
  const denied = item.archived_at !== null ? archivedReason(item.key) : reason('item.comment', item.project_id);
  const empty = isEmptyDoc(draft);
  // an unsent comment lives in memory only: leaving or reloading the page asks first
  useUnsavedGuard(!empty);

  useEffect(() => {
    const own = actions.current;
    const write = () => {
      if (denied) return toast({ title: 'Nicht möglich', description: denied, tone: 'error' });
      setOpen(true);
      // already open: back into the text
      box.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
      box.current?.scrollIntoView({ block: 'nearest' });
    };
    own.writeComment = write;
    return () => {
      if (own.writeComment === write) own.writeComment = undefined;
    };
  });

  useEffect(() => {
    if (open) box.current?.scrollIntoView({ block: 'nearest' });
    else if (refocus.current) {
      refocus.current = false;
      opener.current?.focus();
    }
  }, [open]);

  function send() {
    if (sending.current) return;
    // the text as it is now: "Erneut versuchen" on the toast of an earlier attempt sends what was written since, too
    const body = drafts.get(item.id);
    if (!body) {
      // "Senden" stays usable; an empty comment says so at the editor
      setProblem('Der Kommentar ist noch leer. Schreib zuerst etwas.');
      box.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
      return;
    }
    sending.current = true;
    // a promise, not callbacks of mutate: they are skipped once the preview has closed, and the draft would stay
    add
      .mutateAsync({ work_item_id: item.id, body })
      .then(
        () => {
          toast({ title: 'Kommentar gesendet', tone: 'success' });
          // written on while it was on its way: the newer text stays in the editor
          if (drafts.get(item.id) !== body) return;
          setDraft(null);
          refocus.current = true;
          setOpen(false);
        },
        // the draft stays in the editor
        (error: unknown) => notifyError('Kommentar nicht gesendet', error, send),
      )
      .finally(() => {
        sending.current = false;
      });
  }

  if (denied && !open) {
    return <p className="mt-3 text-sm text-pretty text-muted">{denied}</p>;
  }

  if (!open) {
    return (
      <button
        ref={opener}
        type="button"
        aria-keyshortcuts="M"
        onClick={() => setOpen(true)}
        className="mt-3 flex h-11 w-full cursor-text items-center gap-2 rounded-ctl border border-line bg-surface px-3 text-left text-ui text-muted shadow-[inset_0_-1.5px_0_var(--line-input)] transition-colors duration-120 hover:border-line-strong hover:text-ink md:h-9"
      >
        <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{empty ? 'Kommentar schreiben …' : 'Entwurf weiterschreiben …'}</span>
        <Kbd keys="m" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div ref={box} className="mt-3">
      <RichTextEditor
        value={draft}
        onChange={(doc) => {
          setDraft(doc);
          setProblem(null);
        }}
        preset="comment"
        projectId={item.project_id}
        onSubmit={send}
        autoFocus
        aria-describedby={problem ? problemId : undefined}
      />
      <div aria-live="polite">
        {problem && (
          <p id={problemId} className="mt-1.5 text-sm font-medium text-danger">
            {problem}
          </p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            refocus.current = true;
            setOpen(false);
          }}
        >
          {empty ? 'Abbrechen' : 'Später weiterschreiben'}
        </Button>
        <Button variant="primary" size="sm" shortcut="mod+enter" pending={add.isPending} onClick={send}>
          Senden
        </Button>
      </div>
    </div>
  );
}
