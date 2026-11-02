/*
 * What every value editor of a chip takes, and the look of the parts of a chip that open something.
 */

import type { Condition, Project } from '@/types';
import type { FieldDef } from '../fieldOps';

export type ValueEditorProps = {
  condition: Condition;
  def: FieldDef;
  /** The name of the field: "Status", a property's label. */
  label: string;
  onChange: (condition: Condition) => void;
  /** The value editor is open (a new condition opens it at once). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project of a project list: its workflow's states. */
  project?: Project;
};

/** The parts of a chip that open something: quiet until hovered; 44 px tall on phones. */
export const chipPart =
  'inline-flex h-11 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-chip px-1.5 text-sm transition-colors duration-120 hover:bg-hover data-popup-open:bg-hover md:h-6';
