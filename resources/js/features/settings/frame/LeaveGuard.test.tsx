import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { LeaveGuard } from './LeaveGuard';

type Visit = Record<string, unknown> & { url: URL };
type Listener = (event: { detail: { visit: Visit } }) => boolean | void;

const inertia = vi.hoisted(() => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    /** The `before` listeners: the guard registers one. */
    get before() {
      return listeners.get('before') ?? new Set<Listener>();
    },
    visit: vi.fn(),
  };
});

vi.mock('@inertiajs/react', () => ({
  router: {
    on: (event: string, listener: Listener) => {
      const set = inertia.listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      inertia.listeners.set(event, set);
      return () => set.delete(listener);
    },
    visit: inertia.visit,
  },
}));

const here = (path: string) => new URL(path, window.location.origin);

function visitTo(path: string, changes: Record<string, unknown> = {}): Visit {
  return {
    id: 'visit-1',
    completed: false,
    cancelled: false,
    interrupted: false,
    url: here(path),
    method: 'get',
    data: {},
    replace: false,
    preserveScroll: false,
    preserveState: false,
    only: [],
    except: [],
    headers: {},
    errorBag: '',
    forceFormData: false,
    queryStringArrayFormat: 'brackets',
    prefetch: false,
    preserveUrl: false,
    ...changes,
  };
}

/** What Inertia does when a visit starts: every `before` listener is asked, and one that answers `false` stops it. */
function announce(visit: Visit): 'stopped' | 'goes on' {
  const answers = [...inertia.before].map((listener) => listener({ detail: { visit } }));
  return answers.includes(false) ? 'stopped' : 'goes on';
}

/** `announce` from a place that may update the screen (the guard sets state when it stops a visit). */
function announceInAct(visit: Visit): 'stopped' | 'goes on' {
  let answer: 'stopped' | 'goes on' = 'goes on';
  act(() => {
    answer = announce(visit);
  });
  return answer;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/projects/web/settings/general');
});

afterEach(() => {
  inertia.visit.mockReset();
});

