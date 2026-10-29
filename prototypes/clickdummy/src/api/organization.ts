/*
 * The one organisation of the instance (spec 4.1). Only org admins change it.
 */

import type { Organization } from '@/types';
import { requireOrgAdmin } from './access';
import { FieldErrors, read, write } from './client';

export function getOrganization(): Promise<Organization> {
  return read(({ db }) => db.organization);
}

export type UpdateOrganizationPatch = Partial<Pick<Organization, 'name' | 'locale' | 'timezone' | 'week_start' | 'logo_url'>>;

export function updateOrganization(patch: UpdateOrganizationPatch): Promise<Organization> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Die Organisation ändern nur Org-Admins.');
    const errors = new FieldErrors();
    if (patch.name !== undefined && patch.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    if (patch.locale !== undefined && patch.locale !== 'de' && patch.locale !== 'en') errors.add('locale', 'Diese Sprache gibt es nicht.');
    if (patch.week_start !== undefined && patch.week_start !== 0 && patch.week_start !== 1) errors.add('week_start', 'Die Woche beginnt am Montag oder Sonntag.');
    if (patch.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('de', { timeZone: patch.timezone });
      } catch {
        errors.add('timezone', 'Diese Zeitzone gibt es nicht.');
      }
    }
    errors.throwIfAny();

    const organization = db.organization;
    if (patch.name !== undefined) organization.name = patch.name.trim();
    if (patch.locale !== undefined) organization.locale = patch.locale;
    if (patch.timezone !== undefined) organization.timezone = patch.timezone;
    if (patch.week_start !== undefined) organization.week_start = patch.week_start;
    if (patch.logo_url !== undefined) organization.logo_url = patch.logo_url;
    return organization;
  });
}
