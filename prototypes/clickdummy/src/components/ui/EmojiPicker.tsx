import { useRef, useState, type KeyboardEvent } from 'react';
import { cx } from './cx';
import { Input } from './Input';

type Emoji = { char: string; name: string };
type EmojiGroup = { label: string; emojis: Emoji[] };

const e = (char: string, name: string): Emoji => ({ char, name });

/** A small hand-picked set for reactions and page titles; any other emoji can be typed into the search. */
const GROUPS: EmojiGroup[] = [
  { label: 'Häufig', emojis: [e('👍', 'Daumen hoch'), e('👎', 'Daumen runter'), e('❤️', 'Herz'), e('🎉', 'Party'), e('😄', 'Grinsen'), e('👀', 'Augen'), e('🚀', 'Rakete'), e('✅', 'Erledigt')] },
  { label: 'Gesichter', emojis: [e('😂', 'Tränen lachen'), e('🙂', 'Lächeln'), e('😉', 'Zwinkern'), e('🤔', 'Nachdenken'), e('😅', 'Erleichtert'), e('😮', 'Staunen'), e('😢', 'Traurig'), e('🥳', 'Feiern')] },
  { label: 'Gesten', emojis: [e('👏', 'Applaus'), e('🙌', 'Hände hoch'), e('🙏', 'Danke'), e('💪', 'Stark'), e('👋', 'Winken'), e('🤝', 'Handschlag'), e('👌', 'In Ordnung'), e('🤞', 'Daumen drücken')] },
  { label: 'Arbeit', emojis: [e('📌', 'Pin'), e('📝', 'Notiz'), e('📅', 'Kalender'), e('📊', 'Diagramm'), e('🐛', 'Käfer'), e('🔧', 'Schraubenschlüssel'), e('💡', 'Idee'), e('🏁', 'Ziel')] },
  { label: 'Natur und Essen', emojis: [e('🌱', 'Keimling'), e('🌳', 'Baum'), e('☀️', 'Sonne'), e('🌈', 'Regenbogen'), e('☕', 'Kaffee'), e('🍕', 'Pizza'), e('🍰', 'Kuchen'), e('🦊', 'Fuchs')] },
  { label: 'Symbole', emojis: [e('✨', 'Funkeln'), e('🔥', 'Feuer'), e('⚡', 'Blitz'), e('⚠️', 'Warnung'), e('❌', 'Kreuz'), e('💯', 'Hundert'), e('💬', 'Sprechblase'), e('🎯', 'Zielscheibe')] },
];

/** One emoji including variation selectors, skin tones and zero-width joins. */
const TYPED_EMOJI = /\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*/u;

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

/** Emoji for reactions and page titles: search by German name, arrow keys move, Enter picks. */
export function EmojiPicker({ onPick, className }: { onPick: (emoji: string) => void; className?: string }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState<Emoji | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const needle = query.trim().toLocaleLowerCase('de');
  const groups = needle
    ? [{ label: 'Treffer', emojis: GROUPS.flatMap((group) => group.emojis).filter((emoji) => emoji.name.toLocaleLowerCase('de').includes(needle)) }].filter((group) => group.emojis.length > 0)
    : GROUPS;
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
        aria-label="Emoji suchen"
        placeholder="Suchen, z.&nbsp;B. Daumen …"
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
            <p className="break-words">Kein Emoji mit „{query.trim()}“.</p>
            {typed && (
              <button
                type="button"
                onClick={() => onPick(typed)}
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-ctl px-2 font-semibold text-accent-text transition-colors duration-120 hover:bg-hover md:h-8"
              >
                <span className="text-lg" aria-hidden="true">
                  {typed}
                </span>
                Dieses Emoji verwenden
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
          'Emoji wählen oder eins eintippen'
        )}
      </p>
    </div>
  );
}
