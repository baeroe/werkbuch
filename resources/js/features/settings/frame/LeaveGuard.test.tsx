import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaveGuard } from './LeaveGuard';

type Visit = Record<string, unknown> & { url: URL };
type Listener = (event: { detail: { visit: Visit } }) => boolean | void;

const inertia = vi.hoisted(() => ({
  listeners: new Set<Listener>(),
  visit: vi.fn(),
}));

vi.mock('@inertiajs/react', () => ({
  router: {
    on: (_event: string, listener: Listener) => {
      inertia.listeners.add(listener);
      return () => inertia.listeners.delete(listener);
    },
    visit: inertia.visit,
  },
}));

const here = (path: string) => new URL(path, window.location.origin);

function visitTo(path: string, changes: Record<string, unknown> = {}): Visit {
  return {
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
    ...changes,
  };
}

/** What Inertia does when a visit starts: every `before` listener is asked, and one that answers `false` stops it. */
function announce(visit: Visit): 'stopped' | 'goes on' {
  const answers = [...inertia.listeners].map((listener) => listener({ detail: { visit } }));
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

  it('"Verwerfen" repeats the stopped visit with its options, and that visit is not stopped again', async () => {
    const user = userEvent.setup();
    let again: string | undefined;
    inertia.visit.mockImplementation((url: URL) => {
      // Inertia announces the visit again, synchronously, before it sends anything
      again = announce(visitTo(url.pathname, { method: 'post' }));
    });
    render(<LeaveGuard dirty what="Änderungen" />);

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
    });
    announceInAct(logout);
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));

    expect(inertia.visit).toHaveBeenCalledTimes(1);
    expect(inertia.visit).toHaveBeenCalledWith(logout.url, {
      method: 'post',
      data: { all: true },
      replace: true,
      preserveScroll: true,
      preserveState: true,
      only: ['auth'],
      except: ['flash'],
      headers: { 'X-Test': '1' },
      errorBag: 'logout',
      forceFormData: false,
      queryStringArrayFormat: 'brackets',
    });
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
    expect(inertia.listeners.size).toBe(1);

    rerender(<LeaveGuard dirty={false} what="Änderungen" />);
    expect(announce(visitTo('/inbox'))).toBe('goes on');

    rerender(<LeaveGuard dirty what="Änderungen" />);
    expect(announceInAct(visitTo('/inbox'))).toBe('stopped');
    expect(inertia.listeners.size).toBe(1);
  });

  it('stops listening when the screen goes', () => {
    const { unmount } = render(<LeaveGuard dirty what="Änderungen" />);

    unmount();

    expect(inertia.listeners.size).toBe(0);
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
