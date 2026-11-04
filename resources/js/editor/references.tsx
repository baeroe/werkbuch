/*
 * References in rich text (spec 4.16): `#` searches the items and wiki pages the reader sees (`GET /search`, A230)
 * and stores a `reference` node with the id and the kind only (`{id, kind: 'item' | 'page'}`): no key, no title, so a
 * text never names an item or a page to a reader who may not see it (A229). A reference is resolved when it shows
 * (`useItemRef` and `usePageRef`, one `GET /references` for every reference of a tick): an item with the type and the
 * key it has now, its title for screen readers, a link to the item while reading; a page with its emoji and the title
 * it has now, a link into the wiki of its project while reading; "verborgen" for what the reader does not see (or
 * what is gone), "…" while it loads. Without a project there is no `#`.
 */

import { Link } from '@inertiajs/react';
import { useQueryClient } from '@tanstack/react-query';
import Mention from '@tiptap/extension-mention';
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type ReactNodeViewProps } from '@tiptap/react';
import { EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { isGone } from '@/api/client';
import { TypeGlyph } from '@/components/fields/TypeGlyph';
import { PageGlyph } from '@/features/wiki/PageGlyph';
import { useProjects } from '@/hooks/projects';
import { primeItemRef, primePageRef, useItemRef, usePageRef } from '@/hooks/richText';
import { qk } from '@/hooks/keys';
import { useSearch } from '@/hooks/search';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { EditorEnvRef } from './EditorEnv';
import { fitsAt } from './mentions';
import { popupRenderer, SuggestionMenu, useAsked, type PopupProps, type SuggestionEntry } from './suggestions';

/** As many hits of each kind as the list shows. */
export const MAX_ITEMS = 6;

/** What the list asks the search for: items and pages, six of each. */
const SEARCH = { types: ['items' as const, 'pages' as const], limit: MAX_ITEMS };

function ReferenceSuggestions({ suggestion, ref }: PopupProps) {
  const typed = suggestion.query.trim();
  const asked = useAsked(typed, (q) => qk.search.list({ q, ...SEARCH }));
  const search = useSearch(asked, SEARCH);
  const types = useWorkItemTypes().data?.items;
  const projects = useProjects({ include_archived: true }).data?.items;
  const client = useQueryClient();
  // only an answer to what is typed now may be taken (T16-I1): a quick "#WEB-47" + Enter never refers to WEB-4
  const fresh = asked === typed && search.isSuccess && !search.isPlaceholderData;
  const failed = asked === typed && search.isError;
  const stale = typed !== '' && !fresh && !failed;
  const items = typed === '' || failed ? [] : (search.data?.items ?? []);
  const pages = typed === '' || failed ? [] : (search.data?.pages ?? []);

  const itemEntries: SuggestionEntry[] = items.map((item) => {
    const type = types?.find((entry) => entry.id === item.type_id);
    return {
      key: item.id,
      content: (
        <>
          {type ? <TypeGlyph type={type} /> : <span className="size-4 shrink-0" />}
          <span translate="no" className="w-16 shrink-0 text-sm font-semibold text-muted tabular-nums">
            {item.key}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
        </>
      ),
      pick: () => {
        // the new reference shows its key at once, without asking the server
        primeItemRef(item, client);
        suggestion.command({ id: item.id, kind: 'item' });
      },
    };
  });

  const pageEntries: SuggestionEntry[] = pages.map((page) => {
    const project = projects?.find((entry) => entry.id === page.project_id);
    return {
      key: page.id,
      content: (
        <>
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            <PageGlyph emoji={page.emoji} />
          </span>
          <span className="min-w-0 flex-1 truncate">{page.title}</span>
          {project && (
            <span translate="no" className="shrink-0 text-sm text-muted">
              {t('wiki.place', { identifier: project.identifier })}
            </span>
          )}
        </>
      ),
      pick: () => {
        // the new reference shows its title at once, without asking the server
        primePageRef(page, client);
        suggestion.command({ id: page.id, kind: 'page' });
      },
    };
  });

  const status =
    typed === ''
      ? t('editor.reference.hint')
      : failed
        ? t('editor.reference.failed')
        : stale
          ? t('editor.reference.searching')
          : t('editor.reference.none', { query: typed });
  // the items first, the pages below them, each kind under its heading (an empty kind shows none)
  const sections = [
    { label: t('editor.reference.items'), entries: itemEntries },
    { label: t('editor.reference.pages'), entries: pageEntries },
  ];
  return <SuggestionMenu ref={ref} editor={suggestion.editor} label={t('editor.reference.label')} sections={sections} status={status} stale={stale} />;
}

/** What the reader does not see, or what is gone: "verborgen" only, no key, no title. */
function HiddenReference() {
  return (
    <span className="rt-ref rt-ref-hidden">
      <EyeOff aria-hidden="true" />
      {t('editor.reference.hidden')}
    </span>
  );
}

/** A reference that is no link: while it loads, when it failed, and in an editor. */
function Loading({ failed }: { failed: boolean }) {
  return <span className="rt-ref">{failed ? t('editor.reference.unknown') : '…'}</span>;
}

/** A link while reading (with `spoken` for screen readers after its text), plain text while editing. */
function Shown({ href, editable, spoken, children }: { href: string; editable: boolean; spoken?: string; children: ReactNode }) {
  return editable ? (
    <span className="rt-ref">{children}</span>
  ) : (
    <Link href={href} className="rt-ref">
      {children}
      {spoken && <span className="sr-only">, {spoken}</span>}
    </Link>
  );
}

/** An item as the reader sees it now: its type and key, its title for screen readers. */
function ItemReference({ id, editable }: { id: string; editable: boolean }) {
  const reference = useItemRef(id);
  const types = useWorkItemTypes().data?.items;
  const item = reference.data;
  if (isGone(reference.error)) return <HiddenReference />;
  if (!item) return <Loading failed={reference.isError} />;
  const type = types?.find((entry) => entry.id === item.type_id);
  return (
    <Shown href={paths.item(item.key)} editable={editable}>
      {type && <TypeGlyph type={type} className="size-3" />}
      <span translate="no">{item.key}</span> <span className="sr-only">{item.title}</span>
    </Shown>
  );
}

/** A page as the reader sees it now: its emoji (or the page glyph) and its title, a link into the wiki of its project. */
function PageReference({ id, editable }: { id: string; editable: boolean }) {
  const reference = usePageRef(id);
  const projects = useProjects({ include_archived: true }).data?.items;
  const page = reference.data;
  if (isGone(reference.error)) return <HiddenReference />;
  if (!page) return <Loading failed={reference.isError} />;
  // until the projects are there the project's id leads to the same wiki (the server answers with the identifier)
  const known = projects?.find((project) => project.id === page.project_id)?.identifier;
  const identifier = known ?? page.project_id;
  // which wiki, for screen readers: a page reads apart from a link of the same name (T18-M2)
  const spoken = known ? t('wiki.place', { identifier: known }) : undefined;
  return (
    <Shown href={paths.wiki(identifier, page.id)} editable={editable} spoken={spoken}>
      <PageGlyph emoji={page.emoji} className="" />
      {page.title}
    </Shown>
  );
}

/** A reference as the reader sees it now, by its kind. */
function ReferenceView({ node, editor }: ReactNodeViewProps) {
  const id = String(node.attrs.id ?? '');
  // follows a change of `readOnly` at once (the editor marks it with a transaction), not only on the next render
  const editable = useEditorState({ editor, selector: ({ editor: current }) => current.isEditable });
  return (
    <NodeViewWrapper as="span" className="rt-ref-wrap">
      {node.attrs.kind === 'page' ? <PageReference id={id} editable={editable} /> : <ItemReference id={id} editable={editable} />}
    </NodeViewWrapper>
  );
}

/** `#` items and pages the reader sees: stores the id and the kind, never a label (A229). */
export function referenceExtension(env: EditorEnvRef) {
  return Mention.extend({
    name: 'reference',
    addAttributes() {
      return {
        ...this.parent?.(),
        // never stored: a label would name the item or page to every later reader (App\RichText\Schema)
        label: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
        mentionSuggestionChar: { default: '#', parseHTML: () => '#', renderHTML: () => ({}) },
        kind: {
          default: 'item',
          parseHTML: (element: HTMLElement) => element.getAttribute('data-kind') ?? 'item',
          renderHTML: (attributes: Record<string, unknown>) => ({ 'data-kind': attributes.kind }),
        },
      };
    },
    addNodeView: () => ReactNodeViewRenderer(ReferenceView, { as: 'span' }),
  }).configure({
    // a reference has no text of its own (`Document::toText`)
    renderText: () => '',
    renderHTML: ({ options }) => ['span', options.HTMLAttributes],
    suggestion: {
      char: '#',
      items: () => [],
      allow: ({ state, range }) => env.current.projectId !== null && fitsAt(state, range.from, 'reference'),
      render: popupRenderer(ReferenceSuggestions, env, {}),
    },
  });
}
