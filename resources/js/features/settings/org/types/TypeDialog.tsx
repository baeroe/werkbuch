/*
 * Creating and changing a type (spec 4.6): name, icon, tone, description, the Epic mark and the properties it carries,
 * each required or not, in the order the form shows them; a preview of the tab beside the name. The dialog sends the
 * whole type every time (P24), its archive stamp included: an archived type stays archived when it is changed here, and
 * only "Restore" in the list brings it back.
 */

import { X } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { Checkbox } from '@/components/ui/Checkbox';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SortableList } from '@/components/ui/SortableList';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { TypeTab } from '@/components/ui/TypeTab';
import { useSaveWorkItemType } from '@/hooks/workItemTypes';
import { useSettle } from '@/hooks/mutation';
import { t } from '@/lib/i18n';
import type { Property, TypeTone, WorkItemType } from '@/types';
import { FIELD_TYPE_LABELS, TONE_LABELS } from '../../catalog/choices';
import { ToneSelect } from '../../catalog/ToneSelect';
import { fieldMessage, focusNeighbour, noticeOf } from '../../frame/form';
import { FieldGroup } from '../../frame/parts';
import { IconPicker } from './IconPicker';

interface Assigned {
  /** The id of the property; it names the row, too. */
  id: string;
  required: boolean;
}

type TypeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The type to change; null creates one. */
  type: WorkItemType | null;
  /** Every property of the catalog. */
  properties: Property[];
  finalFocus: RefObject<HTMLElement | null>;
};

