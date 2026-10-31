/*
 * The icon of a type: the 20 icons of `TYPE_ICONS` as one radio group. Tab reaches the chosen icon, the arrows move the
 * choice, and every icon is named for screen readers and in its tooltip (`TYPE_ICON_LABELS`).
 */

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { cx } from '@/components/ui/cx';
import { TYPE_ICONS, type TypeIconName } from '@/components/ui/TypeTab';
import { t } from '@/lib/i18n';
import { TYPE_ICON_LABELS } from '../../catalog/choices';

type IconPickerProps = {
  value: string;
  onChange: (icon: string) => void;
  /** Names the group: "Icon". */
  label: string;
  /** The server refused the icon: the chosen one is marked, so the focus lands on it. */
  invalid?: boolean;
};

const NAMES = Object.keys(TYPE_ICONS) as TypeIconName[];

export function IconPicker({ value, onChange, label, invalid = false }: IconPickerProps) {
  // the radio that Tab reaches: the chosen one, or the first while none is (an icon the picker does not know)
  const reached = NAMES.includes(value as TypeIconName) ? value : NAMES[0];
  return (
    <RadioGroup aria-label={label} value={value} onValueChange={(next) => onChange(String(next))} className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
      {NAMES.map((name) => {
        const Icon = TYPE_ICONS[name];
        const iconLabel = t(TYPE_ICON_LABELS[name]);
        return (
          <Radio.Root
            key={name}
            value={name}
            aria-label={iconLabel}
            title={iconLabel}
            aria-invalid={invalid && name === reached ? true : undefined}
            className={cx(
              'inline-flex size-11 cursor-pointer items-center justify-center rounded-ctl border border-line bg-surface text-muted transition-colors duration-120 hover:border-line-input hover:text-ink md:size-9',
              'data-checked:border-ink data-checked:bg-raised data-checked:text-ink data-checked:ring-1 data-checked:ring-ink aria-invalid:border-danger aria-invalid:ring-danger',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}
