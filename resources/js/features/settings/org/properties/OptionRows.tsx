/*
 * The options of a dropdown in the property dialog: label and tone, in an order to drag or move with the keyboard. An
 * option the server knows can only be archived (items may carry it) and brought back; a new one is removed. New options
 * get a local id (P3), so the default value can name them before they are saved. "Add option" puts the focus on the
 * label of the new one.
 */

import { Archive, ArchiveRestore, CircleAlert, Plus, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { SortableList } from '@/components/ui/SortableList';
import { fieldClass } from '@/components/ui/styles';
import { t } from '@/lib/i18n';
import type { TypeTone } from '@/types';
import { TONES } from '../../catalog/choices';
import { localId } from '../../catalog/localId';
import { ToneSelect } from '../../catalog/ToneSelect';
import { focusNeighbour } from '../../frame/form';
import { Badge } from '../../frame/parts';

export interface DraftOption {
  id: string;
  label: string;
  color: TypeTone;
  archivedAt: string | null;
  /** Known to the server: it can only be archived, never removed, because items may carry it. */
  saved: boolean;
}

type OptionRowsProps = {
  options: DraftOption[];
  onChange: (next: DraftOption[]) => void;
  /** The server's refusal of an option's label, by its place in the list (`options.<index>.label`). */
  labelError: (index: number) => string | undefined;
};

export function OptionRows({ options, onChange, labelError }: OptionRowsProps) {
  const added = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const patch = (id: string, partial: Partial<DraftOption>) => onChange(options.map((option) => (option.id === id ? { ...option, ...partial } : option)));

  // the label of the option just added takes the focus, once it is drawn
  useEffect(() => {
    if (added.current === null) return;
    document.getElementById(`option-label-${added.current}`)?.focus();
    added.current = null;
  }, [options]);

  function add() {
    const id = localId('opt');
    added.current = id;
    onChange([...options, { id, label: '', color: TONES[options.length % TONES.length]!, archivedAt: null, saved: false }]);
  }

  return (
    <div className="flex flex-col gap-2">
      {options.length > 0 && (
        <SortableList
          items={options}
          label={t('settings.properties.options.list')}
          nameOf={(option) => option.label.trim()}
          onReorder={onChange}
          className="divide-y divide-line rounded-ctl border border-line bg-surface"
          renderItem={(option, { handle, index }) => {
            const archived = option.archivedAt !== null;
            const number = index + 1;
            const name = option.label.trim() || t('settings.properties.options.unnamed', { number });
            const error = labelError(index);
            const errorId = `option-label-${option.id}-error`;
            return (
              <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                {handle}
                <ToneSelect label={t('settings.properties.options.color_of', { name })} value={option.color} onChange={(color) => patch(option.id, { color })} />
                <input
                  id={`option-label-${option.id}`}
                  name={`option_label_${number}`}
                  autoComplete="off"
                  value={option.label}
                  aria-label={t('settings.properties.options.label_of', { number })}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  placeholder={t('settings.properties.options.placeholder')}
                  onChange={(event) => patch(option.id, { label: event.target.value })}
                  className={cx(fieldClass(Boolean(error)), 'h-11 min-w-0 flex-1 basis-36 px-3 text-input md:h-9 md:text-md', archived && 'bg-sunken text-muted')}
                />
                {archived && <Badge tone="quiet">{t('settings.properties.options.archived')}</Badge>}
                {option.saved ? (
                  <IconButton
                    icon={archived ? ArchiveRestore : Archive}
                    label={archived ? t('settings.properties.options.restore', { name }) : t('settings.properties.options.archive', { name })}
                    onClick={() => patch(option.id, { archivedAt: archived ? null : new Date().toISOString() })}
                  />
                ) : (
                  <IconButton
                    icon={X}
                    label={t('settings.properties.options.remove', { number })}
                    onClick={(event) => {
                      // on to the next option (or the one before), after the last to "Add option"
                      focusNeighbour(event.currentTarget.closest('li'), addButton.current);
                      onChange(options.filter((candidate) => candidate.id !== option.id));
                    }}
                  />
                )}
                {error && (
                  <p id={errorId} className="flex basis-full items-start gap-1.5 pl-1 text-sm font-medium text-danger">
                    <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                    {error}
                  </p>
                )}
              </div>
            );
          }}
        />
      )}
      <div>
        <Button ref={addButton} id="property-add-option" variant="secondary" size="sm" icon={Plus} onClick={add}>
          {t('settings.properties.options.add')}
        </Button>
      </div>
    </div>
  );
}
