/*
 * Whole-page states in the look of the empty state: the 404 page (unknown paths, unknown item keys) and the error pages
 * of the server (403, 500, 503).
 */

import { Link } from '@inertiajs/react';
import type { LucideIcon } from 'lucide-react';
import { FileQuestionMark, RotateCw, ServerCrash, ShieldAlert, WifiOff } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { t, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

type NotFoundProps = {
  /** e.g. "WEB-999 does not exist". */
  title?: string;
  description?: string;
};

/** 404: names what is missing and offers the way back. */
export function NotFound({ title = t('errors.page.not_found.title'), description = t('errors.page.not_found.description') }: NotFoundProps) {
  useDocumentTitle(t('errors.page.not_found.tab'));
  return (
    <EmptyState
      icon={FileQuestionMark}
      titleAs="h1"
      title={title}
      description={description}
      actions={
        <Link href={paths.myItems()} className={buttonClass({ variant: 'primary' })}>
          {t('errors.page.not_found.open_my_items')}
        </Link>
      }
    />
  );
}

type ErrorStatus = 403 | 500 | 503;

const ERRORS: Record<ErrorStatus, { icon: LucideIcon; title: TranslationKey; description: TranslationKey }> = {
  403: { icon: ShieldAlert, title: 'errors.page.forbidden.title', description: 'errors.page.forbidden.description' },
  500: { icon: ServerCrash, title: 'errors.page.server_error.title', description: 'errors.page.server_error.description' },
  503: { icon: WifiOff, title: 'errors.page.unavailable.title', description: 'errors.page.unavailable.description' },
};

/** The server refused (403), failed (500) or is not available (503). */
export function ErrorPage({ status }: { status: ErrorStatus }) {
  const { icon, title, description } = ERRORS[status];
  useDocumentTitle(t(title));
  return (
    <EmptyState
      icon={icon}
      titleAs="h1"
      title={t(title)}
      description={t(description)}
      actions={
        <Button variant="secondary" icon={RotateCw} onClick={() => window.location.reload()}>
          {t('common.reload')}
        </Button>
      }
    />
  );
}
