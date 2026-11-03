/*
 * Writing a comment (spec 4.10, port of the clickdummy's composer): "Kommentar schreiben …" opens the editor, so does
 * `m` anywhere in the detail (`item.comment`, bound by `ItemDetailProvider`); mod+enter or "Kommentieren" sends.
 * Everybody who sees the project may comment, viewers too; an archived item or project takes no comments, and the
 * composer says why instead.
 *
 * Nothing written is lost (A251):
 * - The text is the item's draft of this visit (`lib/drafts.ts`, `comment:<itemId>`): "Später weiterschreiben" folds
 *   the editor up and keeps it, and so does closing the preview or opening another item; the opener then reads
 *   "Entwurf weiterschreiben …". While it is there, leaving or reloading the page asks first. Every view of the item
 *   follows the draft and a send on its way (the store's, not its own): one opened again while a comment of an earlier
 *   one is on its way shows the button busy and takes the answer, so nothing goes twice.
 * - The sent text stays in sight until the answer. What is typed meanwhile is not sent: once the comment is there, only
 *   the sent part goes (`unsentRest`), the rest stays as the draft. The editor stays open, its focus too, and a status
 *   region says "Kommentar gesendet".
 * - A failed send (5xx, no answer) keeps the text; the toast offers "Erneut versuchen", which sends the text as it
 *   reads then (also once the view is gone). A refusal of the text (422) stands under the editor.
 * - "Kommentieren" waits for the uploads in the editor (an upload on its way is no node in the text yet) and for text.
 * - Escape on an empty text folds the editor up. Uploads of a draft that is thrown away are not deleted from here: they
 *   belong to nobody, and the server prunes them after 24 hours (A239).
 */

import type { Editor } from '@tiptap/react';
import { MessageSquare } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { archivedReason } from '@/components/fields/itemData';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { toast } from '@/components/ui/toast';
import { isEmptyDoc, RichTextEditor } from '@/editor/RichTextEditor';
import { RichTextView } from '@/editor/RichTextView';
import { UploadContext, useUploadCounter, useUploadsPending } from '@/editor/UploadContext';
import { CopyButton } from '@/features/settings/tokens/CopyButton';
import { useAddComment } from '@/hooks/comments';
import { useProjectsWith } from '@/hooks/projects';
import { commentDraft, drafts, useDraft, useDraftProblem, useDraftSending } from '@/lib/drafts';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { docToText } from '@/lib/richtext';
import type { RichText, WorkItem } from '@/types';
import { useDetail } from '../shared';

const same = (a: RichText | undefined, b: RichText | undefined) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The inline content of `now` after the inline content of `sent`, when `sent` is how `now` begins (its last text node
 * may have grown), without the spaces it starts with; undefined when `sent` is not how it begins.
 */
function inlineRest(sent: RichText[], now: RichText[]): RichText[] | undefined {
  const last = sent.length - 1;
  if (last < 0 || sent.length > now.length) return undefined;
  for (let index = 0; index < last; index += 1) if (!same(sent[index], now[index])) return undefined;
  const [tail, grown] = [sent[last]!, now[last]!];
  let rest: RichText[];
  if (same(tail, grown)) rest = now.slice(sent.length);
  else if (tail.type === 'text' && grown.type === 'text' && same(tail.marks, grown.marks) && grown.text!.startsWith(tail.text!)) {
    rest = [{ ...grown, text: grown.text!.slice(tail.text!.length) }, ...now.slice(sent.length)];
  } else return undefined;
  const [first, ...others] = rest;
  if (first?.type !== 'text') return rest;
  const trimmed = first.text!.trimStart();
  return trimmed ? [{ ...first, text: trimmed }, ...others] : others;
}

/** Blocks that hold blocks (a list, its items, a quote): what was typed on in them is read block by block. */
const CONTAINERS = new Set(['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote']);

/**
 * The blocks of `now` after the blocks of `sent`, when `sent` is how `now` begins: the last sent block may have grown,
 * a paragraph by text after the sent part, a list or a quote by blocks after the sent ones (T18-M5). Undefined when
 * `sent` is not how it begins.
 */
