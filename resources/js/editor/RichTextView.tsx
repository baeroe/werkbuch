/*
 * A document read-only, with the nodes of a level (presets.ts) and the look of the editor: the same schema, so what
 * the editor wrote reads the same here. Blocks the level does not know show their text in paragraphs.
 *
 *   <RichTextView value={item.description_json} preset="description" />
 */

import { EditorContent, useEditor } from '@tiptap/react';
import { Suspense, useEffect } from 'react';
import { cx } from '@/components/ui/cx';
import type { RichText } from '@/types';
import type { EditorPreset } from './presets';
import { fitDoc, showsDoc, useLevel } from './RichTextEditor';

interface RichTextViewProps {
  value: RichText | null;
  preset: EditorPreset;
  className?: string;
}

export function RichTextView(props: RichTextViewProps) {
  return (
    <Suspense fallback={<div className={cx('rt', props.className)} data-preset={props.preset} aria-busy="true" />}>
      <Viewer {...props} />
    </Suspense>
  );
}

function Viewer({ value, preset, className }: RichTextViewProps) {
  const { extensions, schema } = useLevel(preset, null);
  const editor = useEditor(
    {
      extensions,
      content: fitDoc(value, schema),
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
    const doc = fitDoc(value, editor.schema);
    if (!showsDoc(editor, doc)) editor.commands.setContent(doc, { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={cx('rt', className)} data-preset={preset}>
      <EditorContent editor={editor} />
    </div>
  );
}
