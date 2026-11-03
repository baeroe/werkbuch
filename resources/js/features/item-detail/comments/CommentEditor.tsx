/*
 * Editing an own comment (spec 4.10, port of the clickdummy): the editor in place of the text, mod+enter or "Speichern"
 * saves, Escape (after an open `@`, `#` or `/` list) or "Abbrechen" takes the edit back. The comment is marked edited;
 * the history keeps its earlier version.
 * - The edit is a draft of this visit (`lib/drafts.ts`, `comment-edit:<id>`): it outlives closing the preview, and the
 *   card opens its editor again with it (`hasEditDraft`). While it is there, leaving the page asks first. Every view
 *   follows a save on its way (the store's), so nothing is saved twice and an answer reaches the view open then.
 * - A failed save keeps the editor open with the text: a refusal of the text (422) stands under the editor, an outage
 *   offers "Erneut versuchen" in a toast, which saves the text as it reads then (also once the view is gone).
 * - What is written while saving stays open as the newer edit; a save that went through closes the editor (`onDone`).
 * - Saving waits for the uploads in the editor; an empty text is no edit (deleting is the menu's).
 */

import type { Editor } from '@tiptap/react';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { isEmptyDoc, RichTextEditor } from '@/editor/RichTextEditor';
import { UploadContext, useUploadCounter, useUploadsPending } from '@/editor/UploadContext';
import { useEditComment } from '@/hooks/comments';
import { commentEditDraft, drafts, useDraft, useDraftSending } from '@/lib/drafts';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Comment, RichText } from '@/types';

/** Object keys in one order: the editor writes `text` before `marks`, a document that went through the cache may not. */
const sortedKeys = (_key: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) : value;
const same = (a: RichText | null, b: RichText | null) => JSON.stringify(a, sortedKeys) === JSON.stringify(b, sortedKeys);

/** Whether an edit of the comment waits as a draft or is being saved: its card opens the editor again. */
export function hasEditDraft(commentId: string): boolean {
  const key = commentEditDraft(commentId);
  return drafts.get(key) !== null || drafts.sending(key);
}

export function CommentEditor({ comment, projectId, onDone }: { comment: Comment; projectId: string; onDone: () => void }) {
  const edit = useEditComment();
  const key = commentEditDraft(comment.id);
  /** The edit as a draft; null while the text is the saved one (or empty). */
  const stored = useDraft(key);
  const busy = useDraftSending(key);
  const [text, setText] = useState<RichText | null>(stored ?? comment.body_json);
  /** The text as the editor holds it now (the draft leaves out an empty or unchanged one). */
  const latest = useRef<RichText | null>(text);
  /** The draft as this view wrote or took it last: anything else in the store came from elsewhere (a save's answer). */
  const written = useRef(stored);
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = useId();
  const uploads = useUploadCounter();
  const uploading = useUploadsPending(uploads);
  const latestUploading = useRef(uploading);
  latestUploading.current = uploading;
  const editor = useRef<Editor | null>(null);
  const mounted = useRef(false);
  const latestDone = useRef(onDone);
  latestDone.current = onDone;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // the draft changed elsewhere: a save of an earlier view went through (the edit is done) or the text is newer
  useEffect(() => {
    if (stored === written.current) return;
    if (stored) {
      written.current = stored;
      latest.current = stored;
      setText(stored);
      return;
    }
    // the draft went while a save runs: done once the save has ended
    if (busy) return;
    written.current = null;
    latestDone.current();
  }, [stored, busy]);

  const focusEditor = () => {
    const current = editor.current;
    if (current && !current.isDestroyed) current.commands.focus('end');
  };

  /** Leaves the edit: nothing of it stays a draft. */
  function close() {
    written.current = null;
    drafts.set(key, null);
    latestDone.current();
  }

  function save() {
    if (drafts.sending(key)) return;
    if (latestUploading.current > 0) return void setProblem(t('editor.upload.pending'));
    // the text as it reads now: "Erneut versuchen" of an earlier attempt saves what was written since, too
    const body = drafts.get(key);
    if (!body) {
      if (!mounted.current) return;
      if (isEmptyDoc(latest.current)) {
        setProblem(t('items.comments.edit_empty'));
        focusEditor();
      } else close();
      return;
    }
    const done = drafts.startSending(key);
    const epoch = drafts.epoch();
    setProblem(null);
    // a promise, not callbacks of mutate: those are skipped once the view has closed, and the draft would stay
    edit
      .mutateAsync({ id: comment.id, body })
      .then(
        () => {
          if (drafts.epoch() !== epoch) return;
          // written on while it was on its way: the editor stays open with the newer text
          if (!same(drafts.get(key), body)) return;
          toast({ title: t('items.comments.saved'), tone: 'success' });
          if (mounted.current) close();
          else drafts.set(key, null);
        },
        (error: unknown) => {
          if (drafts.epoch() !== epoch) return;
          // a refusal of the text stands at the editor; with the view gone, the toast says it
          if (error instanceof ApiError && error.status === 422 && mounted.current) return void setProblem(error.errors?.body_json?.[0] ?? error.message);
          notifyError(t('items.comments.edit_failed'), error, save);
        },
      )
      .finally(done);
  }

  return (
    <div className="mt-1">
      <UploadContext value={uploads}>
        <RichTextEditor
          value={text}
          onChange={(doc) => {
            latest.current = doc;
            setText(doc);
            written.current = !doc || isEmptyDoc(doc) || same(doc, comment.body_json) ? null : doc;
            drafts.set(key, written.current);
            setProblem(null);
          }}
          preset="comment"
          label={t('items.comments.edit_label')}
          projectId={projectId}
          onSubmit={save}
          onEscape={close}
          autoFocus
          editorRef={editor}
          invalid={problem !== null}
          describedBy={problem ? problemId : undefined}
        />
      </UploadContext>
      <div aria-live="polite">
        {problem && (
          <p id={problemId} className="mt-1.5 text-sm font-medium text-danger">
            {problem}
          </p>
        )}
      </div>
      {/* on the phone every button is a 44 px target (spec 5.1) */}
      <div className="mt-2 flex flex-wrap justify-end gap-2 max-sm:[&_button]:min-h-11">
        <Button variant="ghost" size="sm" shortcut="escape" onClick={close}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" shortcut="mod+enter" pending={busy} disabledReason={uploading > 0 ? t('editor.upload.pending') : null} onClick={save}>
          {t('items.comments.save')}
        </Button>
      </div>
    </div>
  );
}
