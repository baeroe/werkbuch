/*
 * One of the six muted tones, chosen from a menu: a label, a type, the options of a dropdown. The trigger shows the dot
 * of the chosen tone and names it for screen readers; the menu lists every tone with its dot and its name, never colour
 * alone.
 */

import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { t } from '@/lib/i18n';
import type { TypeTone } from '@/types';
import { TONE_LABELS, TONES } from './choices';

type ToneSelectProps = {
  value: TypeTone;
  onChange: (tone: TypeTone) => void;
  /** Names the choice for screen readers: "Colour of the label". */
  label: string;
  disabled?: boolean;
};

export function ToneSelect({ value, onChange, label, disabled }: ToneSelectProps) {
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        aria-label={t('settings.catalog.tone_named', { label, tone: t(TONE_LABELS[value]) })}
        className={cx(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface shadow-elev-1 transition-colors duration-120 md:size-9',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-line-input hover:bg-sunken',
        )}
      >
        <ToneDot tone={value} className="size-3" />
      </MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as TypeTone)}>
          {TONES.map((tone) => (
            <MenuRadioItem key={tone} value={tone}>
              <span className="flex items-center gap-2">
                <ToneDot tone={tone} className="size-2.5" />
                {t(TONE_LABELS[tone])}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
