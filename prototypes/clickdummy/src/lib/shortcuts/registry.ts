/*
 * The one source of keyboard shortcuts (spec 5.1, 7.3): every shortcut of the app is registered here, and the help
 * overlay (`?`) lists what is registered. One keydown listener on the window decides what runs.
 *
 * Notation (the same as `Kbd`): `+` joins keys pressed together, a space separates the steps of a sequence.
 *   "c", "?", "shift+d", "mod+k", "mod+enter", "escape", "g i"
 * `mod` is ⌘ on a Mac and Strg (Control) elsewhere. Letters are told apart by shift ("d" vs "shift+d"); symbols such as
 * "?" or "/" match whatever modifiers the keyboard layout needs to produce them.
 *
 * Which shortcut runs:
 * - While focus is in an input, a textarea, a select or a contenteditable editor (`isTyping`), only `mod+k`, `escape`
 *   and `mod+enter` run; everything else is typing.
 * - A key that a component has already handled (`preventDefault`, e.g. Base UI's typeahead in an open menu, or the
 *   Escape that closes a popup) is left alone, and so is a key an input method is composing (also Safari's 229).
 * - A held key (auto-repeat) runs only shortcuts that ask for it (`repeat: true`, e.g. j/k through a list).
 * - A sequence waits up to 1000 ms for its next step; a held first key ("g" a moment too long) keeps it waiting.
 * - Of the shortcuts that match, the innermost scope wins: dialog over detail over list over global; within a scope
 *   the one registered last. A shortcut whose `when()` answers false does not take part, so an outer one runs.
 * - While a modal dialog is open (`enterDialogScope`, which `Dialog` does on its own), only the dialog's own
 *   shortcuts and the global `mod+k`, `escape` and `mod+enter` run; the page behind it waits.
 */

import { isMac } from '@/lib/platform';

export type ShortcutScope = 'global' | 'list' | 'detail' | 'dialog';

export interface ShortcutDef {
  /** Unique; registering the same id again replaces the earlier shortcut. */
  id: string;
  /** Register notation, see above. */
  keys: string;
  scope: ShortcutScope;
  /** What it does, for the help overlay ("Neues Item"). */
  label: string;
  /** Heading in the help overlay ("Navigation"). */
  group: string;
  run: (event: KeyboardEvent) => void;
  /** Takes part only while this answers true. */
  when?: () => boolean;
  /** Runs again while the key is held (auto-repeat), e.g. j/k through a list. Off by default. */
  repeat?: boolean;
}

