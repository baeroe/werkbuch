import { deleteAttachment, uploadAttachment } from '@/api/attachments';
import type { Attachment } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** Variables: `{ project_id, file, owner, kind }`; `owner: null` for something that is not saved yet. */
export function useUploadAttachment() {
  return useApiMutation(
    ({ project_id, file, owner, kind }: { project_id: string; file: File; owner: Attachment['owner']; kind: Attachment['kind'] }) =>
      uploadAttachment(project_id, file, owner, kind),
    [qk.workItems.all, qk.activity.all],
  );
}

/** Deletes a file; the UI calls this when the undo toast has run out. Variable: the attachment id. */
export function useDeleteAttachment() {
  return useApiMutation(deleteAttachment, [qk.workItems.all, qk.activity.all]);
}
