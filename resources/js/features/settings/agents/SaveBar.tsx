/*
 * The save buttons of a long settings form (the rules of the agents, the agents of a project, the agent of a bot): with
 * changes, a strip of tracing paper stays at the bottom of the window while the form scrolls, so "Save" is never out of
 * reach; ⌘↵ saves as well. Without changes it sits at the end of the form.
 */

import { cx } from '@/components/ui/cx';
import { FormActions } from '../frame/parts';

type SaveBarProps = {
  dirty: boolean;
  pending: boolean;
  quiet: boolean;
  onReset: () => void;
};

export function SaveBar({ dirty, pending, quiet, onReset }: SaveBarProps) {
  return (
    <div
      data-save-bar=""
      className={cx('flex flex-wrap items-center justify-end gap-2 rounded-card px-4 py-2.5 md:px-5', dirty ? 'tracing-strong sticky bottom-3 z-10 [--glass-shadow:var(--elev-2)]' : 'border border-line bg-surface shadow-elev-1')}
    >
      <FormActions dirty={dirty} pending={pending} quiet={quiet} onReset={onReset} />
    </div>
  );
}
