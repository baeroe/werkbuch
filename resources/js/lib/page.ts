import { usePage } from '@inertiajs/react';
import type { Locale, Organization, User } from '@/types';

/** What `HandleInertiaRequests::share()` puts on every page, plus the validation errors of Inertia. */
export interface SharedProps {
  /** The signed-in account as the API shows it (`UserResource`) and the rights it holds in the organization (`lib/permissions.ts`). */
  auth: { user: User | null; permissions: string[] };
  organization: Organization;
  locale: Locale;
  translations: Record<string, string>;
  features: {
    mail: boolean;
    /** Whether wiki pages can be downloaded as PDF at all: a Gotenberg is configured (WEBU-4). */
    pdf: boolean;
    live: { key: string; host: string; port: number; scheme: 'http' | 'https' } | null;
    attachments_max_mb: number;
    /** Minutes the mails about an item are collected (`NOTIFICATION_MAIL_DELAY`). */
    notification_mail_delay: number;
  };
  /** `error_link`: a way on from the error to a page outside werkbuch (A721: the apps of a GitHub account). */
  flash: { status: string | null; error: string | null; error_link: { label: string; url: string } | null };
  errors: Record<string, string>;
}

export function useSharedProps(): SharedProps {
  return usePage<SharedProps & Record<string, unknown>>().props;
}
