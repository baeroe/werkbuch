import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveIndicator } from './LiveIndicator';

let connected = true;

vi.mock('@/hooks/live', () => ({ useLiveConnected: () => connected }));

afterEach(() => {
  connected = true;
  vi.restoreAllMocks();
});

describe('LiveIndicator', () => {
  it('shows the banner in the status region while the live connection is down, and "Neu laden" reloads', async () => {
    connected = false;
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const user = userEvent.setup();
    render(<LiveIndicator />);

    const region = screen.getByRole('status');
    expect(within(region).getByText('Live-Updates pausiert')).toBeTruthy();
    expect(within(region).getByText('Änderungen anderer erscheinen erst nach dem Neuladen.')).toBeTruthy();

    await user.click(within(region).getByRole('button', { name: 'Neu laden' }));
    expect(reload).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('leaves the region empty while the connection is up, so a screen reader announces the banner when it comes', () => {
    render(<LiveIndicator />);

    expect(screen.getByRole('status').textContent).toBe('');
  });
});
