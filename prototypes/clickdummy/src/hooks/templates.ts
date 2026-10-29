import { useQuery } from '@tanstack/react-query';
import { deleteTemplate, listTemplateRuns, listTemplates, runTemplateNow, saveTemplate } from '@/api/templates';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** The templates of one project, or of all projects the account sees. */
export function useTemplates(projectId?: string | null) {
  return useQuery({
    queryKey: qk.templates.list({ project: projectId }),
    queryFn: () => listTemplates(projectId ?? undefined),
  });
}

/** Creates a template (no `id`) or changes one; the next run is worked out from the schedule. */
export function useSaveTemplate() {
  return useApiMutation(saveTemplate, [qk.templates.all]);
}

export function useDeleteTemplate() {
  return useApiMutation(deleteTemplate, [qk.templates.all, qk.templateRuns.all]);
}

/** Answers `{ run, item }`; `item` is null when the run failed (the log has the reason). */
export function useRunTemplateNow() {
  return useApiMutation(runTemplateNow, [qk.templates.all, qk.templateRuns.all, qk.workItems.all, qk.notifications.all]);
}

export function useTemplateRuns(templateId: string | null | undefined) {
  return useQuery({ queryKey: qk.templateRuns.list({ template: templateId }), queryFn: () => listTemplateRuns(templateId!), enabled: !!templateId });
}
