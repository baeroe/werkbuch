import type { Page } from '@playwright/test';
import { allEntries, api, tr } from './helpers';

// What the specs of the timeline and of the views share: the ids of catalog entries by name and the days as the app
// writes them in English.

/** The id of a type of the catalog by its name. */
export async function typeId(page: Page, type: string): Promise<string> {
  return String((await allEntries(page, 'work-item-types')).find((entry) => entry.name === type)!.id);
}

/** The id of a state of the default workflow by its name. */
export async function stateId(page: Page, state: string): Promise<string> {
  const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.is_default === true) as { states: { id: string; name: string }[] };
  return workflow.states.find((entry) => entry.name === state)!.id;
}

/** A day as the app writes it in English (31/10/2026). */
export const shown = (day: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

/** A day some days later. */
export const plus = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The range of a bar on the timeline, as its row is named. */
export const range = (start: string, due: string) => tr('en', 'items.timeline.range', { start: shown(start), due: shown(due) });

/** Today in the time zone of the organisation. */
export async function today(page: Page): Promise<string> {
  const { data } = (await (await api(page, 'GET', '/api/v1/organization')).json()) as { data: { timezone: string } };
  return new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
