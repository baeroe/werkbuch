/*
 * How the create form sends: mod+enter, Enter in the title and "Anlegen" all ask `requestCreate`, which waits a tick
 * for fields that keep their value on Enter, then checks what only the form knows (an upload of the description still
 * on its way, pictures of another project in it, a property that still shows a text it cannot read, the title) and
 * sends once. A press while the call runs does nothing, and so does every press after the item was created: the form
 * stays mounted while the dialog animates out, with its mod+enter registered and the title it sent still in the draft.
 *
 * Field errors of the server (422) go to their fields with the focus on the first, any other refusal on top, a failure
 * without an answer into a toast with a retry. "Weitere anlegen" starts the next draft (`nextDraft`).
 */

import { useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { ApiError } from '@/api/client';
import type { CreateWorkItemInput } from '@/api/workItems';
import { canHaveParent } from '@/domain/hierarchy';
import { isEmptyDoc } from '@/editor/RichTextEditor';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Project, WorkItem, WorkItemType, Workflow } from '@/types';
import { nextDraft, type Draft } from './draft';
import { startStates, type Errors } from './ItemFields';
import type { PropertyEntry } from './PropertyInputs';

/** As the server counts it (`ItemInput::TITLE_MAX`). */
const MAX_TITLE = 255;

interface Catalogs {
  projects: Project[];
  types: WorkItemType[];
  workflows: Workflow[];
}

/** The request: a status other than the start state only when the workflow offers it, a parent only below an epic. */
export function toInput(current: Draft, title: string, own: PropertyEntry[], { projects, types, workflows }: Catalogs): CreateWorkItemInput {
  const project = projects.find((entry) => entry.id === current.projectId)!;
  const states = startStates(workflows.find((entry) => entry.id === project.workflow_id));
  const target = states.slice(1).find((state) => state.id === current.stateId);
  // a required yes/no reads "Nein" until it is switched: that is what it sends (A89)
  const switches = own.filter(({ property, required }) => required && property.field_type === 'boolean' && !(property.key in current.values));
  return {
    project_id: current.projectId,
    type_id: current.typeId,
    title,
    description: isEmptyDoc(current.description) ? null : current.description,
    ...(target && { state_id: target.id }),
    assignee_id: current.assigneeId,
    priority: current.priority,
    label_ids: current.labelIds,
    start_date: current.startDate,
    due_date: current.dueDate,
    // an epic stands at the top: the parent its field held while hidden does not count
    parent_id: canHaveParent(types.find((entry) => entry.id === current.typeId)) ? current.parentId : null,
    values: { ...Object.fromEntries(switches.map(({ property }) => [property.key, property.default_value ?? false])), ...current.values },
    ...(current.templateId !== null && { template_id: current.templateId }),
  };
}

export interface CreateSubmitOptions {
  draft: Draft;
  /** Typed values that cannot be read, by key. */
  unreadable: Record<string, string>;
  /** An upload of the description runs: it is no node in the text yet. */
  uploading: boolean;
  /** The description holds pictures or files of another project, which the server refuses (A233). */
  foreign: boolean;
  /** Puts the focus into the description. */
  focusDescription: () => void;
  catalogs: Catalogs;
  /** The properties a type asks for, in its order. */
  fieldsOf: (typeId: string) => PropertyEntry[];
  /** The id of a property's control. */
  fieldId: (key: string) => string;
  another: boolean;
  send: (input: CreateWorkItemInput) => Promise<WorkItem>;
  pending: boolean;
  titleRef: RefObject<HTMLInputElement | null>;
  /** The draft the dialog parks on close; null once the item is created. */
  unsaved: RefObject<Draft | null>;
  onClose: () => void;
  setDraft: Dispatch<SetStateAction<Draft>>;
  setErrors: Dispatch<SetStateAction<Errors>>;
  setAttempted: Dispatch<SetStateAction<boolean>>;
  setBlocked: Dispatch<SetStateAction<string | null>>;
  /** "Weitere anlegen" started the next draft: what the form said about the one before goes. */
  onNext: () => void;
  /** Puts the focus on the first field that names a problem. */
  focusFirstError: () => void;
}

/** Answers `requestCreate`, the one way the form sends. */
export function useCreateSubmit(options: CreateSubmitOptions): () => void {
  const { draft, unreadable, unsaved } = options;
  const settle = useSettle();
  /** The draft and the unreadable fields as they are now, for a create that runs once pending field changes have landed. */
  const latest = useRef({ draft, unreadable });
  /** The item was created and the dialog closes: nothing to keep, nothing more to send. */
  const done = useRef(false);
  const scheduled = useRef(false);
  /** A create is on its way; a second press waits for its answer. */
  const sending = useRef(false);
  useLayoutEffect(() => {
    latest.current = { draft, unreadable };
    unsaved.current = done.current ? null : draft;
  });

  // the options of the render that asked, read through a ref: the tick later they may have changed
  const current = useRef(options);
  useLayoutEffect(() => {
    current.current = options;
  });

  function requestCreate() {
    if (done.current || scheduled.current || sending.current || current.current.pending) return;
    scheduled.current = true;
    setTimeout(() => {
      scheduled.current = false;
      createNow();
    }, 0);
  }

  function createNow() {
    // a press scheduled before the item was created
    if (done.current) return;
    const { uploading, foreign, focusDescription, catalogs, fieldsOf, fieldId, another, send, titleRef, onClose, setDraft, setErrors, setAttempted, setBlocked, onNext, focusFirstError } =
      current.current;
    // an upload on its way: the notice says so until it is stored
    if (uploading) {
      setBlocked(t('editor.upload.pending'));
      return;
    }
    // pictures of another project: the same notice as at the button, and the focus goes to the description (F30)
    if (foreign) {
      setBlocked(t('items.create.images_other_project'));
      focusDescription();
      return;
    }
    const { draft: sent, unreadable: stuckValues } = latest.current;
    const own = fieldsOf(sent.typeId);
    setAttempted(true);
    // a value the form cannot read is no value: nothing is sent, the fix is at the field
    const stuck = own.find(({ property }) => stuckValues[property.key]);
    if (stuck) {
      setBlocked(t('items.create.blocked'));
      document.getElementById(fieldId(stuck.property.key))?.focus();
      return;
    }
    const title = sent.title.trim();
    // characters as the server counts them (`mb_strlen`), not UTF-16 units: an emoji is one
    const length = [...title].length;
    if (title === '' || length > MAX_TITLE) {
      setErrors({ title: title === '' ? t('items.create.title_required') : t('items.create.title_max', { max: MAX_TITLE, count: length }) });
      focusFirstError();
      return;
    }
    setBlocked(null);
    setErrors({});
    sending.current = true;
    settle(send(toInput(sent, title, own, catalogs)), {
      onSuccess: () => {
        if (!another) {
          done.current = true;
          unsaved.current = null;
          onClose();
          return;
        }
        // the next one: same project, type, status and fields; new title, description and properties
        const next = nextDraft(sent);
        latest.current = { draft: next, unreadable: {} };
        setDraft(next);
        setAttempted(false);
        onNext();
        titleRef.current?.focus();
      },
      onError: (error) => {
        if (error instanceof ApiError && error.errors) {
          setErrors(Object.fromEntries(Object.entries(error.errors).map(([path, messages]) => [path, messages[0]!])));
          focusFirstError();
        } else if (error instanceof ApiError && error.status < 500) {
          setErrors({ form: error.message });
        } else {
          notifyError(t('items.create.failed'), error, requestCreate);
        }
      },
      onSettled: () => {
        sending.current = false;
      },
    });
  }

  return requestCreate;
}
