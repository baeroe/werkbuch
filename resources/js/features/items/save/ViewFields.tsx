/*
 * The name and icon of a view, as the dialogs ask for them ("Als neue View speichern", later "Neue View" and "View
 * bearbeiten" of the overview, K23). The icon is one of `ICON_OPTIONS` or an emoji from the picker beside it (the server
 * takes exactly one emoji); an icon the list does not offer (an emoji, an icon of the seed) stays the first choice.
 * Controlled: the dialog holds the values and the errors of the server.
 */

import { Smile } from 'lucide-react';
import { useState, type Ref } from 'react';
import { Button } from '@/components/ui/Button';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Select } from '@/components/ui/Select';
import { ICON_OPTIONS, ViewIcon } from '@/components/ui/ViewIcon';
import { t } from '@/lib/i18n';

/** The longest name a view may have (`ViewInput::NAME_MAX`). */
export const VIEW_NAME_MAX = 60;

type ViewFieldsProps = {
  name: string;
  onName(name: string): void;
  icon: string;
  onIcon(icon: string): void;
  /** The refusals of the server (or of the dialog) at the two fields. */
  errors?: { name?: string | undefined; icon?: string | undefined };
  nameRef?: Ref<HTMLInputElement>;
};

export function ViewFields({ name, onName, icon, onIcon, errors = {}, nameRef }: ViewFieldsProps) {
  const [picking, setPicking] = useState(false);
  const options = [
    ...(ICON_OPTIONS.some((option) => option.value === icon) ? [] : [{ value: icon, label: t('views.fields.icon_own') }]),
    ...ICON_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) })),
  ].map((option) => ({ ...option, icon: <ViewIcon icon={option.value} className="text-muted" /> }));

  return (
    <>
      <Input
        ref={nameRef}
        name="view_name"
        label={t('views.fields.name')}
        hint={t('views.fields.name_hint')}
        value={name}
        autoComplete="off"
        error={errors.name}
        onChange={(event) => onName(event.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <Select label={t('views.fields.icon')} value={icon} onValueChange={(next) => next && onIcon(next)} options={options} error={errors.icon} />
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger
            render={
              <Button variant="ghost" size="sm" icon={Smile} className="self-start">
                {t('views.fields.emoji')}
              </Button>
            }
          />
          <PopoverContent title={t('views.fields.emoji')} className="w-auto p-3">
            <EmojiPicker
              className="mt-2"
              onPick={(emoji) => {
                onIcon(emoji);
                setPicking(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
