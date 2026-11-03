/*
 * Mentions in rich text (spec 4.16): `@` lists the people and bots who can be mentioned in the editor's project
 * (`GET /mentions`, the rule of assignees, A231) and stores a `mention` node with the account's id and the handle it
 * had (`{id, label}`). A mention shows the handle the account has now (`@mara`), a deactivated one with
 * "(deaktiviert)"; an account the reader does not know shows the stored handle. Without a project there is no `@`.
 */

import Mention from '@tiptap/extension-mention';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import type { EditorState } from '@tiptap/pm/state';
import { botWord } from '@/components/fields/format';
import { useUserMap } from '@/components/fields/itemData';
import { Avatar } from '@/components/ui/Avatar';
import { qk } from '@/hooks/keys';
import { useMentionables } from '@/hooks/richText';
import { t } from '@/lib/i18n';
import type { EditorEnvRef } from './EditorEnv';
import { popupRenderer, SuggestionMenu, useAsked, type PopupProps, type SuggestionEntry } from './suggestions';

/** Whether the node may stand where the typed character is (not in code), as Tiptap's default `allow` asks. */
export function fitsAt(state: EditorState, from: number, node: string): boolean {
  return state.doc.resolve(from).parent.type.contentMatch.matchType(state.schema.nodes[node]) !== null;
}

function PeopleSuggestions({ suggestion, env, ref }: PopupProps) {
  const typed = suggestion.query.trim();
  const project = env.current.projectId;
  const asked = useAsked(typed, (q) => qk.mentions.list({ project, q }));
  const people = useMentionables(project, asked);
  // only an answer to what is typed now may be taken (T16-I1); until it is there the list shows the last one, greyed
  const fresh = asked === typed && people.isSuccess && !people.isPlaceholderData;
  const failed = asked === typed && people.isError;
  const entries: SuggestionEntry[] = (failed ? [] : (people.data ?? [])).map((user) => ({
    key: user.id,
    content: (
      <>
        <Avatar user={user} size="sm" decorative />
        <span className="min-w-0 flex-1 truncate">{user.name}</span>
        <span translate="no" className="shrink-0 text-sm text-muted">
          {botWord(user) ?? `@${user.handle}`}
        </span>
      </>
    ),
    pick: () => suggestion.command({ id: user.id, label: user.handle }),
  }));
  const stale = !fresh && !failed;
  const status = failed ? t('editor.mention.failed') : stale ? t('editor.mention.searching') : t('editor.mention.none', { query: typed });
  return <SuggestionMenu ref={ref} editor={suggestion.editor} label={t('editor.mention.label')} sections={[{ entries }]} status={status} stale={stale} />;
}

/** A mention as the reader sees it now: the current handle, deactivated accounts marked. */
function MentionView({ node }: ReactNodeViewProps) {
  const user = useUserMap().get(String(node.attrs.id ?? ''));
  const handle = user?.handle ?? String(node.attrs.label ?? '');
  return (
    <NodeViewWrapper as="span" className="rt-mention" translate="no">
      @{handle}
      {user?.disabled_at && <span className="rt-mention-off"> {t('editor.mention.disabled')}</span>}
    </NodeViewWrapper>
  );
}

/** `@` people and bots of the project: stores the id and the handle (`@mara`). */
export function mentionExtension(env: EditorEnvRef) {
  return Mention.extend({
    addNodeView: () => ReactNodeViewRenderer(MentionView, { as: 'span' }),
  }).configure({
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      char: '@',
      items: () => [],
      allow: ({ state, range }) => env.current.projectId !== null && fitsAt(state, range.from, 'mention'),
      render: popupRenderer(PeopleSuggestions, env, {}),
    },
  });
}
