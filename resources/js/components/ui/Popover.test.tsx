import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './Popover';

describe('Popover', () => {
  it('opens with Enter on its trigger, puts the focus into the popover and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger render={<Button variant="secondary">Filter</Button>} />
        <PopoverContent title="Filter" description="Nach Status eingrenzen.">
          <button type="button">Nur offene</button>
        </PopoverContent>
      </Popover>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filter' }));

    await user.keyboard('{Enter}');
    const popup = await screen.findByRole('dialog', { name: 'Filter' });
    expect(screen.getByText('Nach Status eingrenzen.')).toBeTruthy();
    expect(popup.className).toContain('w-72');
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filter' }));
  });

  it('puts the focus where initialFocus says, takes its own width and closes from inside', async () => {
    const user = userEvent.setup();
    render(
      <Popover defaultOpen>
        <PopoverTrigger render={<Button variant="secondary">Datum</Button>} />
        <PopoverContent initialFocus={false} className="w-96 p-0" keepSide side="top" align="end" sideOffset={10}>
          <PopoverClose render={<button type="button">Fertig</button>} />
        </PopoverContent>
      </Popover>,
    );

    const popup = await screen.findByRole('dialog');
    expect(popup.className).toContain('w-96');
    expect(popup.className).not.toContain('w-72');
    expect(popup.contains(document.activeElement)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on a click outside', async () => {
    const user = userEvent.setup();
    render(
      <>
        <p>Daneben</p>
        <Popover defaultOpen>
          <PopoverTrigger render={<Button variant="secondary">Datum</Button>} />
          <PopoverContent>
            <span>Inhalt</span>
          </PopoverContent>
        </Popover>
      </>,
    );
    await screen.findByRole('dialog');

    await user.click(screen.getByText('Daneben'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
