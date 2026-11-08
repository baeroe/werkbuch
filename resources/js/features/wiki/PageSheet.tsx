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
 * - The menu of the page (`PageMenu`) and the palette offer "Unterseite anlegen" (`wiki.page.child`, `onCreateChild`),
 *   "Verschieben nach …" (`wiki.page.move`, `onMove`) and "Löschen …" (`wiki.page.delete`, `onDelete`), only for whoever
 *   may edit and only as far as the wiki passes them.
 * - A conflict (409) stands as a banner above the text (`ConflictBanner`): "Neu laden" or "Meine Fassung übernehmen",
 *   both give the focus on into the text (`usePageSave`). An undo of "Neu laden" that waits for a title puts the focus
 *   in the title.
 * - "Versionen …" in the head row and the palette's `wiki.page.versions` open the kept versions (`VersionsDialog`);
 *   a restore saves what is typed first and waits while a conflict stands ("Erst den Konflikt klären").
 * - A viewer reads: the title as heading, the text in the viewer (or "Diese Seite ist noch leer."), why they cannot
 *   edit, the versions without restoring; no save state, no emoji to choose. Text typed that the person can no
 *   longer save (the project archived, the role lowered while the page was open) stands above that, read-only, with
 *   "Kopieren" and "Verwerfen" (`ParkedDraft`, like A154).
 */

import { Eye, FilePlus2, FolderInput, History, SmilePlus, Trash2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useUserMap } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { toast } from '@/components/ui/toast';
import { isEmptyDoc, RichTextEditor } from '@/editor/RichTextEditor';
import { RichTextView } from '@/editor/RichTextView';
import { UploadContext, useUploadCounter } from '@/editor/UploadContext';
import { useInstantDay } from '@/features/item-detail/shared';
import { useCurrentUser } from '@/hooks/users';
import { useCommand } from '@/lib/commands';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useDialogScope, useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { Page as WikiPage } from '@/types';
import { ConflictBanner } from './ConflictBanner';
import { SHEET } from './format';
import { PageHeader, PageMenu } from './PageHeader';
import type { PageViewProps } from './PageView';
import { ParkedDraft } from './ParkedDraft';
import { SaveStatus } from './SaveStatus';
import { MAX_TITLE, usePageSave } from './usePageSave';
import { VersionsDialog } from './VersionsDialog';

/** Mounted while the emoji choice is open: its grid takes letters, so the page's single-key shortcuts wait. */
function PausePageShortcuts() {
  useDialogScope();
  return null;
}

export function PageSheet({ page, projectId, identifier, ancestors, rights, focusTitle = false, onMove, onDelete, onCreateChild }: PageViewProps & { page: WikiPage }) {
  const canEdit = rights.denied === null;
  const uploads = useUploadCounter();
  const me = useCurrentUser()?.id;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const { draft, change, save, state, savedAt, spoken, titleError, conflict, reload, keepMine, flush } = usePageSave(page, {
    canEdit,
    uploads,
    me,
    href: paths.wiki(identifier, page.id),
    // an undo after "Neu laden" waits for a title: the title takes the focus
    onTitleRequired: () => titleRef.current?.focus(),
  });
  const users = useUserMap();
  const day = useInstantDay();
  const bodyRef = useRef<HTMLDivElement>(null);
  const ids = useId();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  // a page just made: the title takes the focus, ready to be typed over
  useEffect(() => {
    if (!focusTitle || !titleRef.current) return;
    titleRef.current.focus();
    titleRef.current.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the page opens
  }, []);

  useShortcut('wiki.save', () => void save(), { when: () => canEdit });
  useCommand({
    id: 'wiki.page.versions',
    label: t('wiki.versions.command'),
    group: t('wiki.page.command_group', { title: page.title }),
    icon: <History />,
    keywords: [t('wiki.versions.keywords')],
    run: () => setVersionsOpen(true),
  });
  useShortcut('wiki.delete', () => onDelete?.(), { when: () => canEdit && onDelete !== undefined && useUiStore.getState().peekItemId === null });
  const group = t('wiki.page.command_group', { title: page.title });
  useCommand(
    { id: 'wiki.page.move', label: t('wiki.move.command'), group, icon: <FolderInput />, keywords: [t('wiki.move.keywords')], run: () => onMove?.(), when: () => canEdit && onMove !== undefined },
    [canEdit, onMove !== undefined],
  );
  useCommand(
    { id: 'wiki.page.child', label: t('wiki.child.command'), group, icon: <FilePlus2 />, keywords: [t('wiki.child.keywords')], run: () => onCreateChild?.(), when: () => canEdit && onCreateChild !== undefined },
    [canEdit, onCreateChild !== undefined],
  );
  useCommand(
    {
      id: 'wiki.page.delete',
      label: t('wiki.delete.command'),
      group,
      keys: SHORTCUTS['wiki.delete'].keys,
      icon: <Trash2 />,
      keywords: [t('wiki.delete.keywords')],
      run: () => onDelete?.(),
      when: () => canEdit && onDelete !== undefined,
    },
    [canEdit, onDelete !== undefined],
  );

  function onTitleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    // a title has one line: Enter goes on into the text
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      bodyRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
    }
  }

  /** The banner's buttons go away with it: the focus goes on into the text. */
  const focusText = () => requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus());

  /** A restore takes the place of the text: what is typed is saved first, and a conflict is settled first. */
  async function beforeRestore(): Promise<boolean> {
    if (conflict) {
      toast({ title: t('wiki.conflict.first.title'), description: t('wiki.conflict.first.description'), tone: 'error' });
      return false;
    }
    // what keeps the typed text from saving first, said instead of restoring nothing in silence (T15-M3)
    const waiting = uploads && uploads.current() > 0 ? 'uploads' : draft.title.trim() === '' ? 'title_required' : null;
    if (waiting !== null) {
      toast({ title: t('wiki.versions.not_saved.title'), description: t(`wiki.versions.not_saved.${waiting}`), tone: 'error' });
      return false;
    }
    return flush();
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
        <Button variant="ghost" size="sm" icon={History} onClick={() => setVersionsOpen(true)}>
          {t('wiki.versions.open')}
        </Button>
        {canEdit && onMove && onDelete && onCreateChild && <PageMenu onCreateChild={onCreateChild} onMove={onMove} onDelete={onDelete} />}
      </PageHeader>
      <VersionsDialog page={page} open={versionsOpen} onOpenChange={setVersionsOpen} restoreReason={rights.denied} beforeRestore={beforeRestore} />

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

      {conflict && canEdit && (
        <ConflictBanner
          message={conflict.message}
          onReload={() => {
            reload();
            focusText();
          }}
          onKeepMine={() => {
            keepMine();
            focusText();
          }}
          className="mt-5"
        />
      )}
      {!canEdit && <ParkedDraft pageId={page.id} reason={rights.denied} className="mt-5" />}

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