describe('LeaveGuard (Inertia visits)', () => {
  it('lets every visit pass while nothing is changed', () => {
    render(<LeaveGuard dirty={false} what="Änderungen am Projekt" />);

    expect(announce(visitTo('/inbox'))).toBe('goes on');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('stops a visit while there are changes and asks what is lost', async () => {
    render(<LeaveGuard dirty what="Änderungen am Projekt „WEB“" />);

    expect(announceInAct(visitTo('/inbox'))).toBe('stopped');

    const dialog = await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' });
    expect(dialog.textContent).toContain('Änderungen am Projekt „WEB“ sind nicht gespeichert. Gehst du jetzt weiter, sind sie weg.');
    // the focus starts on the safe answer
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Weiter bearbeiten' })));
    expect(inertia.visit).not.toHaveBeenCalled();
  });

  it('asks in other words when it keeps something else than edits, and goes on with its own confirmation', async () => {
    const user = userEvent.setup();
    render(
      <LeaveGuard
        dirty
        what="unused"
        question={{ title: 'Recovery-Codes gesichert?', description: 'Die Codes zeigt werkbuch nur jetzt.', confirmLabel: 'Weitergehen', cancelLabel: 'Zurück zu den Codes' }}
      />,
    );

    announceInAct(visitTo('/inbox'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Recovery-Codes gesichert?' });
    expect(dialog.textContent).toContain('Die Codes zeigt werkbuch nur jetzt.');
    expect(dialog.textContent).not.toContain('unused');
    expect(screen.getByRole('button', { name: 'Zurück zu den Codes' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Weitergehen' }));

    expect(inertia.visit).toHaveBeenCalledWith(here('/inbox'), expect.objectContaining({ method: 'get' }));
  });

  it('"Weiter bearbeiten" and Escape stay on the page without visiting', async () => {
    const user = userEvent.setup();
    render(<LeaveGuard dirty what="Änderungen" />);

    announceInAct(visitTo('/inbox'));
    await user.click(await screen.findByRole('button', { name: 'Weiter bearbeiten' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    announceInAct(visitTo('/inbox'));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    expect(inertia.visit).not.toHaveBeenCalled();
  });

  it('"Verwerfen" repeats the stopped visit with every option and callback it had, and that visit is not stopped again', async () => {
    const user = userEvent.setup();
    let again: string | undefined;
    inertia.visit.mockImplementation((url: URL) => {
      // Inertia announces the visit again, synchronously, before it sends anything
      again = announce(visitTo(url.pathname, { method: 'post' }));
    });
    render(<LeaveGuard dirty what="Änderungen" />);

    // the logout of the profile menu: its error feedback lives in per-visit callbacks
    const onHttpException = vi.fn();
    const onNetworkError = vi.fn();
    const logout = visitTo('/logout', {
      method: 'post',
      data: { all: true },
      replace: true,
      preserveScroll: true,
      preserveState: true,
      only: ['auth'],
      except: ['flash'],
      headers: { 'X-Test': '1' },
      errorBag: 'logout',
      async: true,
      showProgress: false,
      reset: ['flash'],
      onHttpException,
      onNetworkError,
    });
    announceInAct(logout);
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));

    expect(inertia.visit).toHaveBeenCalledTimes(1);
    const [url, options] = inertia.visit.mock.calls[0] as [URL, Record<string, unknown>];
    expect(url).toBe(logout.url);
    // everything but the bookkeeping Inertia makes up anew for every visit
    const { url: _url, id: _id, completed: _completed, cancelled: _cancelled, interrupted: _interrupted, ...expected } = logout;
    expect(options).toEqual(expected);
    expect(options.onHttpException).toBe(onHttpException);
    expect(options.onNetworkError).toBe(onNetworkError);
    expect(options).not.toHaveProperty('id');
    expect(again).toBe('goes on');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    // the pass was for that one visit: the next one is asked again
    expect(announceInAct(visitTo('/inbox'))).toBe('stopped');
  });

  it('visits only once when "Verwerfen" is pressed twice while the dialog fades out', async () => {
    // a browser keeps the dialog on screen while its exit animation runs; jsdom has none, so let one run for good
    const getAnimations = vi.fn(() => [{ finished: new Promise(() => {}) }]);
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: getAnimations });
    try {
      render(<LeaveGuard dirty what="Änderungen" />);
      announceInAct(visitTo('/inbox'));
      const discard = await screen.findByRole('button', { name: 'Verwerfen' });

      fireEvent.click(discard);
      fireEvent.click(discard);

      expect(discard.isConnected).toBe(true);
      expect(inertia.visit).toHaveBeenCalledTimes(1);
    } finally {
      // @ts-expect-error jsdom has none: take the stub away again
      delete Element.prototype.getAnimations;
    }
  });

  it('lets a visit to the address the page already has pass (a reload), but not another address on the same path', () => {
    window.history.replaceState({}, '', '/settings/workflows?workflow=wf_agency');
    render(<LeaveGuard dirty what="Änderungen" />);

    expect(announce(visitTo('/settings/workflows?workflow=wf_agency#top', { only: ['organization'] }))).toBe('goes on');
    expect(announceInAct(visitTo('/settings/workflows?workflow=wf_other'))).toBe('stopped');
    expect(announceInAct({ ...visitTo('/settings/workflows'), url: new URL('https://other.example.com/settings/workflows?workflow=wf_agency') })).toBe('stopped');
  });

  it('lets a visit pass that keeps the address (preserveUrl): nothing is left behind', () => {
    render(<LeaveGuard dirty what="Änderungen" />);

    expect(announce(visitTo('/inbox', { preserveUrl: true }))).toBe('goes on');
  });

  it('gives the focus back to the control the person came from when they keep editing', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Zur Inbox</button>
        <LeaveGuard dirty what="Änderungen" />
      </>,
    );
    const origin = screen.getByRole('button', { name: 'Zur Inbox' });
    origin.focus();

    announceInAct(visitTo('/inbox'));
    await user.click(await screen.findByRole('button', { name: 'Weiter bearbeiten' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it('lets a prefetch pass: hovering a link leaves nothing behind', () => {
    render(<LeaveGuard dirty what="Änderungen" />);

    expect(announce(visitTo('/inbox', { prefetch: true }))).toBe('goes on');
  });

  it('lets a deliberate leave pass while bypass is set, and asks again once it is cleared', () => {
    const bypass: RefObject<boolean> = { current: true };
    render(<LeaveGuard dirty what="Änderungen" bypass={bypass} />);

    expect(announce(visitTo('/projects'))).toBe('goes on');

    bypass.current = false;
    expect(announceInAct(visitTo('/projects'))).toBe('stopped');
  });

  it('follows the changes without registering again, so a leave right after saving is not stopped', () => {
    const { rerender } = render(<LeaveGuard dirty what="Änderungen" />);
    expect(inertia.before.size).toBe(1);

    rerender(<LeaveGuard dirty={false} what="Änderungen" />);
    expect(announce(visitTo('/inbox'))).toBe('goes on');

    rerender(<LeaveGuard dirty what="Änderungen" />);
    expect(announceInAct(visitTo('/inbox'))).toBe('stopped');
    expect(inertia.before.size).toBe(1);
  });

  it('stops listening when the screen goes', () => {
    const { unmount } = render(<LeaveGuard dirty what="Änderungen" />);

    unmount();

    expect(inertia.before.size).toBe(0);
  });
});

describe('LeaveGuard (closing the tab)', () => {
  const closeTab = () => {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    // jsdom's legacy `returnValue` is a flag, not the string a browser shows: keep what the guard assigns
    let returned: unknown;
    Object.defineProperty(event, 'returnValue', { configurable: true, get: () => returned, set: (value) => (returned = value) });
    window.dispatchEvent(event);
    return event;
  };

  it('asks the browser to confirm only while there are changes', () => {
    const { rerender } = render(<LeaveGuard dirty={false} what="Änderungen" />);
    const idle = closeTab();
    expect(idle.defaultPrevented).toBe(false);
    expect(idle.returnValue).toBeUndefined();

    rerender(<LeaveGuard dirty what="Änderungen" />);
    const event = closeTab();
    expect(event.defaultPrevented).toBe(true);
    // older browsers want the return value as well
    expect(event.returnValue).toBe('');

    rerender(<LeaveGuard dirty={false} what="Änderungen" />);
    expect(closeTab().defaultPrevented).toBe(false);
  });

  it('does not ask for a leave that is meant (bypass) and not after the screen has gone', () => {
    const bypass: RefObject<boolean> = { current: true };
    const { unmount } = render(<LeaveGuard dirty what="Änderungen" bypass={bypass} />);
    expect(closeTab().defaultPrevented).toBe(false);

    bypass.current = false;
    expect(closeTab().defaultPrevented).toBe(true);

    unmount();
    expect(closeTab().defaultPrevented).toBe(false);
  });
});

describe('LeaveGuard (Back and Forward with the Navigation API)', () => {
  type Destination = { key: string; url: string; sameDocument: boolean };

  // made when the traversal is asked for, so a refusal has a handler from its first moment
  let committed: () => Promise<unknown>;
  const traverseTo = vi.fn((_key: string) => ({ committed: committed() }));
  const navigation = new EventTarget();

  beforeEach(() => {
    committed = () => Promise.resolve();
    Object.defineProperty(window, 'navigation', { configurable: true, value: Object.assign(navigation, { traverseTo }) });
  });

  afterEach(() => {
    traverseTo.mockClear();
    // @ts-expect-error jsdom has none: take the stub away again
    delete window.navigation;
  });

  const traverse = (changes: { navigationType?: string; cancelable?: boolean; destination?: Partial<Destination> } = {}) => {
    const event = new Event('navigate', { cancelable: changes.cancelable ?? true });
    Object.assign(event, {
      navigationType: changes.navigationType ?? 'traverse',
      destination: { key: 'entry-1', url: here('/projects/web/settings/members').href, sameDocument: true, ...changes.destination },
    });
    act(() => void navigation.dispatchEvent(event));
    return event;
  };

  it('cancels a step back while there are changes, and asks', async () => {
    render(<LeaveGuard dirty what="Änderungen am Projekt" />);

    expect(traverse().defaultPrevented).toBe(true);

    expect((await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).textContent).toContain('Änderungen am Projekt sind nicht gespeichert');
    expect(traverseTo).not.toHaveBeenCalled();
  });

  it('"Weiter bearbeiten" stays where the page is', async () => {
    const user = userEvent.setup();
    render(<LeaveGuard dirty what="Änderungen" />);

    traverse();
    await user.click(await screen.findByRole('button', { name: 'Weiter bearbeiten' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(traverseTo).not.toHaveBeenCalled();
  });

  it('"Verwerfen" traverses to the entry, lets that traversal pass, and guards again once it is committed', async () => {
    const user = userEvent.setup();
    let commit!: () => void;
    const pending = new Promise<void>((done) => (commit = done));
    committed = () => pending;
    render(<LeaveGuard dirty what="Änderungen" />);

    traverse({ destination: { key: 'entry-7' } });
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));

    expect(traverseTo).toHaveBeenCalledWith('entry-7');
    expect(traverse({ destination: { key: 'entry-7' } }).defaultPrevented).toBe(false);

    await act(async () => commit());
    expect(traverse().defaultPrevented).toBe(true);
  });

  it('guards again when the traversal is refused (the entry is gone)', async () => {
    const user = userEvent.setup();
    committed = () => Promise.reject(new DOMException('gone', 'InvalidStateError'));
    render(<LeaveGuard dirty what="Änderungen" />);

    traverse();
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));

    await waitFor(() => expect(traverse().defaultPrevented).toBe(true));
  });

  it.each<[string, () => Event]>([
    ['a push of Inertia', () => traverse({ navigationType: 'push' })],
    ['a replace', () => traverse({ navigationType: 'replace' })],
    ['a traversal the browser does not let a page cancel', () => traverse({ cancelable: false })],
    ['a traversal that leaves the document (beforeunload asks there)', () => traverse({ destination: { sameDocument: false } })],
    ['a traversal to the same page (a hash)', () => traverse({ destination: { url: `${window.location.href}#top` } })],
  ])('lets %s pass', (_name, step) => {
    render(<LeaveGuard dirty what="Änderungen" />);

    expect(step().defaultPrevented).toBe(false);
  });

  it('lets every step pass without changes, and with a deliberate leave', () => {
    const bypass: RefObject<boolean> = { current: true };
    const { rerender } = render(<LeaveGuard dirty what="Änderungen" bypass={bypass} />);
    expect(traverse().defaultPrevented).toBe(false);

    rerender(<LeaveGuard dirty={false} what="Änderungen" />);
    expect(traverse().defaultPrevented).toBe(false);
  });

  it('does not add the popstate fallback, and stops listening with the screen', () => {
    const seen = vi.fn();
    window.addEventListener('popstate', seen);
    const { unmount } = render(<LeaveGuard dirty what="Änderungen" />);

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(seen).toHaveBeenCalledTimes(1);

    unmount();
    expect(traverse().defaultPrevented).toBe(false);
    window.removeEventListener('popstate', seen);
  });
});

describe('LeaveGuard (Back and Forward without the Navigation API)', () => {
  const left = { entry: 'general' };
  const destination = { entry: 'members' };
  const generalUrl = () => here('/projects/web/settings/general').href;
  const membersUrl = () => here('/projects/web/settings/members').href;

  let inertiaSees: Mock<(event: PopStateEvent) => void>;

  beforeEach(() => {
    window.history.replaceState(left, '', '/projects/web/settings/general');
    // Inertia's own listener: bubble phase on window
    inertiaSees = vi.fn<(event: PopStateEvent) => void>();
    window.addEventListener('popstate', inertiaSees);
  });

  afterEach(() => {
    window.removeEventListener('popstate', inertiaSees);
  });

  /** What a browser does for Back: the entry changes first, then `popstate` tells the page. */
  const goBack = () => {
    window.history.replaceState(destination, '', '/projects/web/settings/members');
    act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: destination })));
  };

  it('stops the event before Inertia sees it, puts the entry back, and asks', async () => {
    render(<LeaveGuard dirty what="Änderungen am Projekt" />);

    goBack();

    expect(inertiaSees).not.toHaveBeenCalled();
    expect(window.location.href).toBe(generalUrl());
    expect(window.history.state).toEqual(left);
    expect((await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).textContent).toContain('Änderungen am Projekt sind nicht gespeichert');
  });

  it('"Weiter bearbeiten" stays on the entry, and Inertia never hears of the step', async () => {
    const user = userEvent.setup();
    render(<LeaveGuard dirty what="Änderungen" />);

    goBack();
    await user.click(await screen.findByRole('button', { name: 'Weiter bearbeiten' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(window.location.href).toBe(generalUrl());
    expect(inertiaSees).not.toHaveBeenCalled();
  });

  it('"Verwerfen" puts the destination in place and tells Inertia, once, with its state', async () => {
    const user = userEvent.setup();
    render(<LeaveGuard dirty what="Änderungen" />);

    goBack();
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));

    expect(window.location.href).toBe(membersUrl());
    expect(window.history.state).toEqual(destination);
    expect(inertiaSees).toHaveBeenCalledTimes(1);
    expect(inertiaSees.mock.calls[0]![0]).toMatchObject({ state: destination });

    // the pass was for that one step: the next one is asked again
    window.history.replaceState(left, '', '/projects/web/settings/general');
    goBack();
    expect(inertiaSees).toHaveBeenCalledTimes(1);
  });

  it('restores the entry the last visit of Inertia ended on', async () => {
    render(<LeaveGuard dirty what="Änderungen" />);
    const arrived = { entry: 'types' };
    window.history.replaceState(arrived, '', '/projects/web/settings/types');
    act(() => void [...(inertia.listeners.get('navigate') ?? [])].forEach((listener) => listener({ detail: { visit: visitTo('/') } })));

    goBack();

    expect(window.location.href).toBe(here('/projects/web/settings/types').href);
    expect(window.history.state).toEqual(arrived);
    await screen.findByRole('alertdialog');
  });

  it('restores the entry a partial reload or a replacing visit ended on, which only ends in success', async () => {
    render(<LeaveGuard dirty what="Änderungen" />);
    const reloaded = { entry: 'general', props: 'fresh' };
    window.history.replaceState(reloaded, '', '/projects/web/settings/general?tab=1');
    act(() => void [...(inertia.listeners.get('success') ?? [])].forEach((listener) => listener({ detail: { visit: visitTo('/') } })));

    goBack();

    expect(window.location.href).toBe(here('/projects/web/settings/general?tab=1').href);
    expect(window.history.state).toEqual(reloaded);
    await screen.findByRole('alertdialog');
  });

  it('lets a step pass without changes, with a deliberate leave, and to the same page', () => {
    const bypass: RefObject<boolean> = { current: true };
    const { rerender } = render(<LeaveGuard dirty what="Änderungen" bypass={bypass} />);
    goBack();
    expect(inertiaSees).toHaveBeenCalledTimes(1);

    rerender(<LeaveGuard dirty={false} what="Änderungen" />);
    goBack();
    expect(inertiaSees).toHaveBeenCalledTimes(2);

    // only the hash changed
    rerender(<LeaveGuard dirty what="Änderungen" />);
    window.history.replaceState(left, '', '/projects/web/settings/general#top');
    act(() => void window.dispatchEvent(new PopStateEvent('popstate', { state: left })));
    expect(inertiaSees).toHaveBeenCalledTimes(3);
  });

  it('stops listening with the screen', () => {
    const { unmount } = render(<LeaveGuard dirty what="Änderungen" />);

    unmount();
    goBack();

    expect(inertiaSees).toHaveBeenCalledTimes(1);
    expect(inertia.listeners.get('navigate')?.size).toBe(0);
    expect(inertia.listeners.get('success')?.size).toBe(0);
  });
});
