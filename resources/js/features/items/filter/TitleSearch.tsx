/*
 * The search field of the filter bar: the condition "Titel enthält" (`/` puts the focus here, P25). Enter or leaving
 * the field applies what is typed; Escape empties it, a second Escape leaves the field. A value from outside (a link,
 * "Filter zurücksetzen") shows unless somebody is typing.
 */

import { Search, X } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { MAX_TEXT } from '@/components/fields/property/parse';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Kbd } from '@/components/ui/Kbd';
import { fieldClass } from '@/components/ui/styles';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';

type TitleSearchProps = {
  value: string;
  onCommit: (text: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function TitleSearch({ value, onCommit, inputRef }: TitleSearchProps) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(value);
  }, [value, inputRef]);

  const apply = (next: string) => {
    if (next.trim() !== value) onCommit(next.trim());
  };

  return (
    <div className="relative flex h-11 min-w-0 flex-1 basis-40 items-center sm:max-w-64 md:h-7">
      <Search className="pointer-events-none absolute left-2 size-3.5 text-muted" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        name="item-search"
        aria-label={t('items.filter.search.label')}
        aria-keyshortcuts={SHORTCUTS['list.search'].keys}
        placeholder={t('items.filter.search.placeholder')}
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_TEXT}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => apply(text)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            apply(text);
          } else if (event.key === 'Escape') {
            // the first Escape empties the field, the next one leaves it
            event.preventDefault();
            if (text !== '') {
              setText('');
              apply('');
            } else event.currentTarget.blur();
          }
        }}
        className={cx(fieldClass(false), 'h-full rounded-ctl pr-8 pl-7 text-input md:text-sm [&::-webkit-search-cancel-button]:hidden')}
      />
      {text !== '' ? (
        <IconButton
          icon={X}
          size="sm"
          label={t('items.filter.search.clear')}
          tooltip={false}
          className="absolute right-0.5"
          onClick={() => {
            setText('');
            apply('');
            inputRef.current?.focus();
          }}
        />
      ) : (
        <Kbd keys={SHORTCUTS['list.search'].keys} className="pointer-events-none absolute right-1.5 max-md:hidden" aria-hidden="true" />
      )}
    </div>
  );
}
