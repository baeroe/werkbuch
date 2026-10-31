/*
 * Warns before unsaved edits are lost by leaving the page (guidelines: "Warn on unsaved changes before navigation").
 * While `dirty`, a visit inside the app (a link of the settings, the sidebar) stops at "Discard changes?" and goes on
 * only when the person says so; closing or reloading the tab gets the browser's own question. A deliberate leave, such as
 * the move to the new identifier of a project that was just saved, sets `bypass` first and is let through.
 *
 * Inertia asks `before` listeners at the moment a visit starts, so the guard reads `dirty` and `bypass` from refs: a
 * state change would not have reached it in the same breath. The browser's own back button is a history step that
 * Inertia does not announce; the tab-close question is all that guards it.
 */

import { router } from '@inertiajs/react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { t } from '@/lib/i18n';

/** The visit Inertia announces in its `before` event. */
type PendingVisit = Parameters<Parameters<typeof router.on<'before'>>[1]>[0]['detail']['visit'];

type LeaveGuardProps = {
  dirty: boolean;
  /** What is lost, for the question: "Changes to “Agency approval”". */
  what: string;
  /** Set to true right before a navigation that is meant, so it is not stopped. */
  bypass?: RefObject<boolean>;
};

/** A visit to the address the page already has (a reload, a partial reload) leaves nothing behind. */
const staysHere = (url: URL) => url.origin === window.location.origin && url.pathname + url.search === window.location.pathname + window.location.search;

export function LeaveGuard({ dirty, what, bypass }: LeaveGuardProps) {
  const [held, setHeld] = useState<PendingVisit | null>(null);
  const latest = useRef({ dirty, bypass });
  useLayoutEffect(() => {
    latest.current = { dirty, bypass };
  });
  // the visit the person confirmed runs through `before` again and must pass
  const proceeding = useRef(false);

  useEffect(
    () =>
      router.on('before', (event) => {
        const { visit } = event.detail;
        const { dirty: unsaved, bypass: meant } = latest.current;
        if (!unsaved || meant?.current === true || proceeding.current || visit.prefetch || staysHere(visit.url)) return;
        setHeld(visit);
        return false;
      }),
    [],
  );

  // closing or reloading the tab is not a visit of Inertia
  useEffect(() => {
    if (!dirty) return;
    const ask = (event: BeforeUnloadEvent) => {
      if (bypass?.current === true) return;
      event.preventDefault();
      // older browsers want the return value as well
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty, bypass]);

  const proceed = () => {
    if (!held) return;
    setHeld(null);
    proceeding.current = true;
    try {
      router.visit(held.url, {
        method: held.method,
        data: held.data,
        replace: held.replace,
        preserveScroll: held.preserveScroll,
        preserveState: held.preserveState,
        only: held.only,
        except: held.except,
        headers: held.headers,
        errorBag: held.errorBag,
        forceFormData: held.forceFormData,
        queryStringArrayFormat: held.queryStringArrayFormat,
      });
    } finally {
      proceeding.current = false;
    }
  };

  return (
    <AlertDialog
      open={held !== null}
      onOpenChange={(open) => !open && setHeld(null)}
      title={t('settings.frame.leave_title')}
      description={t('settings.frame.leave_description', { what })}
      confirmLabel={t('settings.frame.leave_confirm')}
      cancelLabel={t('settings.frame.leave_cancel')}
      onConfirm={proceed}
    />
  );
}
