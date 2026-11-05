/*
 * The four switchable automations of a project (spec 4.13, A346). The list always holds four, one per key; a key
 * nobody saved yet has no id (`Automation.id` is `null`), so an automation is identified by its project and key. The
 * names are the clickdummy's; `saveAutomation` puts to the key and sends `enabled` and `settings` only.
 */

import type { Automation, AutomationKey, AutomationSettings } from '@/types';
import type { Page } from './client';
import { get, one, put } from './http';

export interface AutomationInput {
  project_id: string;
  key: AutomationKey;
  enabled: boolean;
  settings: AutomationSettings;
}

/** The four of a project; the answer is a plain list without paging, so it is one `Page` of exactly what came. */
export async function listAutomations(project_id: string): Promise<Page<Automation>> {
  const { data } = await get<{ data: Automation[] }>(`/projects/${encodeURIComponent(project_id)}/automations`);
  return { items: data, next_cursor: null, total: data.length };
}

export function saveAutomation({ project_id, key, ...input }: AutomationInput): Promise<Automation> {
  return one(put<{ data: Automation }>(`/projects/${encodeURIComponent(project_id)}/automations/${key}`, input));
}
