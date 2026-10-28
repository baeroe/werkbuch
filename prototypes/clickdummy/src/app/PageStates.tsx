/*
 * Whole-page states in the look of the empty state: the 404 page (unknown routes, unknown item keys), the error page
 * of a screen that crashed, and the placeholder of a screen a later task builds.
 */

import type { LucideIcon } from 'lucide-react';
import { FileQuestionMark, Search } from 'lucide-react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { Button, buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useUiStore } from '@/store/ui';

type NotFoundProps = {
  /** e.g. "WEB-999 gibt es nicht". */
  title?: string;
  description?: string;
};

/** 404: names what is missing and offers the way back. */
export function NotFound({
  title = 'Diese Seite gibt es nicht',
  description = 'Die Adresse stimmt nicht, oder du darfst nicht sehen, was dort liegt. Über die Suche findest du Items, Seiten und Projekte.',
}: NotFoundProps) {
  useDocumentTitle('Nicht gefunden');
  const openPalette = () => useUiStore.getState().setPaletteOpen(true);
  return (
    <EmptyState
      icon={FileQuestionMark}
      titleAs="h1"
      title={title}
      description={description}
      actions={
        <>
          <Link to="/my-items" className={buttonClass({ variant: 'primary' })}>
            Meine Items öffnen
          </Link>
          <Button variant="secondary" icon={Search} shortcut="mod+k" onClick={openPalette}>
            Suchen
          </Button>
        </>
      }
    />
  );
}

/** A screen threw while rendering, or its code could not be loaded. */
export function RouteError() {
  const error = useRouteError();
  useDocumentTitle('Fehler');
  const cause = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Unbekannter Fehler.';
  return (
    <ErrorState
      title="Diese Ansicht konnte nicht angezeigt werden"
      description={`${cause} „Erneut versuchen“ lädt die Seite neu; die Daten des Klickdummys bleiben dabei erhalten.`}
      onRetry={() => window.location.reload()}
    />
  );
}

type ComingSoonProps = {
  /** The page's name, also its h1 and the tab title. */
  title: string;
  /** The task of the plan that builds the screen. */
  task: number;
  icon: LucideIcon;
  /** What the screen will hold. */
  description: string;
};

/** Placeholder of a screen until its task replaces the file that renders it. */
export function ComingSoon({ title, task, icon, description }: ComingSoonProps) {
  useDocumentTitle(title);
  return (
    <>
      <div className="flex h-8 items-center">
        <h1 className="truncate font-display text-lg font-bold tracking-title text-ink">{title}</h1>
      </div>
      <EmptyState className="mt-4" icon={icon} title={`Kommt in Task ${task}`} description={description} />
    </>
  );
}