function blockRest(sent: RichText[], now: RichText[]): RichText[] | undefined {
  const last = sent.length - 1;
  if (last < 0 || now.length < sent.length || !sent.slice(0, last).every((block, index) => same(block, now[index]))) return undefined;
  const [tail, grown] = [sent[last]!, now[last]!];
  const after = now.slice(sent.length);
  if (same(tail, grown)) return after;
  if (tail.type !== grown.type || !same(tail.attrs, grown.attrs)) return undefined;
  const inner = CONTAINERS.has(tail.type ?? '') ? blockRest(tail.content ?? [], grown.content ?? []) : inlineRest(tail.content ?? [], grown.content ?? []);
  if (!inner) return undefined;
  return [...(inner.length > 0 ? [{ ...grown, content: inner }] : []), ...after];
}

/**
 * What of `now` was not sent, when the comment `sent` went out: the blocks after the sent ones, and what a block that
 * was typed on further holds after the sent part (a paragraph its text, a list or a quote its new blocks). Null when
 * nothing is left; all of `now` when the sent text was changed while it was on its way (nothing is lost, the person
 * sees what is there).
 */
export function unsentRest(sent: RichText, now: RichText | null): RichText | null {
  if (!now) return null;
  const rest = blockRest(sent.content ?? [], now.content ?? []);
  if (!rest) return now;
  const left: RichText = { ...now, content: rest };
  return isEmptyDoc(left) ? null : left;
}

