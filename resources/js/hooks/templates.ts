/*
 * Templates and their runs (`@/api/templates`). Reading follows `next_cursor` to the end. Saving, deleting and running
 * by hand wait for the server, then make the templates, their runs, the items, the history and the search stale (a run
 * creates an item, and this tab does not hear its own changes live, A282; 13c: the search must not stay stale after a
 * run). The preview of a schedule lies under its own key, so none of that reloads it while a schedule is edited.
 */

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { allPages } from '@/api/client';
import {
  deleteTemplate,
  listTemplateRuns,
  listTemplates,
  previewSchedule,
  runTemplateNow,
  saveTemplate,
  type SchedulePreviewInput,
} from '@/api/templates';
import { qk } from './keys';
import { useApiMutation } from './mutation';

const TEMPLATE_KEYS = [qk.templates.all, qk.templateRuns.all, qk.workItems.all, qk.activity.all, qk.search.all] as const;

/** How long a schedule rests before its preview is asked for (ms). */
export const PREVIEW_PAUSE_MS = 250;

/** The templates of a project (ULID or identifier), or of every project the account sees without one. */
export function useTemplates(projectId?: string) {
  return useQuery({ queryKey: qk.templates.list({ project: projectId }), queryFn: () => allPages((cursor) => listTemplates(projectId, { cursor })) });
}

/** The log of the runs of a template, newest first; nothing without a template. */
export function useTemplateRuns(templateId: string | null | undefined) {
  return useQuery({
    queryKey: qk.templateRuns.list({ template: templateId }),
    queryFn: () => allPages((cursor) => listTemplateRuns(templateId!, { cursor })),
    enabled: !!templateId,
  });
}

/**
 * The next terms of a schedule while it is edited: nothing for `null`, and what is typed is asked for after a pause of
 * `PREVIEW_PAUSE_MS` (at once when that very input was answered before). The terms of the last input stay until the
 * next arrive.
 */
export function useSchedulePreview(input: SchedulePreviewInput | null) {
  const queryClient = useQueryClient();
  const typed = input === null ? null : JSON.stringify(input);
  const [settled, setSettled] = useState(typed);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(typed), PREVIEW_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const asked = typed === null ? null : queryClient.getQueryData(qk.schedulePreview.list(JSON.parse(typed))) !== undefined ? typed : settled;
  const query = asked === null ? null : (JSON.parse(asked) as SchedulePreviewInput);
  return useQuery({
    queryKey: qk.schedulePreview.list(query),
    queryFn: () => previewSchedule(query!),
    enabled: query !== null && typed !== null,
    placeholderData: keepPreviousData,
  });
}

/** Variables: `{ id?, project_id, name, payload, schedule }`; without `id` a new template. */
export function useSaveTemplate() {
  return useApiMutation(saveTemplate, TEMPLATE_KEYS);
}

/** Variable: the id of the template. */
export function useDeleteTemplate() {
  return useApiMutation(deleteTemplate, TEMPLATE_KEYS);
}

/** Variable: the id of the template; answers `{ run, item }`, `item` is `null` when the run failed. */
export function useRunTemplateNow() {
  return useApiMutation(runTemplateNow, TEMPLATE_KEYS);
}
