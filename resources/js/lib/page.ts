import { usePage } from '@inertiajs/react';
import type { Locale } from '@/types';

export interface AuthUser {
  id: string;
  type: 'person' | 'bot';
  name: string;
  handle: string;
  email: string | null;
  locale: Locale | null;
  timezone: string | null;
  avatar_url: string | null;
}

/** What `HandleInertiaRequests::share()` puts on every page, plus the validation errors of Inertia. */
export interface SharedProps {
  auth: { user: AuthUser | null; permissions: string[] };
  organization: { name: string; locale: Locale; timezone: string; week_start: 0 | 1; logo_url: string | null };
  locale: Locale;
  translations: Record<string, string>;
  features: { mail: boolean; live: null };
  flash: { status: string | null; error: string | null };
  errors: Record<string, string>;
}

export function useSharedProps(): SharedProps {
  return usePage<SharedProps & Record<string, unknown>>().props;
}
