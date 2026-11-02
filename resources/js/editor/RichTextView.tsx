/*
 * A document read-only, with the nodes of a level (presets.ts) and the look of the editor: the same schema, so what
 * the editor wrote reads the same here. Blocks the level does not know show their text in paragraphs. Mentions show
 * the current handle, references the item's key as a link (or "verborgen"), code is highlighted, images open their
 * original in a new tab and files are chips to download (nodes.tsx). Nothing is uploaded here.
 *
 *   <RichTextView value={item.description_json} preset="description" />
 */

import { EditorContent, useEditor } from '@tiptap/react';
import { Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import type { RichText } from '@/types';
import type { EditorEnv } from './EditorEnv';
import type { EditorPreset } from './presets';
import { fitDoc, LateBoundary, showsDoc, useLevel } from './RichTextEditor';

interface RichTextViewProps {
  value: RichText | null;
  preset: EditorPreset;
  className?: string;
}

export function RichTextView(props: RichTextViewProps) {
  const frame = (inside: ReactNode) => (
    <div className={cx('rt', props.className)} data-preset={props.preset} aria-busy={inside === null ? 'true' : undefined}>
      {inside}
    </div>
  );
  return (
    <LateBoundary frame={frame}>
      <Suspense fallback={frame(null)}>
        <Viewer {...props} />
      </Suspense>
    </LateBoundary>
  );
}

function Viewer({ value, preset, className }: RichTextViewProps) {
  // a text to read: no `@`, no `#`
  const env = useRef<EditorEnv>({ projectId: null });
  const { extensions, schema } = useLevel(preset, env, null);
  const content = useMemo(() => fitDoc(value, schema), [value, schema]);
  const editor = useEditor(
    {
      extensions,
      content,
      editable: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      // text to read, no text box
      editorProps: { attributes: { role: 'presentation', class: 'rt-content' } },
    },
    [extensions],
  );

  useEffect(() => {
    if (editor.isDestroyed) return;
    if (!showsDoc(editor, content)) editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, content]);

  return (
    <div className={cx('rt', className)} data-preset={preset}>
      <EditorContent editor={editor} />
    </div>
  );
}
