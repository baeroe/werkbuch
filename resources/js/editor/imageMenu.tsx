/*
 * The menu of a picture in an editor (WEBU-7), like the table menu (tables.tsx): a tab on the selected picture, at its
 * top right corner inside the picture (it covers no text), a Base UI menu. `Alt+F10` opens it from the text while a
 * picture is selected; Escape closes it and gives the focus back to the text with the picture still selected.
 * „Groß anzeigen“ (the large view, as Enter on the picture), „Alt-Text bearbeiten …“ (the field of nodes.tsx, as a
 * double click), „Original in neuem Tab öffnen“, „Herunterladen“ and „Bild entfernen“.
 */

import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState, type Editor } from '@tiptap/react';
import { Download, ExternalLink, Image as ImageIcon, Maximize2, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { attachmentUrl } from '@/api/attachments';
import { cx } from '@/components/ui/cx';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { useAttachment } from '@/hooks/attachments';
import { t } from '@/lib/i18n';
import { announce } from './announcer';
import { viewImageAt } from './imageViewer';
import { editImageAlt } from './nodes';

/** The key that opens the menu from the text (widgets.ts), the same as the table's. */
export const IMAGE_MENU_KEYS = 'alt+F10';

/** The selected picture of an editor nobody may change: none. */
export function selectedImage(editor: Editor): { pos: number; attachmentId: string | null } | null {
  if (!editor.isEditable) return null;
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return null;
  const id = selection.node.attrs.attachmentId;
  return { pos: selection.from, attachmentId: typeof id === 'string' ? id : null };
}

const opensMenu = (event: KeyboardEvent) => event.key === 'F10' && event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey;

/** Puts the focus on the first entry as soon as the menu is there: opened with Alt+F10. */
function FirstEntry({ take }: { take: RefObject<boolean> }) {
  const mark = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!take.current) return;
    const frame = requestAnimationFrame(() => {
      take.current = false;
      mark.current?.closest('[role="menu"]')?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [take]);
  return <span ref={mark} hidden />;
}

export function ImageMenu({ editor, frame }: { editor: Editor; frame: RefObject<HTMLElement | null> }) {
  const image = useEditorState({ editor, selector: ({ editor: current }) => (current.isDestroyed ? null : selectedImage(current)) });
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const triggerId = useId();
  const fromKey = useRef(false);
  const pos = image?.pos ?? null;

  // the tab sits inside the picture at its top right corner: measured anew with every change and when a box changes
  useLayoutEffect(() => {
    if (pos === null) return;
    const node = editor.view.nodeDOM(pos);
    const measure = () => {
      const around = frame.current;
      const picture = node instanceof HTMLElement ? (node.querySelector('img, .rt-image-missing') ?? node) : null;
      if (picture && around) {
        const box = picture.getBoundingClientRect();
        const outer = around.getBoundingClientRect();
        const next = { top: box.top - outer.top - around.clientTop + 6, right: outer.right - box.right - around.clientLeft + 6 };
        setPlace((current) => (current?.top === next.top && current.right === next.right ? current : next));
      }
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const box of [node, frame.current]) if (box instanceof HTMLElement) observer?.observe(box);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  });

  // Alt+F10 in the text opens the menu while a picture is selected; otherwise the key goes on (to the table menu)
  useEffect(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.dom;
    const listen = (event: KeyboardEvent) => {
      if (!opensMenu(event) || selectedImage(editor) === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      fromKey.current = true;
      setOpen(true);
    };
    // before the table menu's listener: a picture in a table cell opens its own menu
    dom.addEventListener('keydown', listen, { capture: true });
    return () => dom.removeEventListener('keydown', listen, { capture: true });
  }, [editor]);

  if (!image && !open) return null;

  /** Closing gives the focus back to the text, with the picture still selected; not when something else took it. */
  const backToText = () => {
    const active = document.activeElement;
    const elsewhere = active !== null && active !== document.body && active !== trigger.current && active.closest('[role="menu"]') === null;
    if (!elsewhere && !editor.isDestroyed) editor.view.focus();
    return false;
  };

  return (
    <Menu open={open} onOpenChange={setOpen} triggerId={triggerId}>
      <MenuTrigger
        ref={trigger}
        id={triggerId}
        aria-label={t('editor.image.menu')}
        aria-keyshortcuts={ariaKeyshortcuts(IMAGE_MENU_KEYS)}
        className={cx(
          'absolute z-10 inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-chip border border-line bg-raised px-2.5 text-sm font-medium text-muted shadow-sm',
          'transition-colors duration-120 hover:bg-hover hover:text-ink data-popup-open:text-ink md:h-6 md:px-2',
          !place && 'invisible',
        )}
        style={place ? { top: place.top, right: place.right } : undefined}
      >
        <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />
        {t('editor.image.button')}
      </MenuTrigger>
      {image && (
        <MenuContent align="end" className="w-64" finalFocus={backToText}>
          <FirstEntry take={fromKey} />
          <MenuItem icon={Maximize2} onClick={() => viewImageAt(editor.state.doc, image.pos, editor.view.dom)}>
            {t('editor.image.menu_view')}
          </MenuItem>
          <MenuItem icon={Pencil} onClick={() => editImageAlt(editor.view, image.pos)}>
            {t('editor.image.menu_alt')}
          </MenuItem>
          <MenuSeparator />
          <FileEntries attachmentId={image.attachmentId} />
          <MenuSeparator />
          <MenuItem
            icon={Trash2}
            danger
            onClick={() => {
              editor.chain().focus().deleteSelection().run();
              announce(editor.view.dom, t('editor.image.removed'));
            }}
          >
            {t('editor.image.menu_remove')}
          </MenuItem>
        </MenuContent>
      )}
    </Menu>
  );
}

/**
 * „Original in neuem Tab öffnen“ and „Herunterladen“: the file of the picture, read only while the menu is open (an
 * editor without a picture selected asks for nothing). Disabled until the attachment is there.
 */
function FileEntries({ attachmentId }: { attachmentId: string | null }) {
  const attachment = useAttachment(attachmentId).data;
  return (
    <>
      <MenuItem icon={ExternalLink} disabled={!attachment} onClick={() => attachment && window.open(attachment.url, '_blank', 'noopener')}>
        {t('editor.image.open')}
      </MenuItem>
      <MenuItem
        icon={Download}
        disabled={!attachment}
        onClick={
          attachment &&
          (() => {
            const link = document.createElement('a');
            link.href = attachmentUrl(attachment, { download: true });
            link.download = attachment.filename;
            link.click();
          })
        }
      >
        {t('editor.image.menu_download')}
      </MenuItem>
    </>
  );
}
