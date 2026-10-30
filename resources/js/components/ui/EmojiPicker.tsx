import { useRef, useState, type KeyboardEvent } from 'react';
import { getLocale, t, type TranslationKey } from '@/lib/i18n';
import { cx } from './cx';
import { Input } from './Input';

/** `thumbs_up` for the key `ui.emoji_picker.emoji.thumbs_up`: a slug without its key does not compile. */
type Slug<Prefix extends string> = TranslationKey extends infer Key ? (Key extends `${Prefix}${infer Rest}` ? Rest : never) : never;
type Emoji = { char: string; name: string };
type EmojiGroup = { label: string; emojis: Emoji[] };

/** A small hand-picked set for reactions and page titles; any other emoji can be typed into the search. */
const GROUPS: { label: Slug<'ui.emoji_picker.group.'>; emojis: [char: string, name: Slug<'ui.emoji_picker.emoji.'>][] }[] = [
  {
    label: 'common',
    emojis: [
      ['👍', 'thumbs_up'],
      ['👎', 'thumbs_down'],
      ['❤️', 'heart'],
      ['🎉', 'party'],
      ['😄', 'grin'],
      ['👀', 'eyes'],
      ['🚀', 'rocket'],
      ['✅', 'done'],
    ],
  },
  {
    label: 'faces',
    emojis: [
      ['😂', 'laughing_tears'],
      ['🙂', 'smile'],
      ['😉', 'wink'],
      ['🤔', 'thinking'],
      ['😅', 'relieved'],
      ['😮', 'surprised'],
      ['😢', 'sad'],
      ['🥳', 'celebrating'],
    ],
  },
  {
    label: 'gestures',
    emojis: [
      ['👏', 'applause'],
      ['🙌', 'hands_up'],
      ['🙏', 'thanks'],
      ['💪', 'strong'],
      ['👋', 'wave'],
      ['🤝', 'handshake'],
      ['👌', 'okay'],
      ['🤞', 'fingers_crossed'],
    ],
  },
  {
    label: 'work',
    emojis: [
      ['📌', 'pin'],
      ['📝', 'note'],
      ['📅', 'calendar'],
      ['📊', 'chart'],
      ['🐛', 'bug'],
      ['🔧', 'wrench'],
      ['💡', 'idea'],
      ['🏁', 'finish'],
    ],
  },
  {
    label: 'nature_food',
    emojis: [
      ['🌱', 'seedling'],
      ['🌳', 'tree'],
      ['☀️', 'sun'],
      ['🌈', 'rainbow'],
      ['☕', 'coffee'],
      ['🍕', 'pizza'],
      ['🍰', 'cake'],
      ['🦊', 'fox'],
    ],
  },
  {
    label: 'symbols',
    emojis: [
      ['✨', 'sparkles'],
      ['🔥', 'fire'],
      ['⚡', 'lightning'],
      ['⚠️', 'warning'],
      ['❌', 'cross'],
      ['💯', 'hundred'],
      ['💬', 'speech_bubble'],
      ['🎯', 'bullseye'],
    ],
  },
];

/** The set with its names in the language of the page. */
const groupsOf = (): EmojiGroup[] =>
  GROUPS.map((group) => ({
    label: t(`ui.emoji_picker.group.${group.label}`),
    emojis: group.emojis.map(([char, name]) => ({ char, name: t(`ui.emoji_picker.emoji.${name}`) })),
  }));

/**
 * One typed emoji: a flag (two regional indicators), a keycap (1️⃣), or a pictograph with variation selector, skin tone
 * and zero-width joins. The invisible characters are escapes, so no editor can drop them.
 */
const TYPED_EMOJI = /\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*/u;

/** Visual rows of the grid as flat indices, so up/down keep the column across groups. */
function rowsOf(groups: EmojiGroup[], columns: number): number[][] {
  const rows: number[][] = [];
  let index = 0;
  for (const group of groups) {
    for (let start = 0; start < group.emojis.length; start += columns) {
      const size = Math.min(columns, group.emojis.length - start);
      rows.push(Array.from({ length: size }, (_, offset) => index + offset));
      index += size;
    }
  }
  return rows;
}

type EmojiPickerProps = {
  onPick: (emoji: string) => void;
  /** Text already in the search (the gallery shows a search without matches). */
  defaultQuery?: string;
  className?: string;
};

