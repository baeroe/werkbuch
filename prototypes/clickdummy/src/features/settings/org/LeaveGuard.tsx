/*
 * Warns before unsaved edits are lost by leaving the page (guidelines: "Warn on unsaved changes before navigation").
 * While `dirty`, a navigation inside the app (a link of the settings, the back button, the sidebar) stops at "Änderungen
 * verwerfen?", and closing or reloading the tab gets the browser's own question. A deliberate leave, such as the move
 * to the id of a workflow that was just saved, sets `bypass` first and is let through.
 *
 * Blocking needs a data router, which the app has; in a test without one the guard does nothing.
 */

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router';
import { AlertDialog } from '@/components/ui/AlertDialog';

type LeaveGuardProps = {
  dirty: boolean;
  /** What is lost, for the question: "Änderungen an „Agentur-Freigabe“". */
  what: string;
  /** Set to true right before a navigation that is meant, so it is not stopped. */
  bypass?: RefObject<boolean>;
};

function RouterGuard({ dirty, what, bypass }: LeaveGuardProps) {
  // the blocker asks the function at the moment of navigation, so it reads the latest values from refs
  const latest = useRef(dirty);
  useLayoutEffect(() => {
    latest.current = dirty;
  });
  const shouldBlock = useCallback(() => latest.current && bypass?.current !== true, [bypass]);
  const blocker = useBlocker(shouldBlock);

  return (
    <AlertDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => !open && blocker.reset?.()}
      title="Änderungen verwerfen?"
      description={`${what} sind nicht gespeichert. Gehst du jetzt weiter, sind sie weg.`}
      confirmLabel="Verwerfen"
      cancelLabel="Weiter bearbeiten"
      onConfirm={() => blocker.proceed?.()}
    />
  );
}

export function LeaveGuard(props: LeaveGuardProps) {
  const inDataRouter = useContext(UNSAFE_DataRouterContext) !== null;

  // closing or reloading the tab is not a navigation of the router
  useEffect(() => {
    if (!props.dirty) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [props.dirty]);

  return inDataRouter ? <RouterGuard {...props} /> : null;
}
