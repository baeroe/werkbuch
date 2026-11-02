/*
 * References in rich text (spec 4.16): `#` searches the items the reader sees (`GET /search`, items only, A230) and
 * stores a `reference` node with the item's id and kind only (`{id, kind: 'item'}`): no key, no title, so a text never
 * names an item to a reader who may not see it (A229). A reference is resolved when it shows (`useItemRef`, one
 * `GET /references` for every reference of a tick): the type and the key the item has now, its title for screen
 * readers, a link to the item while reading; "verborgen" for an item the reader does not see (or one that is gone),
 * "…" while it loads. Without a project there is no `#`.
 */

import { Link } from '@inertiajs/react';
import { useQueryClient } from '@tanstack/react-query';
import Mention from '@tiptap/extension-mention';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { EyeOff } from 'lucide-react';
import { isGone } from '@/api/client';
import { TypeGlyph } from '@/components/fields/TypeGlyph';
import { primeItemRef, useItemRef } from '@/hooks/richText';
import { useSearch } from '@/hooks/search';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { EditorEnvRef } from './EditorEnv';
import { fitsAt } from './mentions';
import { popupRenderer, SuggestionMenu, useSettled, type PopupProps, type SuggestionEntry } from './suggestions';

/** As many hits as the list shows. */
export const MAX_ITEMS = 6;

function ReferenceSuggestions({ suggestion, ref }: PopupProps) {
  const typed = suggestion.query.trim();
  const query = useSettled(typed);
  const search = useSearch(query, { types: ['items'], limit: MAX_ITEMS });
  const types = useWorkItemTypes().data?.items;
  const client = useQueryClient();
  const items = typed === '' ? [] : (search.data?.items ?? []);

  const entries: SuggestionEntry[] = items.map((item) => {
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

  const status =
    typed === ''
      ? t('editor.reference.hint')
      : search.isError
        ? t('editor.reference.failed')
        : typed !== query || search.isFetching
          ? t('editor.reference.searching')
          : t('editor.reference.none', { query: typed });
  return <SuggestionMenu ref={ref} editor={suggestion.editor} label={t('editor.reference.label')} sections={[{ entries }]} status={status} />;
}

/** A reference as the reader sees it now: the item's type and key, or "verborgen". */
function ReferenceView({ node, editor }: ReactNodeViewProps) {
  const reference = useItemRef(String(node.attrs.id ?? ''));
  const types = useWorkItemTypes().data?.items;
  const item = reference.data;

  let content;
  if (isGone(reference.error)) {
    content = (
      <span className="rt-ref rt-ref-hidden">
        <EyeOff aria-hidden="true" />
        {t('editor.reference.hidden')}
      </span>
    );
  } else if (!item) {
    content = <span className="rt-ref">{reference.isError ? t('editor.reference.unknown') : '…'}</span>;
  } else {
    const type = types?.find((entry) => entry.id === item.type_id);
    const inner = (
      <>
        {type && <TypeGlyph type={type} className="size-3" />}
        <span translate="no">{item.key}</span>{' '}
        <span className="sr-only">{item.title}</span>
      </>
    );
    content = editor.isEditable ? (
      <span className="rt-ref">{inner}</span>
    ) : (
      <Link href={paths.item(item.key)} className="rt-ref">
        {inner}
      </Link>
    );
  }
  return (
    <NodeViewWrapper as="span" className="rt-ref-wrap">
      {content}
    </NodeViewWrapper>
  );
}

/** `#` items the reader sees: stores the id and the kind, never a label (A229). */
export function referenceExtension(env: EditorEnvRef) {
  return Mention.extend({
    name: 'reference',
    addAttributes() {
      return {
        ...this.parent?.(),
        // never stored: a label would name the item to every later reader (App\RichText\Schema)
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
