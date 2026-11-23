/*
 * Organisation → Agenten (WEBU-18, spec 7.3, 10.8): the working rules per kind of run, for every project. The order in
 * the prompt stands on top; per kind the contract werkbuch always gives is folded above the text. Org admins change
 * the rules, members read them.
 */

import { useMemo, useRef, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from '@/components/ui/toast';
import { RulesEditor } from '@/features/agents/RulesEditor';
import { SaveBar } from '@/features/agents/SaveBar';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from '@/features/settings/project/form';
import { SettingsCard, UnsavedGuard } from '@/features/settings/project/SettingsParts';
import type { AgentRulesView } from '@/api/agents';
import { useAgentRules, useSaveAgentRules } from '@/hooks/agents';
import { notifyError } from '@/lib/errors';
import type { AgentRules as Rules } from '@/types';
import { ReadOnlyNotice } from './access';
import { FormSkeleton, Loaded, SectionHeader } from './parts';
import type { SectionProps } from './sections';

const LINK = 'font-medium text-accent-text underline-offset-2 hover:underline';

/** The layers of a prompt, in their order (spec 7.3). */
function PromptOrder() {
  return (
    <SettingsCard title="So entsteht der Prompt" description="Jeder Auftrag bekommt diese Schichten in dieser Reihenfolge. Was weiter oben steht, gilt; was weiter unten steht, ergänzt.">
      <ol className="flex max-w-[70ch] list-decimal flex-col gap-1 pl-5 text-ui text-pretty text-ink marker:text-muted">
        <li>
          <span className="font-medium">Vertrag</span> <span className="text-muted">je Auftragstyp, fest von werkbuch: was der Auftrag ist, was nie erlaubt ist, das Ausgabeformat.</span>
        </li>
        <li>
          <span className="font-medium">Arbeitsregeln je Auftragstyp</span> <span className="text-muted">hier, für die ganze Organisation.</span>
        </li>
        <li>
          <span className="font-medium">Vorgehen des Item-Typs</span>{' '}
          <span className="text-muted">
            unter{' '}
            <Link to="/settings/types" className={LINK}>
              Typen
            </Link>
            , etwa „Beginne mit einem fehlschlagenden Test“ beim Bug.
          </span>
        </li>
        <li>
          <span className="font-medium">Projektinformationen und Regeln</span> <span className="text-muted">in den Projekteinstellungen unter Agenten.</span>
        </li>
        <li>
          <span className="font-medium">CLAUDE.md bzw. AGENTS.md im Repo</span> <span className="text-muted">liest der Agent selbst: die Regeln des Codes.</span>
        </li>
      </ol>
    </SettingsCard>
  );
}

function RulesForm({ view, readOnly }: { view: AgentRulesView; readOnly: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const save = useSaveAgentRules();
  const draft = useDraft(useMemo(() => ({ rules: view.rules }), [view.rules]));
  const problems = useFieldErrors(form);
  useSaveShortcut(form, !readOnly);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || save.isPending) return;
    if (!draft.dirty) return draft.tellNothingToSave();
    try {
      await save.mutateAsync(draft.value.rules);
      draft.reset();
      problems.clearAll();
      toast({ title: 'Arbeitsregeln gespeichert', description: 'Sie gelten für den nächsten Auftrag in jedem Projekt.', tone: 'success' });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError('Arbeitsregeln nicht gespeichert', error, () => form.current?.requestSubmit());
    }
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {!readOnly && <UnsavedGuard dirty={draft.dirty} saving={save.isPending} />}
      <SettingsCard title="Arbeitsregeln je Auftragstyp" description="Wie Agenten arbeiten, je Auftragstyp, in jedem Projekt. Vorbelegt mit dem Standard von werkbuch.">
        <RulesEditor
          value={draft.value.rules}
          defaults={view.defaults}
          contracts={view.contracts}
          readOnly={readOnly}
          errors={problems.errors}
          onChange={(change) => draft.update((current) => ({ rules: change(current.rules as Rules) }))}
        />
      </SettingsCard>
      {!readOnly && (
        <SaveBar
          dirty={draft.dirty}
          pending={save.isPending}
          quiet={draft.quiet}
          onReset={() => {
            draft.reset();
            problems.clearAll();
          }}
        />
      )}
    </form>
  );
}

export default function AgentRules({ readOnlyReason }: SectionProps) {
  const rules = useAgentRules();
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Agenten" description="Die Arbeitsregeln der Agenten für die ganze Organisation. Runner, Modelle und die Agenten selbst stehen unter Runner und Bots." />
      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}
      <PromptOrder />
      <Loaded queries={[rules]} failure="Die Arbeitsregeln konnten nicht geladen werden" skeleton={<FormSkeleton label="Die Arbeitsregeln werden geladen …" />}>
        {() => <RulesForm view={rules.data!} readOnly={readOnlyReason !== null} />}
      </Loaded>
    </div>
  );
}
