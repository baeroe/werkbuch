import type { LucideIcon } from 'lucide-react';
import { ArrowBigUp, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronUp, Command, CornerDownLeft, Delete, Option } from 'lucide-react';
import { Fragment, type ComponentProps } from 'react';
import { isMac } from '@/lib/platform';
import { cx } from './cx';

/** One key as shown (text or Lucide glyph), as read out, and as named in aria-keyshortcuts. */
type KeyFace = { spoken: string; aria: string; text?: string; icon?: LucideIcon };

const NAMED: Record<string, (mac: boolean) => KeyFace> = {
  mod: (mac) => (mac ? { spoken: 'Befehl', aria: 'Meta', icon: Command } : { spoken: 'Steuerung', aria: 'Control', text: 'Strg' }),
  ctrl: (mac) => (mac ? { spoken: 'Control', aria: 'Control', icon: ChevronUp } : { spoken: 'Steuerung', aria: 'Control', text: 'Strg' }),
  alt: (mac) => (mac ? { spoken: 'Wahl', aria: 'Alt', icon: Option } : { spoken: 'Alt', aria: 'Alt', text: 'Alt' }),
  shift: () => ({ spoken: 'Umschalt', aria: 'Shift', icon: ArrowBigUp }),
  enter: () => ({ spoken: 'Eingabe', aria: 'Enter', icon: CornerDownLeft }),
  escape: () => ({ spoken: 'Escape', aria: 'Escape', text: 'Esc' }),
  backspace: () => ({ spoken: 'Rückschritt', aria: 'Backspace', icon: Delete }),
  delete: () => ({ spoken: 'Entfernen', aria: 'Delete', text: 'Entf' }),
  tab: () => ({ spoken: 'Tabulator', aria: 'Tab', text: 'Tab' }),
  space: () => ({ spoken: 'Leertaste', aria: 'Space', text: 'Leertaste' }),
  arrowup: () => ({ spoken: 'Pfeil hoch', aria: 'ArrowUp', icon: ArrowUp }),
  arrowdown: () => ({ spoken: 'Pfeil runter', aria: 'ArrowDown', icon: ArrowDown }),
  arrowleft: () => ({ spoken: 'Pfeil links', aria: 'ArrowLeft', icon: ArrowLeft }),
  arrowright: () => ({ spoken: 'Pfeil rechts', aria: 'ArrowRight', icon: ArrowRight }),
};

const ALIASES: Record<string, string> = { esc: 'escape', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };

const SYMBOLS: Record<string, string> = { '/': 'Schrägstrich', '?': 'Fragezeichen', ',': 'Komma', '.': 'Punkt', '-': 'Minus' };

function keyFace(token: string, mac: boolean): KeyFace {
  const name = token.toLowerCase();
  const named = NAMED[ALIASES[name] ?? name];
  if (named) return named(mac);
  const upper = token.length === 1 ? token.toUpperCase() : token;
  return { spoken: SYMBOLS[token] ?? upper, aria: upper, text: upper };
}

/** Register notation: `+` joins keys pressed together, a space separates the steps of a sequence ("g i"). */
function parseKeys(keys: string, mac: boolean): KeyFace[][] {
  return keys
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((step) => step.split('+').filter(Boolean).map((token) => keyFace(token, mac)));
}

/** The keys in words, e.g. "Befehl K" or "G dann I". */
const spokenOf = (steps: KeyFace[][]): string => steps.map((step) => step.map((key) => key.spoken).join(' ')).join(' dann ');

/** Value for aria-keyshortcuts ("Meta+K"); sequences cannot be expressed there and give undefined. */
export function ariaKeyshortcuts(keys: string): string | undefined {
  const steps = parseKeys(keys, isMac());
  if (steps.length !== 1) return undefined;
  return steps[0].map((key) => key.aria).join('+');
}

type KbdProps = Omit<ComponentProps<'kbd'>, 'children'> & {
  keys: string;
  /** sm sits inside buttons and menus, md stands on its own (help, lists). */
  size?: 'sm' | 'md';
  /** current: drawn in the text colour, for primary buttons and tooltips. */
  tone?: 'muted' | 'current';
};

/**
 * A shortcut in register notation ("mod+k", "g i", "shift+d"). Modifiers appear as Lucide glyphs on a Mac;
 * screen readers get the keys in words as the accessible name ("Befehl K").
 */
export function Kbd({ keys, size = 'sm', tone = 'muted', className, ...rest }: KbdProps) {
  const steps = parseKeys(keys, isMac());

  return (
    <kbd role="img" aria-label={spokenOf(steps)} translate="no" className={cx('inline-flex shrink-0 items-center gap-0.5 font-ui', className)} {...rest}>
      {steps.map((step, index) => (
        <Fragment key={index}>
          {index > 0 && <span className={cx('px-0.5 text-sm font-normal', tone === 'muted' ? 'text-muted' : 'opacity-80')}>dann</span>}
          {step.map((key, keyIndex) => (
            <kbd
              key={keyIndex}
              className={cx(
                'inline-flex items-center justify-center rounded-chip border text-xs leading-none font-semibold tabular-nums',
                size === 'sm' ? 'h-5 min-w-5' : 'h-6 min-w-6',
                key.text && key.text.length > 1 ? 'px-1.5' : 'px-1',
                tone === 'muted' ? 'border-line bg-surface text-muted' : 'border-current opacity-80',
                tone === 'muted' && size === 'md' && 'shadow-[inset_0_-1px_0_var(--border)]',
              )}
            >
              {key.icon ? <key.icon className="size-3" aria-hidden="true" /> : key.text}
            </kbd>
          ))}
        </Fragment>
      ))}
    </kbd>
  );
}
