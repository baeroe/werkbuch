/*
 * The rights of the one GitHub app in words (spec 10.2). What the manifest asks for is `App\GitHub\Manifest::PERMISSIONS`
 * (a test reads it): before there is an app, the screen says what connecting will grant; after, it reads the rights the
 * app has.
 */

import { t, type TranslationKey } from '@/lib/i18n';

/** `App\GitHub\Manifest::PERMISSIONS`, in its order. */
export const MANIFEST_PERMISSIONS: Readonly<Record<string, string>> = {
  contents: 'write',
  pull_requests: 'write',
  checks: 'read',
  actions: 'read',
  statuses: 'read',
  metadata: 'read',
};

const NAMES: Record<string, TranslationKey> = {
  contents: 'settings.github.permission.contents',
  pull_requests: 'settings.github.permission.pull_requests',
  checks: 'settings.github.permission.checks',
  actions: 'settings.github.permission.actions',
  statuses: 'settings.github.permission.statuses',
  metadata: 'settings.github.permission.metadata',
};

const ACCESS: Record<string, TranslationKey> = {
  read: 'settings.github.access.read',
  write: 'settings.github.access.write',
};

/** One right in words, "Inhalte schreiben"; a right or a level werkbuch does not know stays as GitHub names it. */
export function permissionText(name: string, access: string): string {
  return t('settings.github.permission_line', {
    permission: NAMES[name] ? t(NAMES[name]) : name,
    access: ACCESS[access] ? t(ACCESS[access]) : access,
  });
}

/** All rights of a set in words, in its order. */
export const permissionTexts = (permissions: Readonly<Record<string, string>>): string[] => Object.entries(permissions).map(([name, access]) => permissionText(name, access));
