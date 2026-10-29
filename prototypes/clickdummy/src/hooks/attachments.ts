import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { deleteAttachment, getAttachment, uploadAttachment } from '@/api/attachments';
import type { Attachment } from '@/types';
import { qk, type HookOptions } from './keys';
import { useApiMutation } from './mutation';

/** One attachment by its id, as the editors and viewers show it; its file never changes, so it stays fresh. */
export function useAttachment(id: string | null | undefined, options: HookOptions = {}) {
  return useQuery({
    queryKey: qk.attachments.detail(id ?? ''),
    queryFn: () => getAttachment(id!),
    enabled: !!id && options.enabled !== false,
    staleTime: Infinity,
  });
}

/**
 * Puts attachments that came with something else (the attachments of an item detail) into the cache, before the texts
 * that show them ask for each one.
 */
export function usePrimeAttachments(list: readonly Attachment[]): void {
  const queryClient = useQueryClient();
  useLayoutEffect(() => {
    for (const attachment of list) queryClient.setQueryData(qk.attachments.detail(attachment.id), attachment);
  }, [queryClient, list]);
}

/** Variables: `{ project_id, file, owner, kind }`; `owner: null` for something that is not saved yet. */
export function useUploadAttachment() {
  return useApiMutation(
    ({ project_id, file, owner, kind }: { project_id: string; file: File; owner: Attachment['owner']; kind: Attachment['kind'] }) =>
      uploadAttachment(project_id, file, owner, kind),
    [qk.workItems.all, qk.activity.all],
    // the text that holds the new image shows it at once, without asking for it
    { onSuccess: (attachment, _vars, queryClient) => queryClient.setQueryData(qk.attachments.detail(attachment.id), attachment) },
  );
}

/** Deletes a file; the UI calls this when the undo toast has run out. Variable: the attachment id. */
export function useDeleteAttachment() {
  return useApiMutation(deleteAttachment, [qk.workItems.all, qk.activity.all, qk.attachments.all]);
}