export function CommentComposer({ item }: { item: WorkItem }) {
  const { actions } = useDetail();
  // a project the cached list lacks (just created or joined) loads the list again
  useProjectsWith(item.project_id);
  const { reason, loading } = usePermissions();
  const add = useAddComment();
  const key = commentDraft(item.id);
  const [open, setOpen] = useState(false);
  /** The draft of the item; a send of any view changes it. */
  const stored = useDraft(key);
  const busy = useDraftSending(key);
  /** The editor's text as it reported it (a list without text yet stays one); the draft keeps only real text. */
  const [text, setText] = useState<RichText | null>(stored);
  /** The draft as this view wrote or took it last: anything else in the store came from elsewhere (a send's answer). */
  const written = useRef(stored);
  /** Why the text cannot go yet (empty, uploads), under the editor; the server's refusal is the draft's (below). */
  const [notice, setProblem] = useState<string | null>(null);
  /** The server refused the text: kept with the draft, so a view opened again shows it too (T18-M6). */
  const refused = useDraftProblem(key);
  const problem = notice ?? refused;
  const parked = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const problemId = useId();
  const uploads = useUploadCounter();
  const uploading = useUploadsPending(uploads);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const editor = useRef<Editor | null>(null);
  const refocus = useRef(false);
  const mounted = useRef(false);
  const latestUploading = useRef(uploading);
  latestUploading.current = uploading;

  const denied = item.archived_at !== null ? archivedReason(item.key) : reason('item.comment', item.project_id);
  const empty = isEmptyDoc(text);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // the draft changed elsewhere (a send of this or another view went through): the editor shows it
  useEffect(() => {
    if (stored === written.current) return;
    written.current = stored;
    setText(stored);
  }, [stored]);

  const focusEditor = () => {
    const current = editor.current;
    if (current && !current.isDestroyed) current.commands.focus('end');
  };

  /** How far the caret stands from the end of the text: the sent part goes from the front, the caret keeps its place. */
  const caretFromEnd = (): number | null => {
    const current = editor.current;
    return current && !current.isDestroyed && current.isFocused ? current.state.doc.content.size - current.state.selection.from : null;
  };
  const restoreCaret = (fromEnd: number) => {
    const current = editor.current;
    if (!current || current.isDestroyed) return;
    const size = current.state.doc.content.size;
    current.commands.focus(Math.max(1, Math.min(size - fromEnd, size - 1)));
  };

  useEffect(() => {
    const own = actions.current;
    const write = () => {
      if (denied) return void toast({ title: t('items.commands.denied'), description: denied, tone: 'error' });
      setOpen(true);
      // already open: back into the text
      focusEditor();
      box.current?.scrollIntoView?.({ block: 'nearest' });
    };
    own.writeComment = write;
    return () => {
      if (own.writeComment === write) own.writeComment = undefined;
    };
  });

  useEffect(() => {
    if (open) box.current?.scrollIntoView?.({ block: 'nearest' });
    else if (refocus.current) {
      refocus.current = false;
      opener.current?.focus();
    }
  }, [open]);

  function fold() {
    refocus.current = true;
    setProblem(null);
    setOpen(false);
  }

  function send() {
    if (drafts.sending(key)) return;
    if (latestUploading.current > 0) return void setProblem(t('editor.upload.pending'));
    // the text as it reads now: "Erneut versuchen" of an earlier attempt sends what was written since, too
    const body = drafts.get(key);
    if (!body) {
      setProblem(t('items.comments.empty'));
      focusEditor();
      return;
    }
    const done = drafts.startSending(key);
    const epoch = drafts.epoch();
    setProblem(null);
    setAnnouncement('');
    // a promise, not callbacks of mutate: those are skipped once the preview has closed, and the draft would stay
    add
      .mutateAsync({ work_item_id: item.id, body })
      .then(
        () => {
          // another person signed in meanwhile: their drafts are not this one's
          if (drafts.epoch() !== epoch) return;
          const fromEnd = mounted.current ? caretFromEnd() : null;
          // only what went out leaves the draft; what was typed meanwhile stays (every open view shows the rest)
          drafts.set(key, unsentRest(body, drafts.get(key)));
          if (!mounted.current) return;
          setAnnouncement(t('items.comments.sent'));
          // the caret stays where the person typed on, not at the end (T18-M3)
          if (fromEnd !== null) requestAnimationFrame(() => restoreCaret(fromEnd));
          else if (box.current?.contains(document.activeElement)) requestAnimationFrame(focusEditor);
        },
        (error: unknown) => {
          if (drafts.epoch() !== epoch) return;
          // a refusal of the text stays with the draft (every view shows it at the editor); with no view, a toast says it
          if (error instanceof ApiError && error.status === 422) {
            drafts.setProblem(key, error.errors?.body_json?.[0] ?? error.message);
            if (mounted.current) return;
          }
          // the text stays; "Erneut versuchen" where it can help (an outage)
          notifyError(t('items.comments.failed'), error, send);
        },
      )
      .finally(done);
  }

  if (denied) {
    return (
      <>
        <p className="mt-3 text-sm text-pretty text-muted">{denied}</p>
        {/* a draft that can no longer go (archived, the right gone; A154): readable, copyable, discardable; never while the rights load */}
        {stored && !loading && (
          <Banner tone="danger" role="alert" title={t('items.comments.parked')} className="mt-2">
            <div ref={parked} className="mt-2 rounded-md border border-line bg-surface p-2">
              <RichTextView value={stored} preset="comment" />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyButton text={docToText(stored)} target={() => parked.current} size="sm" />
              <Button variant="secondary" size="sm" onClick={() => drafts.set(key, null)}>
                {t('items.comments.discard')}
              </Button>
            </div>
          </Banner>
        )}
      </>
    );
  }

  const status = (
    <span role="status" className="mr-auto text-sm text-muted">
      {announcement}
    </span>
  );

  if (!open) {
    return (
      <div className="mt-3">
        <button
          ref={opener}
          type="button"
          aria-keyshortcuts="M"
          onClick={() => setOpen(true)}
          className="flex h-11 w-full cursor-text items-center gap-2 rounded-ctl border border-line bg-surface px-3 text-left text-ui text-muted shadow-[inset_0_-1.5px_0_var(--line-input)] transition-colors duration-120 hover:border-line-strong hover:text-ink md:h-9"
        >
          <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t(empty ? 'items.comments.write' : 'items.comments.continue')}</span>
          <Kbd keys="m" aria-hidden="true" />
        </button>
        <div className="mt-1 min-h-5">{status}</div>
      </div>
    );
  }

  const blocked = uploading > 0 ? t('editor.upload.pending') : empty ? t('items.comments.empty') : null;

  return (
    <div ref={box} data-comment-composer="" className="mt-3">
      <UploadContext value={uploads}>
        <RichTextEditor
          value={text}
          onChange={(doc) => {
            setText(doc);
            written.current = isEmptyDoc(doc) ? null : doc;
            drafts.set(key, written.current);
            setProblem(null);
            setAnnouncement('');
          }}
          preset="comment"
          projectId={item.project_id}
          onSubmit={send}
          onEscape={empty ? fold : undefined}
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
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2 max-sm:[&_button]:min-h-11">
        {status}
        <Button variant="ghost" size="sm" onClick={fold}>
          {t(empty ? 'common.cancel' : 'items.comments.later')}
        </Button>
        <Button variant="primary" size="sm" shortcut="mod+enter" pending={busy} disabledReason={blocked} onClick={send}>
          {t('items.comments.send')}
        </Button>
      </div>
    </div>
  );
}
