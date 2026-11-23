/*
 * The save buttons of a long settings form (agent of a bot, agents of a project). With changes, a strip of tracing paper
 * stays at the bottom of the window while the form scrolls, so "Speichern" is never out of reach; ⌘↵ saves as well.
 */

import { cx } from '@/components/ui/cx';
import { FormActions } from '@/features/settings/project/SettingsParts';

type SaveBarProps = {
  dirty: boolean;
  pending: boolean;
  quiet: boolean;
  onReset: () => void;
};

export function SaveBar({ dirty, pending, quiet, onReset }: SaveBarProps) {
  return (
    // it floats only while there is something to save; otherwise it sits at the end of the form
    <div className={cx('flex flex-wrap items-center justify-end gap-2 rounded-card px-4 py-2.5', dirty ? 'tracing-strong sticky bottom-3 z-10 [--glass-shadow:var(--elev-2)]' : 'border border-line bg-surface shadow-elev-1')}>
      <FormActions dirty={dirty} pending={pending} quiet={quiet} onReset={onReset} />
    </div>
  );
}
