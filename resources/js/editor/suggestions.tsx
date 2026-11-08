/*
 * The list all three menus of the editor share (spec 4.16): `/` (slashMenu.tsx), `@` (mentions.tsx) and `#`
 * (references.tsx).
 *
 * The list is the combobox pattern on the editor: the focus stays in the text, the editor names the list
 * (`aria-controls`) and its active entry (`aria-activedescendant`); the arrows move (and wrap), Enter or Tab take an
 * entry (with Shift, Alt or mod they stay the editor's: Shift+Enter is its line break), Escape closes the list without
 * closing anything else: the suggestion plugin uses up the key, and the editor stops it there, so no dialog, popup or
 * preview around the editor sees it (RichTextEditor, `handleDOMEvents`).
 *
 * The text field keeps its role (a combobox role would make a many-line editor a single-line field): what the list
 * offers goes to the editor's live region instead (announcer.ts): how many entries and the active one when the list
 * opens or changes, the active one on every arrow, and what the list says without entries (F21).
 *
 * A list whose entries do not belong to what is typed now (`stale`: the answer to the new query is still on its way)
 * shows them greyed out, offers none of them and keeps Enter and Tab to itself: a quick "#WEB-47" + Enter never takes
 * the hit of "WEB-4" (T16-I1).
 *
 *   render: popupRenderer(PeopleSuggestions, env, {})
 */

import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ReactRenderer, type Editor } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode, type Ref } from 'react';
import { tn } from '@/lib/i18n';
import { announce } from './announcer';
import type { EditorEnvRef } from './EditorEnv';

export interface SuggestionEntry {
  /** Unique within the list. */
  key: string;
  /** What the entry shows; its text is the option's name. */
  content: ReactNode;
  pick: () => void;
}

export interface SuggestionSection {
  /** A heading for a group; none for a flat list. */
  label?: string;
  entries: SuggestionEntry[];
}

export interface SuggestionHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SuggestionMenuProps {
  editor: Pick<Editor, 'view'>;
  /** The list's name: "Personen und Bots". */
  label: string;
  sections: SuggestionSection[];
  /** What the list says while it has no entry: loading, failed, nothing found, what to type. */
  status: string;
  /** The entries answer an earlier query: shown, but none can be taken; `status` says why. */
  stale?: boolean;
  ref?: Ref<SuggestionHandle>;
}

