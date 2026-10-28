/*
 * The danger zone of a project (spec 4.4). Archiving makes the project read-only and hides it from navigation and
 * views; it can be restored. Deleting removes everything and is confirmed by typing the identifier. Both run only when
 * the five seconds of undo are over (spec 5.1), so the toast can take them back.
 */

import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { useArchiveProject, useDeleteProject } from '@/hooks/projects';
import { notifyError } from '@/lib/errors';
import { runWithUndo } from '@/lib/undo';
import type { Project } from '@/types';
import type { SectionProps } from './sectionProps';
import { RuledList, RuledRow, SettingsCard } from './SettingsParts';
import { useProjectItems } from './useProjectItems';

const itemsText = new Intl.NumberFormat('de');

type DangerZoneProps = SectionProps & {
  /**
   * Set to `true` just before the zone sends the person away from the settings (deleting the project). The unsaved-changes
   * guard of the form above lets that one departure pass: the deletion was confirmed by typing the identifier, and the
   * form is gone with the project.
   */
  leaving?: RefObject<boolean>;
};

export function DangerZone({ project, leaving }: DangerZoneProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const archive = useArchiveProject();
  const remove = useDeleteProject();
  const items = useProjectItems(project.id);
  const [confirming, setConfirming] = useState(false);
  // the undo time of an archiving is running: the button waits instead of letting it start twice
  const [archiving, setArchiving] = useState(false);
  const archived = project.archived_at !== null;

  function archiveWithUndo() {
    setArchiving(true);
    runWithUndo({
      label: `Projekt ${project.identifier} archiviert`,
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
      toast({ title: `Projekt ${project.identifier} wiederhergestellt`, tone: 'success' });
    } catch (error) {
      notifyError('Projekt nicht wiederhergestellt', error, () => void restore());
    }
  }

  function deleteWithUndo() {
    const here = location.pathname;
    setConfirming(false);
    // the project is on its way out: leave its settings now, and come back when the deletion is taken back. The guard of
    // the form would ask about unsaved edits of a project that is going, and its question would stand in the way while
    // the five seconds of undo run: the deletion is confirmed already, so the guard lets this departure pass.
    if (leaving) leaving.current = true;
    navigate('/projects');
    runWithUndo({
      label: `Projekt ${project.identifier} gelöscht`,
      run: () => remove.mutateAsync(project.id),
      undo: () => navigate(here),
    });
  }

  return (
    <>
      <SettingsCard
        flush
        tone="danger"
        title="Gefahrenzone"
        description={archived ? 'Dieses Projekt ist archiviert. Hier holst du es zurück oder löschst es endgültig.' : 'Archivieren lässt sich zurücknehmen, Löschen nicht.'}
      >
        <RuledList>
          <RuledRow className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="text-md font-semibold text-ink">{archived ? 'Projekt wiederherstellen' : 'Projekt archivieren'}</h3>
              <p className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">
                {archived
                  ? 'Das Projekt erscheint wieder in der Seitenleiste und in Views und lässt sich wieder bearbeiten.'
                  : 'Das Projekt wird schreibgeschützt und verschwindet aus Navigation und Views. Du kannst es jederzeit wiederherstellen.'}
              </p>
            </div>
            {archived ? (
              <Button variant="secondary" icon={ArchiveRestore} pending={archive.isPending} onClick={() => void restore()}>
                Wiederherstellen
              </Button>
            ) : (
              <Button variant="secondary" icon={Archive} pending={archiving} onClick={archiveWithUndo}>
                Archivieren
              </Button>
            )}
          </RuledRow>
          <RuledRow className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="text-md font-semibold text-ink">Projekt löschen</h3>
              <p className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">
                Löscht das Projekt mit allen Items, Kommentaren, Wiki-Seiten, Vorlagen und Anhängen. Nach den fünf Sekunden zum Rückgängigmachen ist es weg.
              </p>
            </div>
            <Button variant="danger" icon={Trash2} onClick={() => setConfirming(true)}>
              Projekt löschen …
            </Button>
          </RuledRow>
        </RuledList>
      </SettingsCard>
      <DeleteDialog project={project} itemCount={items.data?.total} open={confirming} onOpenChange={setConfirming} onConfirm={deleteWithUndo} />
    </>
  );
}

type DeleteDialogProps = {
  project: Project;
  /** How many items go with the project; unknown while they load. */
  itemCount: number | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** The big question: deleting needs the identifier, typed exactly (spec 4.4). */
function DeleteDialog({ project, itemCount, open, onOpenChange, onConfirm }: DeleteDialogProps) {
  const formId = useId();
  const [typed, setTyped] = useState('');
  // exactly the identifier; blanks around it (autofill, text expansion) do not count
  const matches = typed.trim() === project.identifier;

  // every question starts empty
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (matches) onConfirm();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`${project.identifier} löschen?`}
      description={`„${project.name}“ wird mit allem gelöscht, was darin liegt${itemCount === undefined ? '' : `, darunter ${itemsText.format(itemCount)} ${itemCount === 1 ? 'Item' : 'Items'}`}.`}
      footer={
        <>
          <DialogClose render={<Button variant="ghost">Abbrechen</Button>} />
          <Button variant="danger" type="submit" form={formId} disabledReason={matches ? null : 'Tippe die Kennung ein, um das Löschen zu bestätigen.'}>
            Projekt löschen
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit}>
        <Input
          label="Kennung eintippen"
          name="confirm_identifier"
          hint={
            <>
              Zur Bestätigung: <strong translate="no" className="font-semibold text-ink tabular-nums">{project.identifier}</strong>
            </>
          }
          value={typed}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
        />
      </form>
    </Dialog>
  );
}
