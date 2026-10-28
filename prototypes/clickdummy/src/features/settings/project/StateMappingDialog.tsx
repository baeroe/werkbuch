/*
 * The question that comes with a change of workflow (spec 4.5): every status the project's items are in needs a status
 * of the new workflow. The dialog proposes one per status, says what the change does to the items, and rewrites them
 * when confirmed. The items are moved without the transition rules; the history names the person who did it.
 *
 * Task 11 builds a similar dialog for deleting a status in the workflow editor; Task 13 can merge the two.
 */

import { ArrowRight } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { toast } from '@/components/ui/toast';
import { statesInOrder } from '@/domain/workflow';
import { useAssignWorkflow } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Automation, Project, State, Workflow } from '@/types';
import { cancelTargets } from './automationRules';
import { fieldErrors } from './form';
import { mappingEffects, suggestMapping } from './mapping';

/** What the question is about, fixed when it opens, so it does not change under the person while the call runs. */
export interface MappingPlan {
  from: Workflow;
  to: Workflow;
  /** Items per state of the old workflow. */
  counts: ReadonlyMap<string, number>;
  /** The Auto-Close automation of the project, if it is switched on: it follows to the new workflow. */
  autoClose: Automation | undefined;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  plan: MappingPlan;
};

const number = new Intl.NumberFormat('de');
/** "17 Items", the number and the word kept together. */
const items = (count: number) => `${number.format(count)} ${count === 1 ? 'Item' : 'Items'}`;

function StateLabel({ state }: { state: State }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />
      <span className="min-w-0 truncate">{state.name}</span>
    </span>
  );
}

export function StateMappingDialog({ open, onOpenChange, project, plan }: Props) {
  const { from, to, counts, autoClose } = plan;
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const assign = useAssignWorkflow();
  const proposal = useMemo(() => suggestMapping(from, to), [from, to]);
  // only what the person changed; the rest follows the proposal
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const mapping = { ...proposal, ...chosen };

  // every question starts at the proposal
  useEffect(() => {
    if (!open) {
      setChosen({});
      setProblems({});
    }
  }, [open]);

  const used = statesInOrder(from).filter((state) => (counts.get(state.id) ?? 0) > 0);
  const targets = statesInOrder(to);
  const effects = mappingEffects(from, to, mapping, counts);
  const nextCancel = cancelTargets(to)[0];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (assign.isPending) return;
    try {
      await assign.mutateAsync({ project_id: project.id, workflow_id: to.id, mapping });
      onOpenChange(false);
      toast({
        title: 'Workflow gewechselt',
        description: `${project.identifier} nutzt jetzt „${to.name}“.${effects.items > 0 ? ` ${items(effects.items)} ${effects.items === 1 ? 'wurde' : 'wurden'} umgeschrieben.` : ''}`,
        tone: 'success',
      });
    } catch (error) {
      // the server names the states it still misses as `mapping.<state id>`
      const rows = Object.fromEntries(
        Object.entries(fieldErrors(error))
          .filter(([path]) => path.startsWith('mapping.'))
          .map(([path, message]) => [path.slice('mapping.'.length), message]),
      );
      if (Object.keys(rows).length > 0) setProblems(rows);
      else notifyError('Workflow nicht gewechselt', error, () => void submit(event));
    }
  }

  // ⌘↵ anywhere in the dialog confirms
  useShortcut({ id: 'workflow.switch', keys: 'mod+enter', scope: 'dialog', label: 'Workflow wechseln', group: 'Dialog', run: () => form.current?.requestSubmit(), when: () => open }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Zu „${to.name}“ wechseln`}
      description={`${project.identifier} nutzt bisher „${from.name}“. Ordne jedem Status mit Items einen Status des neuen Workflows zu. Die Items werden ohne Übergangsregeln umgeschrieben, die History nennt dich als Auslöser.`}
      footer={
        <>
          <DialogClose render={<Button variant="ghost" disabled={assign.isPending}>Abbrechen</Button>} />
          <Button variant="primary" type="submit" form={formId} pending={assign.isPending} shortcut="mod+enter">
            Workflow wechseln
          </Button>
        </>
      }
    >
      <form ref={form} id={formId} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {used.length === 0 ? (
          <p className="text-ui text-pretty text-muted">Das Projekt hat noch keine Items, es gibt nichts zuzuordnen. Neue Items starten im Startstatus „{to.states.find((state) => state.id === to.initial_state_id)?.name}“.</p>
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {used.map((state) => (
              <li key={state.id} className="grid items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-3">
                <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-md font-medium text-ink">
                  <StateLabel state={state} />
                  <span className="text-sm font-normal text-muted tabular-nums">{items(counts.get(state.id) ?? 0)}</span>
                </div>
                <ArrowRight className="mt-2.5 hidden size-4 text-muted md:block" aria-hidden="true" />
                <Select
                  aria-label={`Neuer Status für ${state.name}`}
                  value={mapping[state.id] ?? null}
                  error={problems[state.id]}
                  placeholder="Status wählen …"
                  options={targets.map((target) => ({ value: target.id, label: target.name, icon: <StatusIcon icon={target.icon} category={target.category} label={target.name} aria-hidden="true" /> }))}
                  onValueChange={(next) => {
                    if (!next) return;
                    setChosen((current) => ({ ...current, [state.id]: next }));
                    setProblems(({ [state.id]: _fixed, ...rest }) => rest);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {effects.reopened > 0 && (
          <Banner role="status" title={`${number.format(effects.reopened)} geschlossene${effects.reopened === 1 ? 's Item wird' : ' Items werden'} wieder geöffnet.`}>
            Sie verlieren ihre Resolution.
          </Banner>
        )}
        {effects.closed > 0 && (
          <Banner role="status" title={`${number.format(effects.closed)} offene${effects.closed === 1 ? 's Item gilt' : ' Items gelten'} danach als geschlossen.`}>
            Sie bekommen die Standard-Resolution ihrer Kategorie.
          </Banner>
        )}
        {autoClose?.enabled && (
          <Banner role="status" tone={nextCancel ? 'neutral' : 'danger'} title="Auto-Close">
            {nextCancel ? `Auto-Close setzt Items danach auf „${nextCancel.name}“.` : `„${to.name}“ hat keinen Status der Kategorie Canceled. Auto-Close lässt sich dort nicht nutzen.`}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
