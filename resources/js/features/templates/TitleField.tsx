/*
 * The title a template gives its items (spec 4.12), ported from the clickdummy: placeholders such as `{week}` stand in
 * it, and every run fills them with its date. Below it the preview: how the item is called at the next run, or now for
 * a template without a schedule (or a paused one). Only the server counts terms and fills placeholders (A335), so the
 * preview and the examples of the placeholder chips come from `useSchedulePreview`; without an answer the title shows
 * as typed. A chip inserts its placeholder where the cursor is, and the cursor goes behind it.
 */

import { useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { useToday } from '@/components/fields/itemData';
import { Input } from '@/components/ui/Input';
import { useSchedulePreview } from '@/hooks/templates';
import { t, type TranslationKey } from '@/lib/i18n';
import type { Schedule } from '@/types';
import { useTemplateTimes } from './format';

/** The placeholders of a title (spec 4.12, `Placeholders::NAMES`), with what they stand for. */
const PLACEHOLDERS: { token: string; meaning: TranslationKey }[] = [
  { token: '{date}', meaning: 'templates.editor.placeholder.date' },
  { token: '{week}', meaning: 'templates.editor.placeholder.week' },
  { token: '{month}', meaning: 'templates.editor.placeholder.month' },
  { token: '{month_name}', meaning: 'templates.editor.placeholder.month_name' },
  { token: '{quarter}', meaning: 'templates.editor.placeholder.quarter' },
  { token: '{year}', meaning: 'templates.editor.placeholder.year' },
];
/** All placeholders in one title, one per line: the server fills them at the same term as the title. */
const ALL_PLACEHOLDERS = PLACEHOLDERS.map(({ token }) => token).join('\n');

/** A schedule without terms that starts today: the server fills a title with it as now. */
const asNow = (today: string): Schedule => ({ frequency: 'daily', interval: 1, time: '00:00', starts_on: today, ends: { type: 'never' }, paused: true });

type TitleFieldProps = {
  value: string;
  onChange: (title: string) => void;
  /** The schedule as edited; null without one. */
  schedule: Schedule | null;
  /** The runs the template has had (a schedule that ends after N runs counts on). */
  runCount: number;
  error?: string;
  readOnly: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function TitleField({ value, onChange, schedule, runCount, error, readOnly, inputRef }: TitleFieldProps) {
  const previewId = useId();
  const { today } = useToday();
  const times = useTemplateTimes();
  const at = schedule ?? asNow(today);
  const typed = value.trim();
  const preview = useSchedulePreview({ schedule: at, title: typed, run_count: runCount });
  const examples = useSchedulePreview({ schedule: at, title: ALL_PLACEHOLDERS, run_count: runCount });

  const next = preview.isError ? undefined : preview.data?.runs[0];
  const shown = typed === '' ? t('templates.editor.preview.untitled') : preview.isError ? typed : (preview.data?.title ?? typed);
  const filled = examples.isError ? undefined : examples.data?.title?.split('\n');

  // the cursor goes behind an inserted placeholder once the new title is drawn
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (caret.current === null || !input) return;
    input.focus();
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function insert(token: string) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    caret.current = start + token.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
  }

  return (
    <div>
      <Input
        ref={inputRef}
        label={t('templates.editor.title')}
        name="title"
        autoComplete="off"
        readOnly={readOnly}
        value={value}
        hint={t('templates.editor.title_hint')}
        error={error}
        aria-describedby={previewId}
        onChange={(event) => onChange(event.target.value)}
        className="read-only:bg-sunken read-only:shadow-none"
      />
      <section aria-label={t('templates.editor.preview.label')} className="mt-2 rounded-ctl bg-sunken px-3 py-2.5">
        <p className="text-sm text-muted">{next ? t('templates.editor.preview.next', { when: times.short(next) }) : t('templates.editor.preview.now')}</p>
        <p id={previewId} className="mt-0.5 font-display text-lg font-bold tracking-title break-words text-ink">
          {shown}
        </p>
        {!readOnly && (
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t('templates.editor.placeholders')}>
            {PLACEHOLDERS.map(({ token, meaning }, index) => {
              const example = filled?.[index];
              return (
                <button
                  key={token}
                  type="button"
                  aria-label={
                    example === undefined
                      ? t('templates.editor.placeholder.insert_plain', { token, meaning: t(meaning) })
                      : t('templates.editor.placeholder.insert', { token, meaning: t(meaning), example })
                  }
                  onClick={() => insert(token)}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-chip border border-line bg-surface px-2 text-sm text-ink transition-colors duration-120 hover:border-line-input md:min-h-7"
                >
                  <span translate="no" className="font-semibold">
                    {token}
                  </span>
                  {example !== undefined && <span className="text-muted">{example}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