export function TypeDialog({ open, onOpenChange, type, properties, finalFocus }: TypeDialogProps) {
  const settle = useSettle();
  const save = useSaveWorkItemType();
  const byId = new Map(properties.map((property) => [property.id, property]));
  const [name, setName] = useState(type?.name ?? '');
  const [icon, setIcon] = useState(type?.icon ?? 'square-check');
  const [tone, setTone] = useState<TypeTone>(type?.tone ?? 'sky');
  const [description, setDescription] = useState(type?.description ?? '');
  const [isEpic, setIsEpic] = useState(type?.is_epic ?? false);
  const [assigned, setAssigned] = useState<Assigned[]>(() =>
    [...(type?.properties ?? [])]
      .sort((a, b) => a.position - b.position)
      .filter((entry) => byId.has(entry.property_id))
      .map((entry) => ({ id: entry.property_id, required: entry.required })),
  );
  const [attempted, setAttempted] = useState(false);

  const nameError = attempted && name.trim() === '' ? t('settings.types.dialog.name_required') : fieldMessage(save.error, 'name');
  const iconError = fieldMessage(save.error, 'icon');
  const toneError = fieldMessage(save.error, 'tone');
  const propertiesError = fieldMessage(save.error, 'properties');
  const free = properties.filter((property) => !assigned.some((entry) => entry.id === property.id));
  const labelOf = (id: string) => byId.get(id)!.label;

  function submit() {
    setAttempted(true);
    if (name.trim() === '') {
      document.getElementById('type-name')?.focus();
      return;
    }
    settle(
      save.mutateAsync({
        id: type?.id,
        name,
        icon,
        tone,
        description: description.trim(),
        is_epic: isEpic,
        // the order of the list is the order of the form
        properties: assigned.map((entry) => ({ property_id: entry.id, required: entry.required })),
        // the whole type (P24): an archived one stays archived
        archived_at: type?.archived_at ?? null,
      }),
      {
        onSuccess: (saved) => {
          onOpenChange(false);
          toast({ title: type ? t('settings.types.dialog.saved', { name: saved.name }) : t('settings.types.dialog.created', { name: saved.name }), tone: 'success' });
        },
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={type ? t('settings.types.edit', { name: type.name }) : t('settings.types.create')}
      description={t('settings.types.dialog.description')}
      submitLabel={type ? t('settings.frame.save') : t('settings.catalog.submit_create')}
      pending={save.isPending}
      notice={noticeOf(save.error, ['name', 'icon', 'tone', 'properties'])}
      finalFocus={finalFocus}
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-56">
          <Input id="type-name" name="name" label={t('settings.catalog.name')} autoComplete="off" value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
        </div>
        <div aria-hidden="true" className="pb-1.5">
          <p className="mb-1.5 text-sm text-muted">{t('settings.types.dialog.preview')}</p>
          <div className="pt-1">
            <TypeTab tone={tone} icon={icon} label={name.trim() || t('settings.types.dialog.preview_name')} />
          </div>
        </div>
      </div>
      <FieldGroup legend={t('settings.types.dialog.icon')} error={iconError}>
        <IconPicker label={t('settings.types.dialog.icon')} value={icon} onChange={setIcon} invalid={iconError !== undefined} />
      </FieldGroup>
      <FieldGroup legend={t('settings.types.dialog.color')} hint={t('settings.types.dialog.color_hint')} error={toneError}>
        <div className="flex items-center gap-3">
          <ToneSelect label={t('settings.types.dialog.color_label')} value={tone} onChange={setTone} invalid={toneError !== undefined} />
          <span className="text-ui text-muted" aria-hidden="true">
            {t(TONE_LABELS[tone])}
          </span>
        </div>
      </FieldGroup>
      <Textarea
        label={t('settings.types.dialog.description_label')}
        name="description"
        autoComplete="off"
        hint={t('settings.types.dialog.description_hint')}
        rows={2}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="flex flex-col gap-1">
        <Switch label={t('settings.types.dialog.epic')} checked={isEpic} onCheckedChange={setIsEpic} />
        <p className="pl-12 text-sm text-pretty text-muted">{t('settings.types.dialog.epic_hint')}</p>
      </div>

      <FieldGroup legend={t('settings.types.dialog.properties')} hint={t('settings.types.dialog.properties_hint')}>
        {assigned.length > 0 && (
          <SortableList
            items={assigned}
            label={t('settings.types.dialog.properties_list')}
            nameOf={(entry) => labelOf(entry.id)}
            onReorder={setAssigned}
            className="mb-2 divide-y divide-line rounded-ctl border border-line bg-surface"
            renderItem={(entry, { handle }) => {
              const property = byId.get(entry.id)!;
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5">
                  {handle}
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-ui font-medium text-ink">{property.label}</p>
                    <p className="text-sm text-muted">{t(FIELD_TYPE_LABELS[property.field_type])}</p>
                  </div>
                  <Checkbox
                    label={t('settings.types.dialog.required')}
                    aria-label={t('settings.types.dialog.required_of', { label: property.label })}
                    checked={entry.required}
                    onCheckedChange={(required) => setAssigned((current) => current.map((candidate) => (candidate.id === entry.id ? { ...candidate, required } : candidate)))}
                  />
                  <IconButton
                    icon={X}
                    label={t('settings.types.dialog.remove_property', { label: property.label })}
                    onClick={(event) => {
                      // the focus goes on to the next property (or the one before), after the last to the choice below
                      focusNeighbour(event.currentTarget.closest('li'), document.getElementById('type-add-property'));
                      setAssigned((current) => current.filter((candidate) => candidate.id !== entry.id));
                    }}
                  />
                </div>
              );
            }}
          />
        )}
        <Select
          id="type-add-property"
          aria-label={t('settings.types.dialog.add_property')}
          placeholder={free.length === 0 ? t('settings.types.dialog.all_assigned') : t('settings.types.dialog.add_property_placeholder')}
          disabled={free.length === 0}
          error={propertiesError}
          value={null}
          onValueChange={(next) => next && setAssigned((current) => [...current, { id: next, required: false }])}
          options={free.map((property) => ({ value: property.id, label: property.label }))}
        />
      </FieldGroup>
    </FormDialog>
  );
}
