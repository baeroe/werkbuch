import type { LucideIcon } from 'lucide-react';
import { ArrowBigUp, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronUp, Command, CornerDownLeft, Delete, Option } from 'lucide-react';
import { Fragment, type ComponentProps } from 'react';
import { t } from '@/lib/i18n';
import { isMac } from '@/lib/platform';
import { cx } from './cx';

/** One key as shown (text or Lucide glyph), as read out, and as named in aria-keyshortcuts. */
type KeyFace = { spoken: string; aria: string; text?: string; icon?: LucideIcon };

const NAMED: Record<string, (mac: boolean) => KeyFace> = {
  mod: (mac) =>
    mac ? { spoken: t('kbd.spoken.command'), aria: 'Meta', icon: Command } : { spoken: t('kbd.spoken.control'), aria: 'Control', text: t('kbd.text.ctrl') },
  ctrl: (mac) =>
    mac ? { spoken: 'Control', aria: 'Control', icon: ChevronUp } : { spoken: t('kbd.spoken.control'), aria: 'Control', text: t('kbd.text.ctrl') },
  alt: (mac) => (mac ? { spoken: t('kbd.spoken.option'), aria: 'Alt', icon: Option } : { spoken: 'Alt', aria: 'Alt', text: 'Alt' }),
  shift: () => ({ spoken: t('kbd.spoken.shift'), aria: 'Shift', icon: ArrowBigUp }),
  enter: () => ({ spoken: t('kbd.spoken.enter'), aria: 'Enter', icon: CornerDownLeft }),
  escape: () => ({ spoken: 'Escape', aria: 'Escape', text: 'Esc' }),
  backspace: () => ({ spoken: t('kbd.spoken.backspace'), aria: 'Backspace', icon: Delete }),
  delete: () => ({ spoken: t('kbd.spoken.delete'), aria: 'Delete', text: t('kbd.text.delete') }),
  tab: () => ({ spoken: t('kbd.spoken.tab'), aria: 'Tab', text: 'Tab' }),
  space: () => ({ spoken: t('kbd.text.space'), aria: 'Space', text: t('kbd.text.space') }),
  arrowup: () => ({ spoken: t('kbd.spoken.arrow_up'), aria: 'ArrowUp', icon: ArrowUp }),
  arrowdown: () => ({ spoken: t('kbd.spoken.arrow_down'), aria: 'ArrowDown', icon: ArrowDown }),
  arrowleft: () => ({ spoken: t('kbd.spoken.arrow_left'), aria: 'ArrowLeft', icon: ArrowLeft }),
  arrowright: () => ({ spoken: t('kbd.spoken.arrow_right'), aria: 'ArrowRight', icon: ArrowRight }),
};

const ALIASES: Record<string, string> = { esc: 'escape', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };

/** The spoken names of the symbols, looked up when a key is drawn so they follow the language. */
const SYMBOLS: Record<string, () => string> = {
  '/': () => t('kbd.symbol.slash'),
  '?': () => t('kbd.symbol.question_mark'),
  ',': () => t('kbd.symbol.comma'),
  '.': () => t('kbd.symbol.period'),
  '-': () => t('kbd.symbol.minus'),
};

function keyFace(token: string, mac: boolean): KeyFace {
  const name = token.toLowerCase();
  const named = NAMED[ALIASES[name] ?? name];
  if (named) return named(mac);
  const upper = token.length === 1 ? token.toUpperCase() : token;
  return { spoken: SYMBOLS[token]?.() ?? upper, aria: upper, text: upper };
}

/** Register notation: `+` joins keys pressed together, a space separates the steps of a sequence ("g i"). */
function parseKeys(keys: string, mac: boolean): KeyFace[][] {
  return keys
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((step) => step.split('+').filter(Boolean).map((token) => keyFace(token, mac)));
}

/** The keys in words, e.g. "Command K" or "G then I". */
const spokenOf = (steps: KeyFace[][]): string => steps.map((step) => step.map((key) => key.spoken).join(' ')).join(` ${t('kbd.then')} `);

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
 * screen readers get the keys in words as the accessible name ("Command K").
 */
export function Kbd({ keys, size = 'sm', tone = 'muted', className, ...rest }: KbdProps) {
  const steps = parseKeys(keys, isMac());

  return (
    <kbd role="img" aria-label={spokenOf(steps)} translate="no" className={cx('inline-flex shrink-0 items-center gap-0.5 font-ui', className)} {...rest}>
      {steps.map((step, index) => (
        <Fragment key={index}>
          {index > 0 && <span className={cx('px-0.5 text-sm font-normal', tone === 'muted' ? 'text-muted' : 'opacity-80')}>{t('kbd.then')}</span>}
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
