/*
 * /_tui (WEBU-18): pictures of the runner in a terminal, for the review of the UX before it is built: the output of
 * `install.sh` (connected, and with an expired code) and the five tabs of the TUI (spec 8.5). The TUI follows skilltri:
 * Bubble Tea and Lip Gloss, the 16 colours of the terminal, tabs in the header with the state on the right, the keys
 * in the footer. Each picture scrolls sideways on a narrow screen; the page itself does not.
 */

import { Monitor, Moon, Sun } from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { InPageLink } from '@/components/ui/InPageLink';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { applyTheme, readTheme, type ThemeChoice } from '@/lib/theme';
import { FRAMES, padLine, WIDTH, type Frame } from './frames';
import './tui.css';

const STYLE: Record<string, string> = {
  a: 'text-[var(--t-cyan)]',
  A: 'font-bold text-[var(--t-cyan)]',
  s: 'font-bold text-[var(--t-cyan)]',
  k: 'font-bold text-[var(--t-cyan)]',
  g: 'text-[var(--t-green)]',
  r: 'text-[var(--t-red)]',
  y: 'text-[var(--t-yellow)]',
  b: 'text-[var(--t-blue)]',
  m: 'font-bold text-[var(--t-magenta)]',
  d: 'text-[var(--t-dim)]',
  B: 'font-bold',
  w: 'font-bold text-[var(--t-white)]',
  T: 'bg-[var(--t-cyan)] font-bold text-[var(--t-bg)]',
  '!': 'bg-[var(--t-red)] font-bold text-[var(--t-bg)]',
};

/** One line of markup as spans. */
function renderLine(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\{([aAkgrybmdBwT!s]):([^}]*)\}/g;
  let last = 0;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    parts.push(
      <span key={match.index} className={STYLE[match[1]]}>
        {match[2]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function Terminal({ frame }: { frame: Frame }) {
  const titleId = `tui-${frame.id}`;
  return (
    <figure aria-labelledby={titleId} className="min-w-0">
      <figcaption className="mb-3">
        <h2 id={titleId} className="scroll-mt-6 font-display text-xl font-bold tracking-title text-ink">
          {frame.title}
        </h2>
        <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{frame.caption}</p>
      </figcaption>
      <div className="tui w-fit max-w-full overflow-hidden rounded-card border border-line-strong bg-[var(--t-bg)] shadow-elev-2">
        <div className="flex items-center gap-2 border-b border-line bg-[var(--t-bar)] px-3 py-2" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-[var(--t-red)] opacity-70" />
          <span className="size-2.5 rounded-full bg-[var(--t-yellow)] opacity-70" />
          <span className="size-2.5 rounded-full bg-[var(--t-green)] opacity-70" />
          <span className="ml-2 truncate text-xs text-[var(--t-dim)]">{frame.window}</span>
        </div>
        {/* a scrolling region a keyboard can reach: the picture is wider than a phone */}
        <pre tabIndex={0} aria-label={`Terminal: ${frame.title}`} className="overflow-x-auto px-3 py-3 text-[12.5px] leading-[1.45] text-[var(--t-fg)]">
          {frame.lines.map((line, index) => {
            const selected = line.startsWith('§');
            const text = selected ? padLine(line.slice(1)) : line;
            return (
              <Fragment key={index}>
                <span className={cx('inline-block min-w-full', selected && 'bg-[var(--t-sel)]')} style={frame.fixed ? { minWidth: `${WIDTH}ch` } : undefined}>{renderLine(text)}</span>
                {'\n'}
              </Fragment>
            );
          })}
        </pre>
      </div>
    </figure>
  );
}

export function TuiPage() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Runner im Terminal – werkbuch Klickdummy';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="px-4 md:px-8">
      <InPageLink to="main" className="sr-only rounded-ctl bg-surface px-3 py-2 text-ui font-semibold text-ink shadow-elev-2 focus:not-sr-only focus:absolute focus:top-3 focus:left-3">
        Zum Inhalt
      </InPageLink>
      <header className="mx-auto max-w-6xl pt-10 pb-4 md:pt-14">
        <div className="flex flex-wrap items-start justify-between gap-x-12 gap-y-6">
          <div className="min-w-0 max-w-[60ch]">
            <h1 className="font-display text-3xl font-extrabold tracking-display text-ink">Runner im Terminal</h1>
            <p className="mt-4 text-body text-pretty text-ink">
              So sieht werkbuch-runner auf der Maschine aus: die Installation per Befehl aus „Runner verbinden“ und die TUI mit ihren fünf Reitern, im Stil von skilltri. Statische Bilder mit den
              Demo-Daten des Klickdummys; die Texte des Terminals sind Englisch wie bei skilltri und tussh.
            </p>
            <nav aria-label="Bilder" className="mt-5">
              <ul className="flex flex-wrap gap-2">
                {FRAMES.map((frame) => (
                  <li key={frame.id}>
                    <InPageLink to={`tui-${frame.id}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                      {frame.title}
                    </InPageLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <SegmentedControl
            label="Farbschema"
            value={theme}
            onValueChange={(next) => {
              applyTheme(next);
              setTheme(next);
            }}
            options={[
              { value: 'system', label: 'System', icon: Monitor },
              { value: 'light', label: 'Hell', icon: Sun },
              { value: 'dark', label: 'Nachtheft', icon: Moon },
            ]}
          />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-6xl flex-col gap-14 pt-6 pb-24">
        {FRAMES.map((frame) => (
          <Terminal key={frame.id} frame={frame} />
        ))}
      </main>
    </div>
  );
}