/** Enter or Tab alone, the keys that take an entry. */
const takes = (event: KeyboardEvent) => (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;

const EDITOR_LIST_ATTRIBUTES = ['aria-controls', 'aria-autocomplete', 'aria-activedescendant'];

export function SuggestionMenu({ editor, label, sections, status, stale = false, ref }: SuggestionMenuProps) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const entries = sections.flatMap((section) => section.entries);
  const signature = entries.map((entry) => entry.key).join('|');
  const [active, setActive] = useState({ index: 0, signature });
  // new entries (the query changed): start at the top again
  const index = active.signature === signature ? Math.min(active.index, Math.max(entries.length - 1, 0)) : 0;
  const optionId = (position: number) => `${listId}-${position}`;

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        // the answer to what is typed now is on its way: Enter and Tab take nothing and add nothing (no line break)
        if (stale) return event.key === 'Enter' || event.key === 'Tab';
        if (entries.length === 0) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setActive({ index: (index + step + entries.length) % entries.length, signature });
          return true;
        }
        if (takes(event)) {
          entries[index].pick();
          return true;
        }
        return false;
      },
    }),
    [entries, index, signature, stale],
  );

  // the editor names the list and its active entry; the focus never leaves the text
  useLayoutEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute('aria-controls', listId);
    dom.setAttribute('aria-autocomplete', 'list');
    if (entries.length > 0 && !stale) dom.setAttribute('aria-activedescendant', optionId(index));
    else dom.removeAttribute('aria-activedescendant');
  });
  useLayoutEffect(() => () => EDITOR_LIST_ATTRIBUTES.forEach((name) => editor.view.dom.removeAttribute(name)), [editor]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  // what a screen reader hears of the list: new entries with their number, then each active one, or the list's status
  const said = useRef<string | null>(null);
  useEffect(() => {
    const dom = editor.view.dom;
    if (entries.length === 0 || stale) {
      said.current = null;
      announce(dom, status);
      return;
    }
    const active = listRef.current?.querySelector(`[data-index="${index}"]`)?.textContent ?? '';
    announce(dom, said.current === signature ? active : tn('editor.suggest.count', entries.length, { active }));
    said.current = signature;
  }, [editor, entries.length, index, signature, stale, status]);

  let position = 0;
  const option = (entry: SuggestionEntry) => {
    const at = position++;
    const current = at === index && !stale;
    return (
      <div
        key={entry.key}
        id={optionId(at)}
        role="option"
        aria-selected={current}
        aria-disabled={stale || undefined}
        data-index={at}
        data-highlighted={current ? '' : undefined}
        // the focus stays in the editor
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => !stale && setActive({ index: at, signature })}
        onClick={() => !stale && entry.pick()}
        className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 py-1.5 text-ui text-ink select-none aria-disabled:cursor-default aria-disabled:opacity-50 highlighted:bg-raised highlighted:shadow-elev-1 highlighted:ring-1 highlighted:ring-line-input highlighted:ring-inset md:min-h-8"
      >
        {entry.content}
      </div>
    );
  };

  return (
    <div className="tracing-strong w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card text-ui text-ink [--glass-shadow:var(--elev-2)]">
      <div ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto overscroll-contain p-1">
        {sections.map((section, sectionIndex) =>
          section.label ? (
            section.entries.length > 0 && (
              <div key={section.label} role="group" aria-labelledby={`${listId}-g${sectionIndex}`}>
                <p id={`${listId}-g${sectionIndex}`} className="px-2.5 pt-1.5 pb-1 text-sm text-muted">
                  {section.label}
                </p>
                {section.entries.map(option)}
              </div>
            )
          ) : (
            section.entries.map(option)
          ),
        )}
      </div>
      {(entries.length === 0 || stale) && (
        // said through the editor's live region (above): a status mounted with its text is often not read
        <p className="px-3 pb-2.5 text-ui text-pretty text-muted">
          {status}
        </p>
      )}
    </div>
  );
}

/** The query once typing paused for a moment, so not every key asks the server. */
export function useSettled(value: string, delay = 150): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * What a list asks the server for: what is typed, once typing paused for a moment, or at once when an answer to it is
 * in the cache already (that one is good to take right away).
 */
export function useAsked(typed: string, keyOf: (q: string) => QueryKey, delay?: number): string {
  const settled = useSettled(typed, delay);
  return useQueryClient().getQueryData(keyOf(typed)) !== undefined ? typed : settled;
}

/** What a suggestion list gets: the plugin's props (query, command …), the editor's environment and its extras. */
export type PopupProps<Extra = object> = Extra & {
  suggestion: SuggestionProps;
  env: EditorEnvRef;
  ref?: Ref<SuggestionHandle>;
};

/**
 * The `render` of a suggestion plugin: mounts the list next to the cursor (the plugin positions it) and hands it the
 * keys. Inside a modal dialog the list goes into the dialog, so a click on it is no click outside.
 */
export function popupRenderer<Extra extends object>(Component: ComponentType<PopupProps<Extra>>, env: EditorEnvRef, extra: Extra) {
  return () => {
    let renderer: ReactRenderer<SuggestionHandle, PopupProps<Extra>> | null = null;
    let unmount: (() => void) | null = null;
    return {
      onStart(props: SuggestionProps) {
        renderer = new ReactRenderer(Component, { editor: props.editor, props: { ...extra, suggestion: props, env } as PopupProps<Extra> });
        const element = renderer.element as HTMLElement;
        element.style.zIndex = '60';
        const host = props.editor.view.dom.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? document.body;
        host.append(element);
        unmount = props.mount(element);
      },
      onUpdate(props: SuggestionProps) {
        renderer?.updateProps({ suggestion: props });
      },
      onKeyDown({ event }: SuggestionKeyDownProps) {
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit() {
        unmount?.();
        unmount = null;
        renderer?.destroy();
        renderer = null;
      },
    };
  };
}
