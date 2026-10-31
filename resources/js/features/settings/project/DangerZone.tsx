/*
 * The danger zone of a project (spec 4.4). Archiving makes the project read-only and hides it from navigation and
 * views; it can be restored. Deleting removes everything (the server clears the data in the background) and is confirmed
 * by typing the identifier. Both run only when the five seconds of undo are over (spec 5.1), so the toast can take them
 * back.
 */

import { router } from '@inertiajs/react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { useArchiveProject, useDeleteProject } from '@/hooks/projects';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { runWithUndo } from '@/lib/undo';
import type { Project } from '@/types';
import { RuledList, RuledRow, SettingsCard } from '../frame/parts';

type DangerZoneProps = {
  project: Project;
  /**
   * Set to `true` just before the zone sends the person away from the settings (deleting the project). The leave guard of
   * the form above lets that one departure pass: the deletion was confirmed by typing the identifier, and the form is
   * gone with the project.
   */
  leaving: RefObject<boolean>;
};

export function DangerZone({ project, leaving }: DangerZoneProps) {
  const archive = useArchiveProject();
  const remove = useDeleteProject();
  const [confirming, setConfirming] = useState(false);
  // the undo time of an archiving is running: the button waits instead of letting it start twice
  const [archiving, setArchiving] = useState(false);
  const archived = project.archived_at !== null;

  function archiveWithUndo() {
    setArchiving(true);
    runWithUndo({
      label: t('settings.project.danger.archived', { identifier: project.identifier }),
      run: async () => {
        try {
          await archive.mutateAsync({ id: project.id });
        } finally {
          setArchiving(false);
        }
      },
      undo: () => setArchiving(false),
    });
  }

  async function restore() {
    try {
      await archive.mutateAsync({ id: project.id, archived: false });
      toast({ title: t('settings.project.danger.restored', { identifier: project.identifier }), tone: 'success' });
    } catch (error) {
      notifyError(t('settings.project.danger.not_restored'), error, () => void restore());
    }
  }

  function deleteWithUndo() {
    const here = window.location.pathname;
    setConfirming(false);
    // The project is on its way out: leave its settings now, and come back when the deletion is taken back. The guard of
    // the form would ask about unsaved edits of a project that is going, and its question would stand in the way while
    // the five seconds of undo run: the deletion is confirmed already, so the guard lets this departure pass.
    leaving.current = true;
    router.visit(paths.projects());
    runWithUndo({
      label: t('settings.project.danger.deleted', { identifier: project.identifier }),
      run: () => remove.mutateAsync(project.id),
      undo: () => router.visit(here),
    });
  }

  return (
    <>
      <SettingsCard
        flush
        tone="danger"
        title={t('settings.project.danger.title')}
        description={archived ? t('settings.project.danger.description_archived') : t('settings.project.danger.description')}
      >
        <RuledList>
          <RuledRow className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="text-md font-semibold text-ink">{archived ? t('settings.project.danger.restore_title') : t('settings.project.danger.archive_title')}</h3>
              <p className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">
                {archived ? t('settings.project.danger.restore_text') : t('settings.project.danger.archive_text')}
              </p>
            </div>
            {archived ? (
              <Button variant="secondary" icon={ArchiveRestore} pending={archive.isPending} onClick={() => void restore()}>
                {t('settings.project.danger.restore')}
              </Button>
            ) : (
              <Button variant="secondary" icon={Archive} pending={archiving} onClick={archiveWithUndo}>
                {t('settings.project.danger.archive')}
              </Button>
            )}
          </RuledRow>
          <RuledRow className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="text-md font-semibold text-ink">{t('settings.project.danger.delete_title')}</h3>
              <p className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">{t('settings.project.danger.delete_text')}</p>
            </div>
            <Button variant="danger" icon={Trash2} onClick={() => setConfirming(true)}>
              {t('settings.project.danger.delete_open')}
            </Button>
          </RuledRow>
        </RuledList>
      </SettingsCard>
      <DeleteDialog project={project} open={confirming} onOpenChange={setConfirming} onConfirm={deleteWithUndo} />
    </>
  );
}

type DeleteDialogProps = {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** The big question: deleting needs the identifier, typed exactly (spec 4.4). */
function DeleteDialog({ project, open, onOpenChange, onConfirm }: DeleteDialogProps) {
  const formId = useId();
  const [typed, setTyped] = useState('');
  // Enter with another spelling: the field says what it wants
  const [wrong, setWrong] = useState(false);
  // exactly the identifier; blanks around it (autofill, text expansion) do not count
  const matches = typed.trim() === project.identifier;

  // every question starts empty
  useEffect(() => {
    if (open) return;
    setTyped('');
    setWrong(false);
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (matches) onConfirm();
    else setWrong(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('settings.project.danger.confirm_title', { identifier: project.identifier })}
      description={t('settings.project.danger.confirm_description', { name: project.name })}
      footer={
        <>
          <DialogClose render={<Button variant="ghost">{t('common.cancel')}</Button>} />
          <Button variant="danger" type="submit" form={formId} disabledReason={matches ? null : t('settings.project.danger.confirm_reason')}>
            {t('settings.project.danger.delete')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit}>
        <Input
          label={t('settings.project.danger.confirm_label')}
          name="confirm_identifier"
          hint={
            <>
              {t('settings.project.danger.confirm_hint')}{' '}
              <strong translate="no" className="font-semibold text-ink tabular-nums">
                {project.identifier}
              </strong>
            </>
          }
          value={typed}
          error={wrong ? t('settings.project.danger.confirm_wrong', { identifier: project.identifier }) : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => {
            setTyped(event.target.value);
            setWrong(false);
          }}
        />
      </form>
    </Dialog>
  );
}
