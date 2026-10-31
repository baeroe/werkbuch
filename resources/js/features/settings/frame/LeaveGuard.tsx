/*
 * Warns before unsaved edits are lost by leaving the page (guidelines: "Warn on unsaved changes before navigation").
 * While `dirty`, a visit inside the app (a link of the settings, the sidebar) stops at "Discard changes?" and goes on
 * only when the person says so; closing or reloading the tab gets the browser's own question. A deliberate leave, such as
 * the move to the new identifier of a project that was just saved, sets `bypass` first and is let through.
 *
 * Three doors, three mechanisms:
 * - Inertia visits: `router.on('before')`. The guard reads `dirty` and `bypass` from refs, because Inertia asks at the
 *   moment a visit starts and a state change would not have reached the guard in the same breath. "Discard" repeats the
 *   visit with every option and callback of the held one (the pending visit carries them; only its bookkeeping is left out).
 * - The browser's Back and Forward buttons: Inertia listens to `popstate` itself and announces nothing. Where the
 *   Navigation API exists (all current browsers), the `navigate` event of a same-document `traverse` is cancelled and its
 *   destination key held; "Discard" calls `navigation.traverseTo(key)` with `proceeding` set. Without it, a capture-phase
 *   `popstate` listener on `window` stops the event before Inertia sees it (the browser has already moved on, so the left
 *   entry is pushed back with `history.pushState`) and holds the destination; "Discard" puts the destination back with
 *   `history.replaceState` and re-dispatches the `popstate` with `proceeding` set, so Inertia handles it as usual.
 *   Limits of the fallback: the pushed entry cuts the forward history (after "Discard" the destination is entered twice
 *   in the stack), it restores the state of the last Inertia `navigate`, and it relies on capture listeners running
 *   before bubble listeners at the target, which every browser since 2021 does. A traversal that leaves the document
 *   (a reload, another site) is left to the `beforeunload` question.
 *   Either way, a second Back while the question is open, without a click or key on the page in between, cannot be
 *   stopped: browsers let a page cancel a traversal only after a user activation (the Navigation API's `cancelable` is
 *   false then, the fallback has nothing left to stop), so that step goes through and the dialog stays.
 * - Closing or reloading the tab: `beforeunload`.
 */

import { router } from '@inertiajs/react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { t } from '@/lib/i18n';

/** The visit Inertia announces in its `before` event; at run time it also carries the callbacks it was started with. */
type PendingVisit = Parameters<Parameters<typeof router.on<'before'>>[1]>[0]['detail']['visit'];

/** The part of the Navigation API the guard uses (not in every `lib.dom`). */
interface NavigateEventLike extends Event {
  navigationType: string;
  destination: { key: string; url: string; sameDocument: boolean };
}
interface NavigationLike extends EventTarget {
  traverseTo: (key: string) => { committed: Promise<unknown> };
}
const navigationApi = (): NavigationLike | undefined => (window as { navigation?: NavigationLike }).navigation;

/** What the dialog is asking about: the visit, a step in the history (Navigation API), or one that `popstate` reported. */
type Held = { kind: 'visit'; visit: PendingVisit } | { kind: 'history'; key: string } | { kind: 'popstate'; state: unknown; url: string };

type LeaveGuardProps = {
  dirty: boolean;
  /** What is lost, for the question: "Changes to “Agency approval”". */
  what: string;
  /** Set to true right before a navigation that is meant, so it is not stopped. */
  bypass?: RefObject<boolean>;
};

/** Whether two addresses are the same page: a reload, a partial reload or a hash change leaves nothing behind. */
const samePage = (a: URL, b: URL) => a.origin === b.origin && a.pathname + a.search === b.pathname + b.search;
const staysHere = (url: URL) => samePage(url, new URL(window.location.href));

export function LeaveGuard({ dirty, what, bypass }: LeaveGuardProps) {
  const [held, setHeld] = useState<Held | null>(null);
  const latest = useRef({ dirty, bypass });
  useLayoutEffect(() => {
    latest.current = { dirty, bypass };
  });
  /** Edits that would be lost and nobody has agreed to lose. */
  const guarding = () => latest.current.dirty && latest.current.bypass?.current !== true;
  // what the person confirmed runs through the guard again and must pass
  const proceeding = useRef(false);

  useEffect(
    () =>
      router.on('before', (event) => {
        const { visit } = event.detail;
        if (!guarding() || proceeding.current || visit.prefetch || visit.preserveUrl || staysHere(visit.url)) return;
        setHeld({ kind: 'visit', visit });
        return false;
      }),
    [],
  );

  // Back and Forward, with the Navigation API
  useEffect(() => {
    const navigation = navigationApi();
    if (!navigation) return;
    const onNavigate = (event: Event) => {
      const { navigationType, destination } = event as NavigateEventLike;
      if (navigationType !== 'traverse' || !event.cancelable || !destination.sameDocument || !guarding() || proceeding.current || staysHere(new URL(destination.url))) return;
      event.preventDefault();
      setHeld({ kind: 'history', key: destination.key });
    };
    navigation.addEventListener('navigate', onNavigate);
    return () => navigation.removeEventListener('navigate', onNavigate);
  }, []);

  // Back and Forward, without it: the entry that is shown now, kept up to date by the visits of Inertia. `navigate` comes
  // with every new page; a partial reload or a visit that replaces the entry only ends in `success`, and its state (the
  // page Inertia restores) has changed all the same
  useEffect(() => {
    if (navigationApi()) return;
    let shown = { state: window.history.state as unknown, url: window.location.href };
    const remember = () => {
      shown = { state: window.history.state as unknown, url: window.location.href };
    };
    const offNavigate = router.on('navigate', remember);
    const offSuccess = router.on('success', remember);
    const onPopState = (event: PopStateEvent) => {
      if (!guarding() || proceeding.current || samePage(new URL(window.location.href), new URL(shown.url))) return;
      // before Inertia's own listener sees it
      event.stopImmediatePropagation();
      setHeld({ kind: 'popstate', state: event.state as unknown, url: window.location.href });
      // the browser has moved on already: put the entry the person is leaving back
      window.history.pushState(shown.state, '', shown.url);
    };
    window.addEventListener('popstate', onPopState, true);
    return () => {
      offNavigate();
      offSuccess();
      window.removeEventListener('popstate', onPopState, true);
    };
  }, []);

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
    const done = () => {
      proceeding.current = false;
    };
    if (held.kind === 'history') {
      // the traversal is asked about in a task of its own: the pass lasts until it is committed (or refused)
      navigationApi()!.traverseTo(held.key).committed.then(done, done);
      return;
    }
    try {
      if (held.kind === 'popstate') {
        window.history.replaceState(held.state, '', held.url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: held.state }));
      } else {
        // everything the visit was started with, callbacks included; only its bookkeeping is Inertia's own
        const { url, id: _id, completed: _completed, cancelled: _cancelled, interrupted: _interrupted, ...options } = held.visit;
        router.visit(url, options);
      }
    } finally {
      done();
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