/** Emoji for reactions and page titles: search by name in the language of the page, arrow keys move, Enter picks. */
export function EmojiPicker({ onPick, defaultQuery = '', className }: EmojiPickerProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState<Emoji | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const needle = query.trim().toLocaleLowerCase(getLocale());
  const all = groupsOf();
  const groups = needle
    ? [{ label: t('ui.emoji_picker.group.matches'), emojis: all.flatMap((group) => group.emojis).filter((emoji) => emoji.name.toLocaleLowerCase(getLocale()).includes(needle)) }].filter(
        (group) => group.emojis.length > 0,
      )
    : all;
  const flat = groups.flatMap((group) => group.emojis);
  const typed = query.match(TYPED_EMOJI)?.[0];
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  const focusIndex = (index: number) => {
    setActive(index);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`)?.focus();
  };

  /** 7 columns on phones (44 px targets), 8 from md on: read from the rendered grid. */
  const columnCount = () => {
    const grid = gridRef.current?.querySelector<HTMLElement>('[data-emoji-grid]');
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 8;
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = rowsOf(groups, columnCount());
    const row = rows.findIndex((indices) => indices.includes(current));
    const column = rows[row]?.indexOf(current) ?? 0;
    const inRow = (target: number[] | undefined) => (target ? target[Math.min(column, target.length - 1)] : current);
    const next: Record<string, () => number> = {
      ArrowRight: () => Math.min(current + 1, flat.length - 1),
      ArrowLeft: () => Math.max(current - 1, 0),
      ArrowDown: () => inRow(rows[row + 1]),
      ArrowUp: () => inRow(rows[row - 1]),
      Home: () => 0,
      End: () => flat.length - 1,
    };
    const move = next[event.key];
    if (!move) return;
    event.preventDefault();
    focusIndex(move());
  };

  return (
    <div className={cx('flex w-[19.25rem] max-w-full flex-col gap-2', className)}>
      <Input
        type="search"
        name="emoji-search"
        aria-label={t('ui.emoji_picker.search_label')}
        placeholder={t('ui.emoji_picker.search_placeholder')}
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (flat[0] || typed)) {
            event.preventDefault();
            onPick(flat[0]?.char ?? typed!);
          }
          if (event.key === 'ArrowDown' && flat.length > 0) {
            event.preventDefault();
            focusIndex(0);
          }
        }}
      />
      <div ref={gridRef} onKeyDown={onGridKeyDown} className="max-h-64 overflow-y-auto overscroll-contain">
        {groups.map((group) => {
          const offset = flat.indexOf(group.emojis[0]);
          return (
            <div key={group.label} role="group" aria-label={group.label} className="pb-1">
              <p aria-hidden="true" className="px-1 pt-1 pb-0.5 text-sm text-muted">
                {group.label}
              </p>
              <div data-emoji-grid className="grid grid-cols-7 md:grid-cols-8">
                {group.emojis.map((emoji, position) => {
                  const index = offset + position;
                  return (
                    <button
                      key={emoji.char}
                      type="button"
                      data-index={index}
                      tabIndex={index === current ? 0 : -1}
                      aria-label={emoji.name}
                      onClick={() => onPick(emoji.char)}
                      onFocus={() => {
                        setActive(index);
                        setShown(emoji);
                      }}
                      onPointerEnter={() => setShown(emoji)}
                      className="inline-flex aspect-square w-full cursor-pointer items-center justify-center rounded-ctl text-xl transition-colors duration-120 hover:bg-hover"
                    >
                      {emoji.char}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {flat.length === 0 && (
          <div className="flex flex-col items-start gap-2 px-1 py-3 text-ui text-muted">
            <p className="break-words">{t('ui.emoji_picker.none', { query: query.trim() })}</p>
            {typed && (
              <button
                type="button"
                onClick={() => onPick(typed)}
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-ctl px-2 font-semibold text-accent-text transition-colors duration-120 hover:bg-hover md:h-8"
              >
                <span className="text-lg" aria-hidden="true">
                  {typed}
                </span>
                {t('ui.emoji_picker.use_typed')}
              </button>
            )}
          </div>
        )}
      </div>
      <p aria-hidden="true" className="flex h-6 items-center gap-2 border-t border-line pt-2 text-sm text-muted">
        {shown ? (
          <>
            <span className="text-md">{shown.char}</span>
            {shown.name}
          </>
        ) : (
          t('ui.emoji_picker.hint')
        )}
      </p>
    </div>
  );
}
