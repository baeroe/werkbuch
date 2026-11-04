/*
 * "Verschieben nach …" (spec 4.15; ported from the clickdummy's MovePageDialog.tsx): the way to move a page without
 * dragging. The page goes under another page or to the top level ("Unter", a `Picker` of `moveCandidates`: never the
 * page itself or a page below it, so no move makes a cycle), in front of one of the pages there or at the end
 * ("Position"); its subpages travel with it. ⌘↵ moves (`FormDialog`).
 * - Every opening starts where the page stands now. Choosing the parent it has puts the position back to its own,
 *   another parent starts at the end.
 * - A move that would leave the page where it is sends nothing and says so under the fields.
 * - `onMove` shows the move at once and answers when the server did: with the 422 when it refused the move for a field
 *   of the dialog (the dialog stays open, the refusal stands at "Unter" or "Position", or on top), else with nothing
 *   (moved, or the screen told the person in a toast), and the dialog closes.
 */

import { CircleAlert, Layers } from 'lucide-react';
import { useId, useState } from 'react';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { describedBy, Field } from '@/components/ui/Field';
import { FormDialog } from '@/components/ui/FormDialog';
import { Select } from '@/components/ui/Select';
import { fieldMessage, noticeOf } from '@/features/settings/frame/form';
import { t } from '@/lib/i18n';
import type { PageNode } from '@/types';
import { PageGlyph } from './PageGlyph';
import { childrenOf, findPage, moveCandidates, placementOf, type Placement } from './tree';

/** The position "at the end" and the top level in the fields. */
const END = 'end';
const TOP = 'top';

export interface MovePageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: readonly PageNode[];
  /** The page to move; it stays set while the dialog closes. */
  page: PageNode | null;
  /** Answers the refusal to show in the dialog (a 422), or nothing. */
  onMove: (placement: Placement) => Promise<unknown>;
}

export function MovePageDialog({ open, onOpenChange, tree, page, onMove }: MovePageDialogProps) {
  const ids = useId();
  const start = page ? placementOf(tree, page.id) : null;
  const [choice, setChoice] = useState({ parent: TOP, before: END });
  /** Sent while the page would stay where it is: said under the fields. */
  const [stays, setStays] = useState(false);
  const [refusal, setRefusal] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  // every opening starts where the page stands now
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    setStays(false);
    setRefusal(null);
    if (open && start) setChoice({ parent: start.parent_id ?? TOP, before: start.before_id ?? END });
  }
  const choose = (next: { parent: string; before: string }) => {
    setStays(false);
    setRefusal(null);
    setChoice(next);
  };

  if (!page) return null;

  const parentId = choice.parent === TOP ? null : choice.parent;
  const parent = parentId ? findPage(tree, parentId) : undefined;
  const options: PickerOption[] = [
    { value: TOP, label: t('wiki.move.top'), icon: <Layers className="size-4 text-muted" /> },
    ...moveCandidates(tree, page.id).map((row) => ({
      value: row.id,
      label: row.node.title,
      icon: <PageGlyph emoji={row.node.emoji} className="w-4 shrink-0 text-center text-sm" />,
      hint: row.parentId ? t('wiki.move.under_hint', { title: findPage(tree, row.parentId)?.title ?? '…' }) : undefined,
    })),
  ];
  const positions = [
    ...childrenOf(tree, parentId)
      .filter((node) => node.id !== page.id)
      .map((node) => ({ value: node.id, label: t('wiki.move.before', { title: node.title }) })),
    { value: END, label: t('wiki.move.end') },
  ];
  const placement: Placement = { parent_id: parentId, before_id: choice.before === END ? null : choice.before };
  const unchanged = start !== null && start.parent_id === placement.parent_id && start.before_id === placement.before_id;
  const parentError = fieldMessage(refusal, 'parent_id');
  const beforeError = fieldMessage(refusal, 'before_id');
  const parentField = `${ids}-parent`;

  async function submit() {
    if (unchanged) return setStays(true);
    setPending(true);
    const refused = await onMove(placement);
    setPending(false);
    if (refused) setRefusal(refused);
    else onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('wiki.move.title', { title: page.title })}
      description={page.children.length > 0 ? t('wiki.move.description_children') : t('wiki.move.description')}
      submitLabel={t('wiki.move.submit')}
      onSubmit={() => void submit()}
      pending={pending}
      notice={noticeOf(refusal, ['parent_id', 'before_id'])}
    >
      <Field id={parentField} label={t('wiki.move.parent')} error={parentError}>
        <Picker
          id={parentField}
          look="form"
          label={t('wiki.move.parent')}
          display={
            <span className="flex min-w-0 items-center gap-2">
              {parent ? <PageGlyph emoji={parent.emoji} className="w-4 shrink-0 text-center text-sm" /> : <Layers className="size-4 shrink-0 text-muted" aria-hidden="true" />}
              <span className="truncate">{parent?.title ?? t('wiki.move.top')}</span>
            </span>
          }
          displayText={parent?.title ?? t('wiki.move.top')}
          options={options}
          value={choice.parent}
          onValueChange={(next) => {
            const own = start && (start.parent_id ?? TOP) === next;
            choose({ parent: next ?? TOP, before: own ? (start.before_id ?? END) : END });
          }}
          placeholder={t('wiki.move.search')}
          emptyText={t('wiki.move.no_match')}
          describedBy={describedBy(parentField, { error: parentError })}
          invalid={Boolean(parentError)}
        />
      </Field>
      <Select
        label={t('wiki.move.position')}
        options={positions}
        value={choice.before}
        onValueChange={(next) => choose({ ...choice, before: next ?? END })}
        hint={parent ? t('wiki.move.position_under', { title: parent.title }) : t('wiki.move.position_top')}
        error={beforeError}
      />
      <div aria-live="polite">
        {stays && (
          <p className="flex items-start gap-1.5 text-sm font-medium text-pretty text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {t('wiki.move.stays')}
          </p>
        )}
      </div>
    </FormDialog>
  );
}
