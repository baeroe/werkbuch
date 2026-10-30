import { usePage } from '@inertiajs/react';
import type { Locale, Organization, User } from '@/types';

/** What `HandleInertiaRequests::share()` puts on every page, plus the validation errors of Inertia. */
export interface SharedProps {
  /** The signed-in account as the API shows it (`UserResource`) and the rights it holds in the organization (`lib/permissions.ts`). */
  auth: { user: User | null; permissions: string[] };
  organization: Organization;
  locale: Locale;
  translations: Record<string, string>;
  features: { mail: boolean; live: null };
  flash: { status: string | null; error: string | null };
  errors: Record<string, string>;
}

export function useSharedProps(): SharedProps {
  return usePage<SharedProps & Record<string, unknown>>().props;
}
