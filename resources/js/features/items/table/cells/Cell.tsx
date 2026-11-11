/*
 * A cell of the table, one per display field (spec 4.11 "Inline-Bearbeitung mit der Tastatur"), ported from the
 * clickdummy's `cells.tsx`: status, assignee, priority, labels and the dates open the same pickers as everywhere (look
 * "bare", no tab stop of their own); the properties their own editors (`PropertyCells`); project, created and changed
 * only show. Every cell is controlled by the table: `editing` opens its editor, `onEditingChange(false)` says it closed,
 * and `onEditingChange(true)` asks to open it (a click), which the table answers. An editor open when the rights go
 * (the item archived, the role lowered) closes: its editor goes without saying so, and the table would open it again
 * when they come back.
 */

import { useLayoutEffect } from 'react';

import { AssigneePicker } from '@/components/fields/AssigneePicker';
import { useEditReason } from '@/components/fields/itemData';
import { PriorityPicker } from '@/components/fields/PriorityPicker';
import { StatePicker } from '@/components/fields/StatePicker';
import type { ListedItem } from '@/types';
import type { Column } from '../columns';
import { CoreDateCell, LabelsCell, ProjectCell, type EditProps } from './CoreCells';
import { PropertyCell, type CellRefusal } from './PropertyCells';
import { StampCell } from './StampCell';

/** `refusal`: the words the table keeps for the cell of a property (`useRefusals`). */
type CellProps = EditProps & { item: ListedItem; column: Column; refusal?: CellRefusal };

export function Cell({ item, column, editing, onEditingChange, refusal }: CellProps) {
  const readOnly = useEditReason(item) !== null;
  useLayoutEffect(() => {
    if (readOnly && editing) onEditingChange(false);
  }, [readOnly, editing, onEditingChange]);
  const picker = { item, look: 'bare', tabIndex: -1, open: editing, onOpenChange: onEditingChange } as const;
  switch (column.field) {
    case 'state':
      return <StatePicker {...picker} />;
    case 'assignee':
      return <AssigneePicker {...picker} />;
    case 'priority':
      return <PriorityPicker {...picker} />;
    case 'labels':
      return <LabelsCell item={item} editing={editing} onEditingChange={onEditingChange} />;
    case 'start_date':
    case 'due_date':
      return <CoreDateCell item={item} field={column.field} editing={editing} onEditingChange={onEditingChange} />;
    case 'project':
      return <ProjectCell item={item} />;
    case 'created_at':
    case 'updated_at':
      return <StampCell value={item[column.field]} />;
    default:
      return <PropertyCell item={item} property={column.property!} refusal={refusal!} editing={editing} onEditingChange={onEditingChange} />;
  }
}
