/*
 * The dialog "New project" (spec 4.4): name, identifier and visibility; workflow and types join with Phase 3. The
 * identifier follows the name as a suggestion (`suggestIdentifier`, which knows the identifiers that are taken) until the
 * person writes their own. Errors of the server (422) stand at their field and the focus goes to the first one: the
 * server alone knows identifiers of private projects the person does not see.
 */

import { Globe, Lock } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import type { CreateProjectInput } from '@/api/projects';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { labelClass } from '@/components/ui/styles';
import { useCreateProject, useProjects } from '@/hooks/projects';
import { notifyError } from '@/lib/errors';
import { t, type TranslationKey } from '@/lib/i18n';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Project } from '@/types';
import { suggestIdentifier } from './identifier';

type Visibility = Project['visibility'];
type FieldErrors = Record<string, string[]>;

const VISIBILITIES: { value: Visibility; label: TranslationKey; icon: typeof Globe; hint: TranslationKey }[] = [
  { value: 'public', label: 'projects.public', icon: Globe, hint: 'projects.create.public_hint' },
  { value: 'private', label: 'projects.private', icon: Lock, hint: 'projects.create.private_hint' },
];

type Values = Required<Pick<CreateProjectInput, 'name' | 'identifier' | 'visibility'>>;

type FormProps = {
  formId: string;
  /** Identifiers that exist, archived projects included. */
  taken: string[];
  errors: FieldErrors;
  /** Counts the sends that failed with field errors: each one brings the focus to the first error, nothing else does. */
  focusRequest: number;
  onEdit: (fields: string[]) => void;
  onSubmit: (values: Values) => void;
};

function ProjectForm({ formId, taken, errors, focusRequest, onEdit, onSubmit }: FormProps) {
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState('');
  // null: the identifier follows the suggestion; the first letter the person types is theirs
  const [typed, setTyped] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('public');

  const identifier = typed ?? suggestIdentifier(name, taken);
  const known = new Set(['name', 'identifier']);
  const other = Object.entries(errors).filter(([field]) => !known.has(field));

  useShortcut('dialog.submit', () => form.current?.requestSubmit());
  // The first field with an error takes the focus right after a send that failed, and only then. Not whenever the errors
  // change: an error that goes while the person types (the first letter of a name) must not move the focus (WCAG 3.2.2).
  const handled = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === handled.current) return;
    handled.current = focusRequest;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const visible = VISIBILITIES.find((entry) => entry.value === visibility)!;
  const key = identifier || 'KEY';
  const hint = t('projects.create.identifier_hint', { key });

  return (
    <form
      ref={form}
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name: name.trim(), identifier: identifier.trim(), visibility });
      }}
      className="flex flex-col gap-4"
    >
      <Input
        label={t('projects.create.name')}
        name="name"
        value={name}
        autoFocus
        autoComplete="off"
        placeholder={t('projects.create.name_placeholder')}
        error={errors.name?.[0]}
        onChange={(event) => {
          setName(event.target.value);
          // a suggestion that changes with the name leaves its error behind as well
          onEdit(typed === null ? ['name', 'identifier'] : ['name']);
        }}
      />
      <Input
        label={t('projects.create.identifier')}
        name="identifier"
        value={identifier}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        translate="no"
        className="max-w-44 font-semibold tracking-wide tabular-nums"
        hint={typed === null ? `${t('projects.create.identifier_suggested')} ${hint}` : hint}
        error={errors.identifier?.[0]}
        // free text: only the case is put right, the server says what else is wrong
        onChange={(event) => {
          setTyped(event.target.value.toUpperCase());
          onEdit(['identifier']);
        }}
      />

      <div className="flex flex-col gap-1.5">
        <p className={labelClass}>{t('projects.create.visibility')}</p>
        <SegmentedControl
          label={t('projects.create.visibility')}
          value={visibility}
          onValueChange={(next) => {
            setVisibility(next);
            onEdit(['visibility']);
          }}
          options={VISIBILITIES.map(({ value, label, icon }) => ({ value, label: t(label), icon }))}
        />
        <p className="text-sm text-muted">{t(visible.hint)}</p>
      </div>

      {other.length > 0 && (
        <Banner tone="danger" role="alert" title={t('projects.create.invalid')}>
          {other.map(([field, messages]) => (
            <p key={field}>{messages.join(' ')}</p>
          ))}
        </Banner>
      )}
    </form>
  );
}

type CreateProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
};

export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const formId = useId();
  const create = useCreateProject();
  const projects = useProjects({ include_archived: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [focusRequest, setFocusRequest] = useState(0);

  // a dialog opened again starts without the errors of the last time
  useEffect(() => {
    if (open) setErrors({});
  }, [open]);

  /** The error of a field goes when the field is changed. */
  const clearErrors = (fields: string[]) =>
    setErrors((state) => (fields.some((field) => field in state) ? Object.fromEntries(Object.entries(state).filter(([field]) => !fields.includes(field))) : state));

  // One send at a time: mod+enter again before the first is answered would make a second project (which the server
  // refuses as taken), and the callbacks of `mutate` are only called for the last of several calls, so the first send
  // would never be heard.
  const sending = useRef(false);

  async function submit(values: Values) {
    if (sending.current) return;
    sending.current = true;
    setErrors({});
    let project: Project;
    try {
      project = await create.mutateAsync(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.errors) {
        setErrors(error.errors);
        // the first error takes the focus now, as the form could not be sent
        setFocusRequest((count) => count + 1);
      } else notifyError(t('projects.create.failed'), error, () => void submit(values));
      return;
    } finally {
      sending.current = false;
    }
    onCreated(project);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('projects.create.title')}
      description={t('projects.create.description')}
      footer={
        <>
          <DialogClose
            render={
              <Button variant="ghost" shortcut="escape">
                {t('common.cancel')}
              </Button>
            }
          />
          <Button variant="primary" type="submit" form={formId} pending={create.isPending} shortcut="mod+enter">
            {t('projects.create.submit')}
          </Button>
        </>
      }
    >
      <ProjectForm
        formId={formId}
        taken={(projects.data?.items ?? []).map((project) => project.identifier)}
        errors={errors}
        focusRequest={focusRequest}
        onEdit={clearErrors}
        onSubmit={(values) => void submit(values)}
      />
    </Dialog>
  );
}
