/*
 * Attachments. A record changes after the upload: the queue makes its preview (`preview_url`), saving the text links
 * it (`owner`). So a loaded one is fresh only for a while (`ATTACHMENT_FRESH_MS`) and is read again when a text shows
 * it after that; never decide anything from a cached `owner`. What comes with something else (the files of an item
 * detail) and what an upload answers goes straight into the cache, so the texts that show them do not ask for each
 * one. A deleted attachment leaves the cache and the item details that list it.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { deleteAttachment, getAttachment, uploadAttachment, type UploadOptions } from '@/api/attachments';
import type { Attachment, WorkItemDetail } from '@/types';
import { qk, type HookOptions } from './keys';
import { useApiMutation } from './mutation';

/** How long a loaded attachment counts as fresh: long enough for a page full of pictures, short enough for the preview. */
export const ATTACHMENT_FRESH_MS = 30_000;

/** One attachment by its id, as the editors and viewers show it. */
export function useAttachment(id: string | null | undefined, options: HookOptions = {}) {
  return useQuery({
    queryKey: qk.attachments.detail(id ?? ''),
    queryFn: () => getAttachment(id!),
    enabled: !!id && options.enabled !== false,
    staleTime: ATTACHMENT_FRESH_MS,
  });
}

/** Puts attachments that came with something else into the cache, before the texts that show them ask for each one. */
export function usePrimeAttachments(list: readonly Attachment[]): void {
  const queryClient = useQueryClient();
  useLayoutEffect(() => {
    for (const attachment of list) queryClient.setQueryData(qk.attachments.detail(attachment.id), attachment);
  }, [queryClient, list]);
}

export interface UploadVars extends UploadOptions {
  project_id: string;
  file: File;
  owner: { type: 'work_item'; id: string } | null;
  kind: Attachment['kind'];
}

/**
 * Variables: `{ project_id, file, owner, kind, onProgress?, signal? }`. The answer goes into the cache, so the text
 * that holds the new picture shows it at once; a file of the file list makes the item and its history stale, a
 * picture for a text changes nothing yet (saving the text links it, A232).
 */
export function useUploadAttachment() {
  return useApiMutation(
    ({ project_id, file, owner, kind, onProgress, signal }: UploadVars) => uploadAttachment(project_id, file, owner, kind, { onProgress, signal }),
    (attachment) => (attachment.kind === 'file' ? [qk.workItems.all, qk.activity.all] : []),
    { onSuccess: (attachment, _vars, queryClient) => queryClient.setQueryData(qk.attachments.detail(attachment.id), attachment) },
  );
}

/**
 * Deletes a file of the file list or an own upload nobody owns; the UI calls this when the undo toast has run out.
 * Variable: the id. The file leaves every cached item detail at once (also one not on screen, which would show it
 * until it is read again) and the cache of attachments.
 */
export function useDeleteAttachment() {
  return useApiMutation(deleteAttachment, [qk.workItems.all, qk.activity.all], {
    onSuccess: (_answer, id, queryClient) => {
      queryClient.setQueriesData<WorkItemDetail>({ queryKey: [...qk.workItems.all, 'detail'] }, (detail) =>
        detail && { ...detail, attachments: detail.attachments.filter((attachment) => attachment.id !== id) },
      );
      queryClient.removeQueries({ queryKey: qk.attachments.detail(id) });
    },
  });
}
