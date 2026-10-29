/*
 * "Verschieben nach …" (spec 4.15): the way to move a page without dragging. The page goes under another page (or to
 * the top level), in front of one of the pages there or at the end; its subpages travel with it. The page itself and
 * its own subtree are not offered as a new parent. mod+enter moves.
 */

import { CircleAlert, FileText, Layers, MoveRight } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Select';
import { labelClass } from '@/components/ui/styles';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { PageNode } from '@/types';
import { childrenOf, findPage, moveCandidates, placementOf, type Placement } from './tree';

/** The position "at the end" in the select. */
const END = 'end';
const TOP = '';

/** A page's emoji, or a page glyph when it has none. */
export function PageGlyph({ emoji, className = 'text-base' }: { emoji: string | null; className?: string }) {
  return emoji ? (
    <span aria-hidden="true" className={className}>
      {emoji}
    </span>
  ) : (
    <FileText className="size-4 text-muted" aria-hidden="true" />
  );
}

type MovePageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: PageNode[];
  /** The page to move; it stays set while the dialog closes. */
  page: PageNode | null;
  onMove: (placement: Placement) => void;
};

export function MovePageDialog({ open, onOpenChange, tree, page, onMove }: MovePageDialogProps) {
  const form = useRef<HTMLFormElement>(null);
  const formId = useId();
  const start = page ? placementOf(tree, page.id) : null;
  const [choice, setChoice] = useState<{ parent: string; before: string }>({ parent: TOP, before: END });
  /** "Verschieben" pressed while the page would stay where it is: said under the fields. */
  const [stays, setStays] = useState(false);
  // every opening starts where the page stands now
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setStays(false);
    if (open && start) setChoice({ parent: start.parent_id ?? TOP, before: start.before_id ?? END });
  }
  const choose = (next: { parent: string; before: string }) => {
    setStays(false);
    setChoice(next);
  };

  useShortcut({ id: 'wiki.move.submit', keys: 'mod+enter', scope: 'dialog', label: 'Seite verschieben', group: 'Dialog', run: () => form.current?.requestSubmit(), when: () => open }, [open]);

  if (!page) return null;

  const parentId = choice.parent === TOP ? null : choice.parent;
  const parent = parentId ? findPage(tree, parentId) : null;
  const options: PickerOption[] = [
    { value: TOP, label: 'Oberste Ebene', icon: <Layers className="size-4 text-muted" /> },
    ...moveCandidates(tree, page.id).map((row) => ({
      value: row.id,
      label: row.node.title,
      icon: <PageGlyph emoji={row.node.emoji} />,
      hint: row.parentId ? `unter ${findPage(tree, row.parentId)?.title ?? '…'}` : undefined,
    })),
  ];
  const siblings = childrenOf(tree, parentId).filter((node) => node.id !== page.id);
  const positions = [...siblings.map((node) => ({ value: node.id, label: `Vor „${node.title}“` })), { value: END, label: 'Ans Ende' }];
  const placement: Placement = { parent_id: parentId, before_id: choice.before === END ? null : choice.before };
  const unchanged = start !== null && start.parent_id === placement.parent_id && start.before_id === placement.before_id;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (unchanged) {
      setStays(true);
      return;
    }
    onMove(placement);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`„${page.title}“ verschieben nach …`}
      description={page.children.length > 0 ? 'Wähle die neue übergeordnete Seite und die Stelle darunter. Die Unterseiten wandern mit.' : 'Wähle die neue übergeordnete Seite und die Stelle darunter.'}
      footer={
        <>
          <DialogClose render={<Button variant="ghost">Abbrechen</Button>} />
          <Button type="submit" form={formId} variant="primary" icon={MoveRight} shortcut="mod+enter">
            Verschieben
          </Button>
        </>
      }
    >
      <form ref={form} id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col">
          {/* the trigger's own name starts with the label */}
          <span aria-hidden="true" className={`${labelClass} mb-1.5`}>
            Übergeordnete Seite
          </span>
          <Picker
            look="form"
            label="Übergeordnete Seite"
            display={
              parent ? (
                <span className="flex min-w-0 items-center gap-2">
                  <PageGlyph emoji={parent.emoji} />
                  <span className="truncate">{parent.title}</span>
                </span>
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  <Layers className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  <span className="truncate">Oberste Ebene</span>
                </span>
              )
            }
            displayText={parent?.title ?? 'Oberste Ebene'}
            options={options}
            value={choice.parent}
            onValueChange={(next) => {
              const before = start && (start.parent_id ?? TOP) === next ? (start.before_id ?? END) : END;
              choose({ parent: next, before });
            }}
            placeholder="Seite suchen …"
            emptyText="Keine Seite mit diesem Titel."
          />
        </div>
        <Select
          label="Position"
          options={positions}
          value={choice.before}
          onValueChange={(next) => choose({ ...choice, before: next ?? END })}
          hint={parent ? `Unter „${parent.title}“.` : 'Auf der obersten Ebene des Wikis.'}
        />
        <div aria-live="polite">
          {stays && (
            <p className="flex items-start gap-1.5 text-sm font-medium text-pretty text-danger">
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              Die Seite steht schon an dieser Stelle. Wähle eine andere übergeordnete Seite oder Position.
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}
