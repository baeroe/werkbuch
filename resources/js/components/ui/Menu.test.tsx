import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pencil, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  MenuTrigger,
} from './Menu';

describe('Menu', () => {
  it('opens on its trigger with Enter, runs an entry with Enter and gives the focus back', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <Menu>
        <MenuTrigger render={<Button variant="secondary">Aktionen</Button>} />
        <MenuContent>
          <MenuItem icon={Pencil} shortcut="e" onClick={onRename}>
            Umbenennen
          </MenuItem>
          <MenuItem icon={Trash2} danger>
            Löschen
          </MenuItem>
        </MenuContent>
      </Menu>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.querySelector('span')?.textContent)).toEqual(['Umbenennen', 'Löschen']);
    // the shortcut is a hint for the eyes and a property for assistive technology
    expect(screen.getByRole('menuitem', { name: /Umbenennen/ }).getAttribute('aria-keyshortcuts')).toBe('E');
    expect(screen.getByRole('menuitem', { name: 'Löschen' }).className).toContain('text-danger');

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Umbenennen/ })));
    await user.keyboard('{Enter}');

    expect(onRename).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Aktionen' }));
  });

  it('moves through the entries with the arrow keys and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Menu>
        <MenuTrigger render={<Button variant="secondary">Aktionen</Button>} />
        <MenuContent keepSide className="w-64" side="bottom" align="end">
          <MenuItem>Eins</MenuItem>
          <MenuItem>Zwei</MenuItem>
        </MenuContent>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'Aktionen' }));
    await screen.findByRole('menu');

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Eins' }).hasAttribute('data-highlighted')).toBe(true));
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Zwei' })));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('a radio group reports the chosen value, a checkbox item its state', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    const onDone = vi.fn();
    function Harness() {
      const [sort, setSort] = useState('created');
      return (
        <Menu>
          <MenuTrigger render={<Button variant="secondary">Anzeige</Button>} />
          <MenuContent>
            <MenuGroup>
              <MenuGroupLabel>Sortieren nach</MenuGroupLabel>
              <MenuRadioGroup
                value={sort}
                onValueChange={(next) => {
                  onSort(next);
                  setSort(next as string);
                }}
              >
                <MenuRadioItem value="created">Erstellt</MenuRadioItem>
                <MenuRadioItem value="priority" shortcut="p">
                  Priorität
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuCheckboxItem onCheckedChange={onDone}>Erledigte zeigen</MenuCheckboxItem>
          </MenuContent>
        </Menu>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Anzeige' }));
    await screen.findByRole('menu');

    expect(screen.getByRole('group', { name: 'Sortieren nach' })).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Erstellt' }).getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('menuitemradio', { name: /Priorität/ }));
    expect(onSort).toHaveBeenCalledWith('priority');

    // choosing leaves the menu open, so several settings can be changed in a row
    expect(screen.getByRole('menuitemradio', { name: /Priorität/ }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Erledigte zeigen' }));
    expect(onDone).toHaveBeenCalledWith(true, expect.anything());
  });

  it('opens a submenu with the right arrow and runs its entry with Enter', async () => {
    const user = userEvent.setup();
    const onUrgent = vi.fn();
    render(
      <Menu>
        <MenuTrigger render={<Button variant="secondary">Aktionen</Button>} />
        <MenuContent>
          <MenuSubmenu label="Priorität setzen" icon={Pencil} keepSide>
            <MenuItem onClick={onUrgent}>Dringend</MenuItem>
          </MenuSubmenu>
          <MenuSubmenu label="Verschieben">
            <MenuItem>Nach oben</MenuItem>
          </MenuSubmenu>
        </MenuContent>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'Aktionen' }));
    await screen.findByRole('menu');
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Priorität setzen' }).hasAttribute('data-highlighted')).toBe(true));

    await user.keyboard('{ArrowRight}');
    await screen.findByRole('menuitem', { name: 'Dringend' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Dringend' })));
    await user.keyboard('{Enter}');

    expect(onUrgent).toHaveBeenCalledTimes(1);
  });

  it('a submenu can start open', async () => {
    render(
      <Menu defaultOpen>
        <MenuTrigger render={<Button variant="secondary">Aktionen</Button>} />
        <MenuContent>
          <MenuSubmenu label="Verschieben" defaultOpen>
            <MenuItem>Nach oben</MenuItem>
          </MenuSubmenu>
        </MenuContent>
      </Menu>,
    );

    expect(await screen.findByRole('menuitem', { name: 'Nach oben' })).toBeTruthy();
  });

  it('an entry that navigates is a real link, built from the link passed as render', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <Menu>
        <MenuTrigger render={<Button variant="secondary">Profil</Button>} />
        <MenuContent>
          <MenuLinkItem icon={UserRound} shortcut="m" render={<a href="/me" onClick={onClick} />}>
            Persönliche Einstellungen
          </MenuLinkItem>
        </MenuContent>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'Profil' }));

    const link = await screen.findByRole('menuitem', { name: /Persönliche Einstellungen/ });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/me');
    expect(link.getAttribute('aria-keyshortcuts')).toBe('M');

    await user.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
    // a click on a link entry closes the menu
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('an entry without a shortcut carries no aria-keyshortcuts', async () => {
    const user = userEvent.setup();
    render(
      <Menu>
        <MenuTrigger render={<Button variant="secondary">Aktionen</Button>} />
        <MenuContent>
          <MenuItem>Eins</MenuItem>
          <MenuLinkItem render={<a href="/zwei" />}>Zwei</MenuLinkItem>
        </MenuContent>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'Aktionen' }));
    await screen.findByRole('menu');

    expect(screen.getByRole('menuitem', { name: 'Eins' }).hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'Zwei' }).hasAttribute('aria-keyshortcuts')).toBe(false);
  });
});
