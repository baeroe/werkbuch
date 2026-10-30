import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip';

describe('Tooltip', () => {
  it('appears when the trigger gets the focus and goes away on Escape', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Tooltip content="Neues Item">
          <button type="button">Neu</button>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.queryByText('Neues Item')).toBeNull();

    await user.tab();
    await waitFor(() => expect(screen.getByText('Neues Item')).toBeTruthy());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Neues Item')).toBeNull());
  });

  it('passes the side on to the positioner', async () => {
    render(
      <Tooltip content="Unten" side="bottom" defaultOpen>
        <button type="button">Neu</button>
      </Tooltip>,
    );

    await waitFor(() => expect(document.querySelector('[data-side="bottom"]')?.textContent).toContain('Unten'));
  });

  it('shows a shortcut after the text, hidden from screen readers', async () => {
    render(
      <Tooltip content="Suchen" shortcut="mod+k" defaultOpen>
        <button type="button">Suche</button>
      </Tooltip>,
    );

    const kbd = await waitFor(() => {
      const found = document.querySelector('[data-side] kbd[role="img"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(kbd.getAttribute('aria-hidden')).toBe('true');
    expect(kbd.getAttribute('aria-label')).toBe('Steuerung K');
  });

  it('stays closed when disabled', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Neues Item" disabled>
        <button type="button">Neu</button>
      </Tooltip>,
    );

    await user.tab();

    expect(screen.queryByText('Neues Item')).toBeNull();
  });
});
