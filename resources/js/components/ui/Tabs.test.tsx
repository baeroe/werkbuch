import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tab, Tabs, TabsList, TabsPanel } from './Tabs';

function renderTabs(onValueChange = vi.fn()) {
  render(
    <Tabs defaultValue="general" onValueChange={onValueChange}>
      <TabsList aria-label="Einstellungen" className="mb-2">
        <Tab value="general">Allgemein</Tab>
        <Tab value="members">Mitglieder</Tab>
        <Tab value="danger" disabled>
          Gefahr
        </Tab>
      </TabsList>
      <TabsPanel value="general" className="p-1">
        Allgemeine Einstellungen
      </TabsPanel>
      <TabsPanel value="members">Mitgliederliste</TabsPanel>
    </Tabs>,
  );
  return onValueChange;
}

describe('Tabs', () => {
  it('names the list and marks the open tab', () => {
    renderTabs();

    expect(screen.getByRole('tablist', { name: 'Einstellungen' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Allgemein' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Mitglieder' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel').textContent).toBe('Allgemeine Einstellungen');
    expect(screen.getByRole('tabpanel').className).toContain('p-1');
  });

  it('the arrow keys move the focus along the tabs, and Enter opens the tab and reports it', async () => {
    const user = userEvent.setup();
    const onValueChange = renderTabs();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Allgemein' }));

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Mitglieder' }));
    // the person decides with Enter or Space; moving over the tabs opens none
    expect(onValueChange).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith('members', expect.anything());
    expect(screen.getByRole('tabpanel').textContent).toBe('Mitgliederliste');

    // a disabled tab can be reached (and explained) but not opened; after it the focus wraps around
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Gefahr' }));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Mitglieder' }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Allgemein' }));
    await user.keyboard(' ');
    expect(onValueChange).toHaveBeenLastCalledWith('general', expect.anything());

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Gefahr' }));
  });

  it('opens a tab by click', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole('tab', { name: 'Mitglieder' }));

    expect(screen.getByRole('tabpanel').textContent).toBe('Mitgliederliste');
  });
});
