/*
 * Resolutions (spec 4.7): how an item ends. Moving into a status of the category Completed or Canceled sets one, chosen
 * or the default of the category; moving back clears it. Each category has exactly one default at all times (P20): a
 * new default takes the mark from the old one, and a default keeps it until another one takes it, so it can neither be
 * deleted nor archived nor lose its mark in its own dialog. Archived resolutions can no longer be chosen. Whether a
 * resolution that items carry is archived instead of deleted comes with the items (P28).
 */

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useDeleteResolution, useResolutions, useSaveResolution } from '@/hooks/catalog';
import { useSettle } from '@/hooks/mutation';
import { t } from '@/lib/i18n';
import type { Resolution } from '@/types';
import { CATEGORY_LABELS } from '../../catalog/choices';
import { ReadOnlyNotice } from '../../frame/access';
import { fieldMessage, noticeOf } from '../../frame/form';
import { Badge, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { useDialogRound } from '../../frame/useDialogRound';
import { useRemoval } from '../../frame/useRemoval';
import type { SectionProps } from '../sections';

type Default = Resolution['default_for'];

const defaultOptions = () => [
  { value: 'none', label: t('settings.resolutions.dialog.no_default') },
  { value: 'completed', label: t(CATEGORY_LABELS.completed) },
  { value: 'canceled', label: t(CATEGORY_LABELS.canceled) },
];

type ResolutionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The resolution to change; null creates a new one. */
  resolution: Resolution | null;
  finalFocus: RefObject<HTMLElement | null>;
};

function ResolutionDialog({ open, onOpenChange, resolution, finalFocus }: ResolutionDialogProps) {
  const settle = useSettle();
  const save = useSaveResolution();
  const [label, setLabel] = useState(resolution?.label ?? '');
  const [standard, setStandard] = useState<Default>(resolution?.default_for ?? null);
  const [archived, setArchived] = useState(resolution?.archived_at != null);
  const [attempted, setAttempted] = useState(false);
  // a default keeps its mark until another resolution takes it (P20): the server refuses to take it away here
  const isDefault = resolution?.default_for != null;
  const labelError = attempted && label.trim() === '' ? t('settings.resolutions.dialog.label_required') : fieldMessage(save.error, 'label');

  function submit() {
    setAttempted(true);
    if (label.trim() === '') {
      document.getElementById('resolution-label')?.focus();
      return;
    }
    // the whole resolution every time (P24): what is left out would become null
    const archivedAt = archived ? (resolution?.archived_at ?? new Date().toISOString()) : null;
    settle(save.mutateAsync({ id: resolution?.id, label, default_for: standard, position: resolution?.position ?? 0, archived_at: archivedAt }), {
      onSuccess: (saved) => {
        onOpenChange(false);
        toast({ title: resolution ? t('settings.resolutions.dialog.saved', { label: saved.label }) : t('settings.resolutions.dialog.created', { label: saved.label }), tone: 'success' });
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={resolution ? t('settings.resolutions.edit', { label: resolution.label }) : t('settings.resolutions.create')}
      submitLabel={resolution ? t('settings.frame.save') : t('settings.catalog.submit_create')}
      pending={save.isPending}
      notice={noticeOf(save.error, ['label', 'default_for'])}
      finalFocus={finalFocus}
      onSubmit={submit}
    >
      <Input
        id="resolution-label"
        name="label"
        label={t('settings.resolutions.dialog.label')}
        hint={t('settings.resolutions.dialog.label_hint')}
        autoComplete="off"
        value={label}
        error={labelError}
        onChange={(event) => setLabel(event.target.value)}
      />
      <Select
        label={t('settings.resolutions.dialog.default_for')}
        hint={isDefault ? t('settings.resolutions.dialog.default_kept') : t('settings.resolutions.dialog.default_hint')}
        error={fieldMessage(save.error, 'default_for')}
        readOnly={isDefault}
        value={standard ?? 'none'}
        onValueChange={(next) => {
          const value = next === 'completed' || next === 'canceled' ? next : null;
          setStandard(value);
          if (value) setArchived(false);
        }}
        options={defaultOptions()}
      />
      {resolution && (
        <div className="flex flex-col gap-1">
          <Switch label={t('settings.resolutions.archived')} checked={archived} disabled={standard !== null} onCheckedChange={setArchived} />
          <p className="pl-12 text-sm text-pretty text-muted">{standard !== null ? t('settings.resolutions.dialog.archived_default') : t('settings.resolutions.dialog.archived_hint')}</p>
        </div>
      )}
    </FormDialog>
  );
}

export default function Resolutions({ readOnlyReason }: SectionProps) {
  const resolutions = useResolutions();
  const remove = useDeleteResolution();
  const dialog = useDialogRound<Resolution>();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const create = useRef<HTMLButtonElement>(null);
  const canEdit = readOnlyReason === null;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('settings.org.section.resolutions')}
        description={t('settings.resolutions.description')}
        actions={
          canEdit && (
            <Button ref={create} variant="primary" icon={Plus} onClick={() => dialog.show()}>
              {t('settings.resolutions.create')}
            </Button>
          )
        }
      />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <Loaded queries={[resolutions]} failure={t('settings.resolutions.load_failed')} skeleton={<RowsSkeleton rows={4} label={t('settings.resolutions.loading')} />}>
        {() => (
          // never empty: each category has its default, and a default stays (P20)
          <Panel>
            <Rows label={t('settings.org.section.resolutions')}>
              {[...(resolutions.data?.items ?? [])]
                .sort((a, b) => a.position - b.position)
                .filter((resolution) => !hidden.has(resolution.id))
                .map((resolution) => {
                  const category = resolution.default_for ? t(CATEGORY_LABELS[resolution.default_for]) : null;
                  return (
                    <Row key={resolution.id}>
                      <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2">
                        <h3 className="text-ui font-medium break-words text-ink">{resolution.label}</h3>
                        {category && <Badge tone="accent">{t('settings.resolutions.default_for', { category })}</Badge>}
                        {resolution.archived_at && <Badge tone="quiet">{t('settings.resolutions.archived')}</Badge>}
                      </div>
                      {canEdit && (
                        <div className="flex items-center">
                          <IconButton icon={Pencil} label={t('settings.resolutions.edit', { label: resolution.label })} onClick={() => dialog.show(resolution)} />
                          <IconButton
                            icon={Trash2}
                            label={t('settings.resolutions.delete', { label: resolution.label })}
                            disabledReason={category ? t('settings.resolutions.default_reason', { label: resolution.label, category }) : null}
                            onClick={() =>
                              removeWithUndo({
                                id: resolution.id,
                                label: t('settings.resolutions.deleted', { label: resolution.label }),
                                failureTitle: t('settings.resolutions.not_deleted', { label: resolution.label }),
                                run: () => remove.mutateAsync(resolution.id),
                              })
                            }
                          />
                        </div>
                      )}
                    </Row>
                  );
                })}
            </Rows>
          </Panel>
        )}
      </Loaded>
      <ResolutionDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} resolution={dialog.target} finalFocus={dialog.returnFocus(create)} />
    </div>
  );
}
