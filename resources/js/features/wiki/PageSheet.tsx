/*
 * An open wiki page on its sheet (spec 4.15, 4.16; ported from the clickdummy's PageView.tsx): the path and the save
 * state (`PageHeader`, `SaveStatus`), the emoji, the title, who changed it last on which day, and the text in the
 * editor of level `page`. Everything saves itself (`usePageSave`).
 * - The emoji is chosen in a popover (`EmojiPicker`, saved at once); while it is open the page's single keys wait, its
 *   grid takes letters.
 * - The title is one line (a line break becomes a space), at most 200 characters; Enter goes on into the text. A page
 *   just made (`focusTitle`) selects it, ready to be typed over.
 * - Pictures pasted, dropped or chosen in the text upload into the project and belong to nobody until the page saves
 *   (A232); the page waits for them before it saves (`UploadContext`).
 * - ⌘↵ saves now (`wiki.save`), ⌘⌫ asks to delete the page (`wiki.delete`, `onDelete`), both only for whoever may edit;
 *   with the preview of an item open, ⌘⌫ is the item's (K3).
 * - A viewer reads: the title as heading, the text in the viewer (or "Diese Seite ist noch leer."), why they cannot
 *   edit; no save state, no emoji to choose.
 */

import { Eye, SmilePlus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useUserMap } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { isEmptyDoc, RichTextEditor } from '@/editor/RichTextEditor';
import { RichTextView } from '@/editor/RichTextView';
import { UploadContext, useUploadCounter } from '@/editor/UploadContext';
import { useInstantDay } from '@/features/item-detail/shared';
import { t } from '@/lib/i18n';
import { useDialogScope, useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { Page as WikiPage } from '@/types';
import { SHEET } from './format';
import { PageHeader } from './PageHeader';
import type { PageViewProps } from './PageView';
import { SaveStatus } from './SaveStatus';
import { MAX_TITLE, usePageSave } from './usePageSave';

/** Mounted while the emoji choice is open: its grid takes letters, so the page's single-key shortcuts wait. */
function PausePageShortcuts() {
  useDialogScope();
  return null;
}

export function PageSheet({ page, projectId, identifier, ancestors, rights, focusTitle = false, onDelete }: PageViewProps & { page: WikiPage }) {
  const canEdit = rights.denied === null;
  const uploads = useUploadCounter();
  const { draft, change, save, state, savedAt, spoken, titleError } = usePageSave(page, { canEdit, uploads });
  const users = useUserMap();
  const day = useInstantDay();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ids = useId();
  const [emojiOpen, setEmojiOpen] = useState(false);

  // a page just made: the title takes the focus, ready to be typed over
  useEffect(() => {
    if (!focusTitle || !titleRef.current) return;
    titleRef.current.focus();
    titleRef.current.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the page opens
  }, []);

  useShortcut('wiki.save', () => void save(), { when: () => canEdit });
  useShortcut('wiki.delete', () => onDelete?.(), { when: () => canEdit && onDelete !== undefined && useUiStore.getState().peekItemId === null });

  function onTitleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    // a title has one line: Enter goes on into the text
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      bodyRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
    }
  }

  const pickEmoji = (emoji: string | null) => {
    setEmojiOpen(false);
    change({ emoji }, { now: true });
  };

  const editor = users.get(page.updated_by)?.name ?? t('wiki.home.unknown_person');

  return (
    <article aria-labelledby={`${ids}-title`} className={SHEET}>
      <PageHeader identifier={identifier} ancestors={ancestors}>
        {canEdit && <SaveStatus state={state} savedAt={savedAt} spoken={spoken} />}
      </PageHeader>

      <div className="mt-5 flex items-start gap-2 md:mt-7 md:gap-3">
        {canEdit ? (
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={draft.emoji ? t('wiki.page.emoji.change') : t('wiki.page.emoji.choose')}
                  className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-ctl text-[1.75rem] leading-none transition-colors duration-120 hover:bg-hover md:size-12 md:text-[2rem]"
                />
              }
            >
              {draft.emoji ?? <SmilePlus className="size-6 text-muted" aria-hidden="true" />}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" title={t('wiki.page.emoji.title')}>
              <PausePageShortcuts />
              <EmojiPicker className="mt-2" onPick={pickEmoji} />
              {draft.emoji && (
                <Button variant="ghost" size="sm" icon={X} className="mt-2" onClick={() => pickEmoji(null)}>
                  {t('wiki.page.emoji.remove')}
                </Button>
              )}
            </PopoverContent>
          </Popover>
        ) : (
          page.emoji && (
            <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center text-[1.75rem] leading-none md:size-12 md:text-[2rem]">
              {page.emoji}
            </span>
          )
        )}
        <div className="min-w-0 flex-1">
          <h1 id={`${ids}-title`} data-screen-heading="" tabIndex={-1} className="min-w-0 scroll-mt-20">
            {canEdit ? (
              <textarea
                ref={titleRef}
                value={draft.title}
                rows={1}
                name="title"
                autoComplete="off"
                spellCheck
                maxLength={MAX_TITLE}
                aria-label={t('wiki.page.title_label')}
                placeholder={t('wiki.page.title_placeholder')}
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? `${ids}-error` : undefined}
                onChange={(event) => change({ title: event.target.value.replace(/\r?\n/g, ' ') })}
                onKeyDown={onTitleKeyDown}
                onBlur={() => void save()}
                className={cx(
                  'block w-full resize-none rounded-ctl bg-transparent px-1 py-0.5 font-display text-2xl font-extrabold tracking-display text-balance text-ink [field-sizing:content] placeholder:text-muted md:text-3xl',
                  titleError && 'shadow-[inset_0_-1.5px_0_var(--danger)]',
                )}
              />
            ) : (
              <span className="block px-1 py-0.5 font-display text-2xl font-extrabold tracking-display text-balance break-words text-ink md:text-3xl">{page.title}</span>
            )}
          </h1>
          <div aria-live="polite">
            {titleError && (
              <p id={`${ids}-error`} className="mt-1 px-1 text-sm font-medium text-danger">
                {titleError}
              </p>
            )}
          </div>
          <p className="mt-1 px-1 text-sm text-pretty text-muted">{t('wiki.page.changed', { name: editor, day: day(page.updated_at) })}</p>
          {rights.denied && (
            <p className="mt-1 flex items-start gap-1.5 px-1 text-sm text-pretty text-muted">
              <Eye className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {rights.denied}
            </p>
          )}
        </div>
      </div>

      <div
        ref={bodyRef}
        data-wiki-body=""
        // the editor of a page has no frame: its focus ring keeps a little air around the text, which stays on the
        // line of the title
        className="mt-6 md:mt-8 [&_.ProseMirror]:-mx-3 [&_.ProseMirror]:-my-2 [&_.ProseMirror]:rounded-ctl [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void save();
        }}
      >
        {canEdit ? (
          <UploadContext value={uploads}>
            <RichTextEditor value={draft.content} onChange={(doc) => change({ content: doc })} preset="page" projectId={projectId} onSubmit={() => void save()} />
          </UploadContext>
        ) : page.content_json && !isEmptyDoc(page.content_json) ? (
          <RichTextView value={page.content_json} preset="page" />
        ) : (
          <p className="text-ui text-muted">{t('wiki.page.empty')}</p>
        )}
      </div>
    </article>
  );
}
