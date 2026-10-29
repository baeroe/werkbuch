/*
 * Mentions and references in rich text (spec 4.16), and the suggestion list all three editor menus share:
 * - `@` mentions people and bots with access to the project, `projectPeople` (`mention` node: the user id and the handle,
 *   `@mara`)
 * - `#` refers to items and wiki pages the reader may see (`reference` node: the id, the kind and the label at the
 *   time of writing). A reference is resolved when it is shown: what the reader may not see reads "verborgen".
 * - the `/` menu (slashMenu.tsx) uses the same list.
 *
 * The list is the combobox pattern on the editor: the focus stays in the text, the editor names the list
 * (`aria-controls`) and its active entry (`aria-activedescendant`); the arrows move, Enter or Tab take an entry, Escape
 * closes the list without closing anything else: the suggestion plugin uses up the key, and the editor stops it there,
 * so no dialog, popup or preview around the editor sees it (RichTextEditor, handleDOMEvents).
 */

import Mention from '@tiptap/extension-mention';
import { mergeAttributes, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, type Editor, type ReactNodeViewProps } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { EyeOff, FileText } from 'lucide-react';
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type Ref, type RefObject } from 'react';
import { Link, useInRouterContext } from 'react-router';
import { ApiError } from '@/api/client';
import { botWord } from '@/components/fields/format';
import { projectPeople } from '@/components/fields/itemData';
import { TypeGlyph } from '@/components/fields/TypePicker';
import { Avatar } from '@/components/ui/Avatar';
import { cx } from '@/components/ui/cx';
import { usePage } from '@/hooks/pages';
import { useMembers, useProjects } from '@/hooks/projects';
import { useSearch } from '@/hooks/search';
import { useUsers } from '@/hooks/users';
import { useWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { hrefOf } from '@/lib/links';
import type { User } from '@/types';
import type { EditorEnv } from './pasteImages';

/* ---------------------------------------------------------------------- the shared list */

export interface SuggestionEntry {
  /** Unique within the list. */
  key: string;
  /** What the entry shows; its text is the option's name. */
  content: ReactNode;
  pick: () => void;
}

export interface SuggestionSection {
  /** A heading for a group (Items, Seiten); none for a flat list. */
  label?: string;
  entries: SuggestionEntry[];
}

export interface SuggestionHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

type SuggestionMenuProps = {
  editor: Editor;
  /** The list's name: "Personen und Bots". */
  label: string;
  sections: SuggestionSection[];
  loading?: boolean;
  /** Shown when nothing matches. */
  empty: string;
  ref?: Ref<SuggestionHandle>;
};

const EDITOR_LIST_ATTRIBUTES = ['aria-controls', 'aria-autocomplete', 'aria-activedescendant'];

export function SuggestionMenu({ editor, label, sections, loading = false, empty, ref }: SuggestionMenuProps) {
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
        if (entries.length === 0) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setActive({ index: (index + step + entries.length) % entries.length, signature });
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          entries[index].pick();
          return true;
        }
        return false;
      },
    }),
    [entries, index, signature],
  );

  // the editor names the list and its active entry; the focus never leaves the text
  useLayoutEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute('aria-controls', listId);
    dom.setAttribute('aria-autocomplete', 'list');
    if (entries.length > 0) dom.setAttribute('aria-activedescendant', optionId(index));
    else dom.removeAttribute('aria-activedescendant');
  });
  useLayoutEffect(() => () => EDITOR_LIST_ATTRIBUTES.forEach((name) => editor.view.dom.removeAttribute(name)), [editor]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  let position = 0;
  const option = (entry: SuggestionEntry) => {
    const at = position++;
    const current = at === index;
    return (
      <div
        key={entry.key}
        id={optionId(at)}
        role="option"
        aria-selected={current}
        data-index={at}
        data-highlighted={current ? '' : undefined}
        // the focus stays in the editor
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActive({ index: at, signature })}
        onClick={() => entry.pick()}
        className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 py-1.5 text-ui text-ink select-none highlighted:bg-raised highlighted:shadow-elev-1 highlighted:ring-1 highlighted:ring-line-input highlighted:ring-inset md:min-h-8"
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
      {entries.length === 0 && (
        <p role="status" className="px-3 pb-2.5 text-ui text-pretty text-muted">
          {loading ? 'Sucht …' : empty}
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- popup of a suggestion */

/** What a suggestion list gets: the plugin's props (query, command …), the editor's environment and its extras. */
export type PopupProps<Extra = object> = Extra & {
  suggestion: SuggestionProps;
  env: RefObject<EditorEnv | null>;
  ref?: Ref<SuggestionHandle>;
};

/**
 * The `render` of a suggestion plugin: mounts the list next to the cursor (the plugin positions it) and hands it the
 * keys. Inside a modal dialog the list goes into the dialog, so a click on it is no click outside.
 */
export function popupRenderer<Extra extends object>(Component: ComponentType<PopupProps<Extra>>, env: RefObject<EditorEnv | null>, extra: Extra) {
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

/* ----------------------------------------------------------------------- @ mentions */

const COLLATOR = new Intl.Collator('de-DE');
const MAX_PEOPLE = 8;

/** Active people and bots among `candidates` whose name or handle contains the query; starts of words first. */
export function matchPeople(users: readonly User[], memberIds: ReadonlySet<string>, query: string): User[] {
  const needle = query.trim().toLocaleLowerCase('de-DE');
  const rank = (user: User) => {
    const name = user.name.toLocaleLowerCase('de-DE');
    const handle = user.handle.toLocaleLowerCase('de-DE');
    if (needle === '' || handle.startsWith(needle) || name.split(/\s+/).some((part) => part.startsWith(needle))) return 0;
    return name.includes(needle) || handle.includes(needle) ? 1 : -1;
  };
  return users
    .filter((user) => memberIds.has(user.id) && user.disabled_at === null && rank(user) >= 0)
    .sort((a, b) => rank(a) - rank(b) || (a.type === b.type ? COLLATOR.compare(a.name, b.name) : a.type === 'person' ? -1 : 1))
    .slice(0, MAX_PEOPLE);
}

function PeopleSuggestions({ suggestion, env, ref }: PopupProps) {
  const projectId = env.current?.projectId;
  const members = useMembers(projectId);
  const users = useUsers();
  // who has access to the project: its members and the org admins, the default bot only as a member (spec 4.16, 4.2)
  const candidates = useMemo(
    () => new Set(projectPeople(users.data?.items ?? [], members.data?.items ?? [], projectId ?? '').map((user) => user.id)),
    [users.data, members.data, projectId],
  );
  const people = matchPeople(users.data?.items ?? [], candidates, suggestion.query);
  const entries: SuggestionEntry[] = people.map((user) => ({
    key: user.id,
    content: (
      <>
        <Avatar user={user} size="sm" decorative />
        <span className="min-w-0 flex-1 truncate">{user.name}</span>
        <span className="shrink-0 text-sm text-muted">{botWord(user) ?? `@${user.handle}`}</span>
      </>
    ),
    pick: () => suggestion.command({ id: user.id, label: user.handle }),
  }));
  const failed = members.isError || users.isError;
  return (
    <SuggestionMenu
      ref={ref}
      editor={suggestion.editor}
      label="Personen und Bots"
      sections={[{ entries }]}
      loading={members.isPending || users.isPending}
      empty={failed ? 'Die Personen ließen sich nicht laden.' : `Niemand im Projekt heißt „${suggestion.query}“.`}
    />
  );
}

/** `@` people and bots of the project: stores the id and the handle (`@mara`). */
export function mentionExtension(env: RefObject<EditorEnv | null>) {
  return Mention.configure({
    HTMLAttributes: { class: 'rt-mention', translate: 'no' },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ options, node }) => ['span', options.HTMLAttributes, `@${node.attrs.label ?? node.attrs.id}`],
    suggestion: { char: '@', items: () => [], render: popupRenderer(PeopleSuggestions, env, {}) },
  });
}

/* --------------------------------------------------------------------- # references */

const MAX_ITEMS = 6;
const MAX_PAGES = 4;

/** The query once typing paused for a moment, so not every key asks the search. */
function useSettled(value: string, delay = 150): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

function ReferenceSuggestions({ suggestion, ref }: PopupProps) {
  const query = useSettled(suggestion.query.trim());
  const search = useSearch(query);
  const types = useWorkItemTypes().data?.items;
  const projects = useProjects({ include_archived: true }).data?.items;
  const items = query === '' ? [] : (search.data?.items ?? []).slice(0, MAX_ITEMS);
  const pages = query === '' ? [] : (search.data?.pages ?? []).slice(0, MAX_PAGES);

  const sections: SuggestionSection[] = [
    {
      label: 'Items',
      entries: items.map((item) => {
        const type = types?.find((entry) => entry.id === item.type_id);
        return {
          key: item.id,
          content: (
            <>
              {type ? <TypeGlyph type={type} /> : <span className="size-4 shrink-0" />}
              <span translate="no" className="w-14 shrink-0 text-sm font-semibold text-muted tabular-nums">
                {item.key}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            </>
          ),
          pick: () => suggestion.command({ id: item.id, label: item.key, kind: 'item' }),
        };
      }),
    },
    {
      label: 'Seiten',
      entries: pages.map((page) => ({
        key: page.id,
        content: (
          <>
            <FileText className="size-4 shrink-0 text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{page.title}</span>
            <span className="shrink-0 text-sm text-muted">Wiki {projects?.find((project) => project.id === page.project_id)?.identifier}</span>
          </>
        ),
        pick: () => suggestion.command({ id: page.id, label: page.title, kind: 'page' }),
      })),
    },
  ];

  return (
    <SuggestionMenu
      ref={ref}
      editor={suggestion.editor}
      label="Items und Seiten"
      sections={sections}
      loading={query !== '' && search.isFetching}
      empty={query === '' ? 'Key oder Titel eingeben, zum Beispiel WEB-42.' : search.isError ? 'Die Suche antwortet gerade nicht.' : `Kein Item und keine Seite zu „${query}“.`}
    />
  );
}

/** A link inside the app when there is a router (the app), a plain one otherwise. */
function AppLink({ to, className, children }: { to: string; className: string; children: ReactNode }) {
  return useInRouterContext() ? (
    <Link to={to} className={className}>
      {children}
    </Link>
  ) : (
    <a href={hrefOf(to)} className={className}>
      {children}
    </a>
  );
}

const isHidden = (error: unknown) => error instanceof ApiError && (error.status === 404 || error.status === 403);

function HiddenReference() {
  return (
    <span className="rt-ref rt-ref-hidden">
      <EyeOff aria-hidden="true" />
      verborgen
    </span>
  );
}

function ItemReference({ id, live }: { id: string; live: boolean }) {
  const detail = useWorkItem(id);
  if (isHidden(detail.error)) return <HiddenReference />;
  if (!detail.data) return <span className="rt-ref">{detail.isError ? 'Verweis' : '…'}</span>;
  const { item, type } = detail.data;
  const content = (
    <>
      <TypeGlyph type={type} />
      <span translate="no">{item.key}</span>
      <span className="sr-only"> {item.title}</span>
    </>
  );
  return live ? (
    <AppLink to={`/items/${item.key}`} className="rt-ref">
      {content}
    </AppLink>
  ) : (
    <span className="rt-ref">{content}</span>
  );
}

function PageReference({ id, live }: { id: string; live: boolean }) {
  const page = usePage(id);
  const projects = useProjects({ include_archived: true }).data?.items;
  if (isHidden(page.error)) return <HiddenReference />;
  if (!page.data) return <span className="rt-ref">{page.isError ? 'Verweis' : '…'}</span>;
  const identifier = projects?.find((project) => project.id === page.data.project_id)?.identifier;
  const content = (
    <>
      <FileText aria-hidden="true" />
      {page.data.emoji ? `${page.data.emoji} ` : ''}
      {page.data.title}
    </>
  );
  return live && identifier ? (
    <AppLink to={`/projects/${identifier}/wiki/${page.data.id}`} className="rt-ref">
      {content}
    </AppLink>
  ) : (
    <span className="rt-ref">{content}</span>
  );
}

/** A reference as the reader sees it now: the item's key and type, the page's title, or "verborgen". */
function ReferenceView({ node, editor }: ReactNodeViewProps) {
  const id = String(node.attrs.id ?? '');
  const live = !editor.isEditable;
  return (
    <NodeViewWrapper as="span" className={cx('rt-ref-wrap')}>
      {node.attrs.kind === 'page' ? <PageReference id={id} live={live} /> : <ItemReference id={id} live={live} />}
    </NodeViewWrapper>
  );
}

/** `#` items and pages the reader may see: stores the id, the kind and the label of the moment. */
export function referenceExtension(env: RefObject<EditorEnv | null>) {
  return Mention.extend({
    name: 'reference',
    addAttributes() {
      return {
        ...this.parent?.(),
        kind: {
          default: 'item',
          parseHTML: (element: HTMLElement) => element.getAttribute('data-kind') ?? 'item',
          renderHTML: (attributes: Record<string, unknown>) => ({ 'data-kind': attributes.kind }),
        },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(ReferenceView, { as: 'span' });
    },
  }).configure({
    renderText: ({ node }) => String(node.attrs.label ?? ''),
    renderHTML: ({ options, node }) => ['span', mergeAttributes(options.HTMLAttributes), String(node.attrs.label ?? '')],
    suggestion: { char: '#', items: () => [], render: popupRenderer(ReferenceSuggestions, env, {}) },
  });
}
