/*
 * The title of an item, edited in place (`e`, or a click): Enter saves, Escape takes it back (and is used up, so the
 * preview stays open), leaving the field saves. At most 255 characters, never empty; a refusal of the server goes back
 * into the field. Who may not change the item reads the title as plain text.
 *
 * On the page the heading is where the focus goes back to when nothing else holds it (`data-focus-origin`): after the
 * questions of the item commands (resolution, type change) asked from the page itself, see `ItemDialogs.tsx`.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '@/api/client';
import { useEditReason } from '@/components/fields/itemData';
import { cx } from '@/components/ui/cx';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { useSettle } from '@/hooks/mutation';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { WorkItem } from '@/types';
import { useDetail } from '../shared';

/** As the server allows it (`ItemInput::TITLE_MAX`). */
export const MAX_TITLE = 255;

export function ItemTitle({ item }: { item: WorkItem }) {
  const settle = useSettle();
  const { surface, actions } = useDetail();
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editing = useRef(false);
  const refocus = useRef(false);
  const errorId = useId();
  const hintId = useId();
  const Heading = surface === 'page' ? 'h1' : 'h2';
  const look = surface === 'page' ? 'text-2xl tracking-display' : 'text-xl tracking-title';

  const start = () => {
    if (reason) return void toast({ title: t('items.commands.denied'), description: reason, tone: 'error' });
    editing.current = true;
    setError(null);
    setDraft(item.title);
  };

  useEffect(() => {
    const own = actions.current;
    own.editTitle = start;
    return () => {
      if (own.editTitle === start) own.editTitle = undefined;
    };
  });

  useEffect(() => {
    if (draft !== null && field.current && document.activeElement !== field.current) {
      // the caret at the end: most edits correct or extend the title
      field.current.focus();
      field.current.setSelectionRange(field.current.value.length, field.current.value.length);
    }
    if (draft === null && refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  }, [draft]);

  function finish(save: boolean, { keepFocus = true } = {}) {
    if (!editing.current || draft === null) return;
    const title = draft.trim();
    if (save && title === '') return setError(t('items.detail.title.required'));
    if (save && title.length > MAX_TITLE) return setError(t('items.detail.title.too_long', { max: MAX_TITLE, count: title.length }));
    editing.current = false;
    refocus.current = keepFocus;
    setDraft(null);
    setError(null);
    if (!save || title === item.title) return;
    settle(update.mutateAsync({ id: item.id, patch: { title } }), {
      // the hook rolls back and names the cause in a toast; a field error goes back into the field
      onError: (failure) => {
        const message = failure instanceof ApiError ? failure.errors?.title?.[0] : undefined;
        if (!message) return;
        editing.current = true;
        setDraft(title);
        setError(message);
      },
    });
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      // the field takes the Escape for itself: the preview stays open
      event.preventDefault();
      finish(false);
    }
  };

  if (draft !== null) {
    return (
      <div className="flex flex-col">
        <textarea
          ref={field}
          value={draft}
          rows={1}
          name="title"
          autoComplete="off"
          aria-label={t('items.detail.title.label')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          maxLength={MAX_TITLE + 50}
          onChange={(event) => {
            setDraft(event.target.value.replace(/\n/g, ' '));
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => finish(true, { keepFocus: false })}
          className={cx(
            '-mx-2 block w-[calc(100%+1rem)] resize-none rounded-ctl border bg-surface px-2 py-1 font-display font-bold text-balance text-ink [field-sizing:content]',
            look,
            error ? 'border-danger shadow-[inset_0_-1.5px_0_var(--danger)]' : 'border-line shadow-[inset_0_-1.5px_0_var(--line-input)]',
          )}
        />
        <div aria-live="polite">
          {error && (
            <p id={errorId} className="mt-1.5 text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Heading
      tabIndex={-1}
      data-item-title=""
      data-focus-origin={surface === 'page' ? '' : undefined}
      data-focus-ring="none"
      className={cx('font-display font-bold text-balance break-words text-ink outline-none', look)}
    >
      {reason ? (
        item.title
      ) : (
        <Tooltip content={t('items.detail.title.edit')} shortcut={SHORTCUTS['item.title'].keys} side="bottom">
          <button
            ref={trigger}
            type="button"
            onClick={start}
            aria-keyshortcuts="E"
            aria-describedby={hintId}
            className="-mx-1 cursor-text rounded-chip px-1 text-left text-balance transition-colors duration-120 hover:bg-hover"
          >
            {item.title}
          </button>
        </Tooltip>
      )}
      {/* what the button does, for screen readers (the tooltip is visual only) */}
      {!reason && (
        <span id={hintId} hidden>
          {t('items.detail.title.edit')}
        </span>
      )}
    </Heading>
  );
}