/** Pressed together: one step of a shortcut. */
interface Chord {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

interface Entry {
  def: ShortcutDef;
  steps: Chord[];
  /** Each step in a canonical spelling, to compare the steps of different shortcuts. */
  spelled: string[];
  /** Registration order: within a scope the later one wins. */
  order: number;
}

const SCOPE_RANK: Record<ShortcutScope, number> = { global: 0, list: 1, detail: 2, dialog: 3 };
const SEQUENCE_MS = 1000;
/** What still runs while typing, in canonical spelling. */
const WHILE_TYPING = new Set(['mod+k', 'escape', 'mod+enter']);
const KEY_ALIASES: Record<string, string> = { esc: 'escape', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', return: 'enter' };
/** Pressing a modifier alone neither runs nor breaks a sequence. */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS', 'Hyper', 'Super']);
/** Inputs that take no text, so letters there are shortcuts as anywhere else. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

const entries = new Map<string, Entry>();
let counter = 0;
/** Where an id was first registered: the help keeps that place when the shortcut registers again. */
const places = new Map<string, number>();
let dialogLayers = 0;
/** The steps of a sequence pressed so far, and the timer that forgets them. */
let pending: { spelled: string[]; timer: ReturnType<typeof setTimeout> } | null = null;
let listening = false;
let snapshot: ShortcutDef[] = [];
const listeners = new Set<() => void>();

function parseChord(step: string): Chord {
  const chord: Chord = { key: '', mod: false, ctrl: false, alt: false, shift: false, meta: false };
  // "shift++" would be odd notation; a lone "+" stays a key
  const tokens = step === '+' ? ['+'] : step.split('+').filter(Boolean);
  for (const raw of tokens) {
    const token = raw.toLowerCase();
    if (token === 'mod' || token === 'ctrl' || token === 'alt' || token === 'shift' || token === 'meta') chord[token] = true;
    else chord.key = KEY_ALIASES[token] ?? token;
  }
  return chord;
}

function spell(chord: Chord): string {
  const modifiers = (['mod', 'ctrl', 'alt', 'meta', 'shift'] as const).filter((name) => chord[name]);
  return [...modifiers, chord.key].join('+');
}

/** `event.key` in register spelling: lower case, the space bar as "space". */
function keyOf(event: KeyboardEvent): string {
  return event.key === ' ' ? 'space' : event.key.toLowerCase();
}

const isLetter = (key: string) => /^[a-z]$/.test(key);
const isSymbol = (key: string) => key.length === 1 && !/^[a-z0-9]$/.test(key);

function matches(chord: Chord, event: KeyboardEvent): boolean {
  const mac = isMac();
  const meta = chord.meta || (chord.mod && mac);
  const ctrl = chord.ctrl || (chord.mod && !mac);
  if (event.metaKey !== meta || event.ctrlKey !== ctrl || event.altKey !== chord.alt) return false;
  // a symbol carries its shift in itself: "?" is shift and slash on one layout, shift and ß on another
  if (!isSymbol(chord.key) && event.shiftKey !== chord.shift) return false;
  const key = keyOf(event);
  if (key === chord.key) return true;
  // alt on a Mac or a non-Latin layout changes the character: fall back to the physical key for letters
  return isLetter(chord.key) && !isLetter(key) && event.code === `Key${chord.key.toUpperCase()}`;
}

/** Whether keys pressed on this target are typing: a text field, a text area, a select or a contenteditable editor. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return false;
}

/** Global shortcuts that also work over a modal dialog: the same three that work while typing. */
const passesDialog = (entry: Entry) => entry.def.scope === 'global' && entry.steps.length === 1 && WHILE_TYPING.has(entry.spelled[0]);

function takesPart(entry: Entry, event: KeyboardEvent): boolean {
  // over a modal dialog the page waits: a second "c" would reset the create dialog, "g i" would leave the page
  if (dialogLayers > 0 && entry.def.scope !== 'dialog' && !passesDialog(entry)) return false;
  if (event.repeat && entry.def.repeat !== true) return false;
  return entry.def.when?.() ?? true;
}

/** The innermost scope wins, then the shortcut registered last. */
function pick(candidates: Entry[]): Entry {
  return candidates.reduce((best, entry) => {
    const rank = SCOPE_RANK[entry.def.scope] - SCOPE_RANK[best.def.scope];
    return rank > 0 || (rank === 0 && entry.order > best.order) ? entry : best;
  });
}

function clearPending(): void {
  if (pending) clearTimeout(pending.timer);
  pending = null;
}

function runEntry(entry: Entry, event: KeyboardEvent): void {
  event.preventDefault();
  entry.def.run(event);
}

function onKeyDown(event: KeyboardEvent): void {
  // Chrome sends keydowns without a key on autofill; 229 is a key an input method composes (Safari ends with it)
  if (typeof event.key !== 'string' || event.isComposing || event.keyCode === 229) return;
  if (event.defaultPrevented || MODIFIER_KEYS.has(event.key)) return;
  const typing = isTyping(event.target);
  const active = [...entries.values()].filter((entry) => takesPart(entry, event));
  // a sequence started on the page does not go on in a field
  if (typing) clearPending();

  // the key of the last step is still held: its repeats keep the sequence waiting for the next step. A repeat of any
  // other key (j held while g was tapped) goes on below: it ends the sequence and counts on its own.
  if (pending && event.repeat && matches(parseChord(pending.spelled.at(-1)!), event)) {
    event.preventDefault();
    startSequence(pending.spelled, event);
    return;
  }

  // the next step of a sequence that was started
  if (pending) {
    const prefix = pending.spelled;
    clearPending();
    const next = prefix.length;
    const completed = active.filter(
      (entry) => entry.steps.length > next && prefix.every((step, index) => entry.spelled[index] === step) && matches(entry.steps[next], event),
    );
    const done = completed.filter((entry) => entry.steps.length === next + 1);
    if (done.length > 0) {
      runEntry(pick(done), event);
      return;
    }
    if (completed.length > 0) {
      startSequence([...prefix, completed[0].spelled[next]], event);
      return;
    }
    // no sequence goes on like this: the key counts on its own
  }

  if (typing) {
    const allowed = active.filter((entry) => entry.steps.length === 1 && WHILE_TYPING.has(entry.spelled[0]) && matches(entry.steps[0], event));
    if (allowed.length > 0) runEntry(pick(allowed), event);
    return;
  }

  const starts = active.filter((entry) => entry.steps.length > 1 && matches(entry.steps[0], event));
  if (starts.length > 0) {
    startSequence([starts[0].spelled[0]], event);
    return;
  }

  const hits = active.filter((entry) => entry.steps.length === 1 && matches(entry.steps[0], event));
  if (hits.length > 0) runEntry(pick(hits), event);
}

function startSequence(spelled: string[], event: KeyboardEvent): void {
  event.preventDefault();
  if (pending) clearTimeout(pending.timer);
  pending = { spelled, timer: setTimeout(clearPending, SEQUENCE_MS) };
}

function changed(): void {
  snapshot = [...entries.values()].sort((a, b) => places.get(a.def.id)! - places.get(b.def.id)!).map((entry) => entry.def);
  listeners.forEach((listener) => listener());

  // listen only while something is registered
  if (entries.size > 0 && !listening) {
    window.addEventListener('keydown', onKeyDown);
    listening = true;
  } else if (entries.size === 0 && listening) {
    window.removeEventListener('keydown', onKeyDown);
    listening = false;
    clearPending();
  }
}

/** The keys in one spelling, e.g. "Esc" and "escape" or "shift+mod+k" and "mod+shift+k" become the same. */
export function canonicalKeys(keys: string): string {
  return keys.trim().split(/\s+/).filter(Boolean).map((step) => spell(parseChord(step))).join(' ');
}

/** Registers a shortcut; the returned function takes it out again (it does nothing once the id was replaced). */
export function registerShortcut(def: ShortcutDef): () => void {
  const steps = def.keys.trim().split(/\s+/).filter(Boolean).map(parseChord);
  const entry: Entry = { def, steps, spelled: steps.map(spell), order: ++counter };
  if (!places.has(def.id)) places.set(def.id, entry.order);
  entries.set(def.id, entry);
  changed();
  return () => {
    if (entries.get(def.id) !== entry) return;
    entries.delete(def.id);
    changed();
  };
}

/** Everything registered, in the order the ids were first registered (the source of the help overlay). */
export function listShortcuts(): ShortcutDef[] {
  return snapshot;
}

/** For `useSyncExternalStore`: called whenever a shortcut comes or goes. */
export function subscribeShortcuts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A modal dialog opened: until the returned function is called, only shortcuts of the `dialog` scope and the global
 * `mod+k`, `escape` and `mod+enter` run; everything else of the page behind it pauses (list, detail and the other
 * global keys such as `c` or `g i`). Dialogs can stack; each one calls this once.
 */
export function enterDialogScope(): () => void {
  dialogLayers += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    dialogLayers -= 1;
  };
}
