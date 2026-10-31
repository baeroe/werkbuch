/*
 * Against the real Inertia router (no mock): the guard relies on the pending visit that `before` hands out carrying the
 * callbacks it was started with. This pins that, so an Inertia upgrade that stops doing it fails here and not as a
 * sign-out that has lost its error feedback.
 */

import { router } from '@inertiajs/react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeaveGuard } from './LeaveGuard';

afterEach(() => vi.restoreAllMocks());

describe('LeaveGuard with the real Inertia router', () => {
  it('stops a visit started with callbacks and repeats it with the same callbacks', async () => {
    const user = userEvent.setup();
    const visit = vi.spyOn(router, 'visit');
    render(<LeaveGuard dirty what="Änderungen" />);

    const onHttpException = vi.fn();
    const onNetworkError = vi.fn();
    // the first call runs for real up to `before`, where the guard stops it
    act(() => void router.post('/logout', {}, { onHttpException, onNetworkError }));
    const dialog = await screen.findByRole('alertdialog');
    expect(visit).toHaveBeenCalledTimes(1);

    // the repetition: the router is not initialised here, the call and what it carries is all that matters
    visit.mockImplementation(() => undefined);
    await user.click(within(dialog).getByRole('button', { name: 'Verwerfen' }));

    expect(visit).toHaveBeenCalledTimes(2);
    const [url, options] = visit.mock.calls[1]!;
    expect(String(url)).toBe(`${window.location.origin}/logout`);
    expect(options).toMatchObject({ method: 'post', onHttpException, onNetworkError });
    expect(options).not.toHaveProperty('id');
  });
});
