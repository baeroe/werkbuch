/*
 * The profile menu at the bottom of the sidebar: theme, "Als … ansehen" (only active people: a deactivated account
 * would be refused with 401), the demo tools (live event, live connection, reset), personal settings and sign-out.
 */

import { LogOut, Radio, RotateCcw, UserRound, Users, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSubmenu, MenuTrigger } from '@/components/ui/Menu';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { useLiveConnected, useSetLiveConnected, useSimulateRemoteChange } from '@/hooks/live';
import { useResetDemo } from '@/hooks/system';
import { useCurrentUser, useUsers } from '@/hooks/users';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import type { ThemeChoice } from '@/lib/theme';
import type { User } from '@/types';
import { useSession } from '@/store/session';
import { useUiStore } from '@/store/ui';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Hell' },
  { value: 'dark', label: 'Dunkel' },
];

const ROLE = { admin: 'Org-Admin', member: 'Member' } as const;

/** What a person sees after a switch, in a sentence for the toast. */
function roleScope(person: User): string {
  const firstName = person.name.split(' ')[0];
  return person.org_role === 'admin'
    ? `Org-Admin: ${firstName} sieht alle Projekte, auch private, und darf alles verwalten.`
    : `Member: ${firstName} sieht die öffentlichen Projekte und die privaten, in denen ${firstName} Mitglied ist.`;
}

/** The preview and the selection belong to what the previous person saw. */
function forgetScreenState() {
  useUiStore.getState().openPeek(null);
  useUiStore.getState().setSelection([]);
}

export function ProfileMenu({ compact = false }: { compact?: boolean }) {
  const settle = useSettle();
  const me = useCurrentUser();
  const users = useUsers();
  const userId = useSession((state) => state.userId);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const connected = useLiveConnected();
  const setConnected = useSetLiveConnected();
  const simulate = useSimulateRemoteChange();
  const reset = useResetDemo();
  const [confirmReset, setConfirmReset] = useState(false);

  const people = (users.data?.items ?? []).filter((user) => user.type === 'person' && user.disabled_at === null);
  const nameOf = (id: string | undefined) => users.data?.items.find((user) => user.id === id)?.name ?? 'Jemand';

  function viewAs(id: string) {
    const person = people.find((entry) => entry.id === id);
    if (!person || id === userId) return;
    useSession.getState().setUserId(id);
    forgetScreenState();
    toast({ title: `Du siehst die App jetzt als ${person.name}`, description: roleScope(person) });
  }

  function simulateEvent() {
    settle(simulate.mutateAsync(undefined), {
      onSuccess: (event) => {
        if (!event) {
          toast({ title: 'Kein Live-Ereignis', description: 'In WEB ist gerade kein offenes Item, das sich ändern ließe.' });
          return;
        }
        const what = event.type === 'work_item.state_changed' ? 'den Status' : 'die Priorität';
        toast({
          title: 'Live-Ereignis simuliert',
          description: connected
            ? `${nameOf(event.actor_id)} hat ${what} eines Items in WEB geändert; Karte oder Zeile leuchten kurz auf.`
            : `${nameOf(event.actor_id)} hat ${what} eines Items in WEB geändert. Die Live-Verbindung ist getrennt: Du siehst es erst nach dem Neuladen.`,
        });
      },
      onError: (error) => notifyError('Live-Ereignis nicht simuliert', error, simulateEvent),
    });
  }

  function resetDemo() {
    settle(reset.mutateAsync(undefined), {
      onSuccess: () => {
        forgetScreenState();
        setConfirmReset(false);
        toast({ title: 'Demo zurückgesetzt', description: 'Die Demo-Daten sind neu geladen, angemeldet ist wieder Mara Lindqvist.', tone: 'success' });
      },
      onError: (error) => {
        setConfirmReset(false);
        notifyError('Demo nicht zurückgesetzt', error, resetDemo);
      },
    });
  }

  const trigger = compact ? (
    <button
      type="button"
      aria-label={me ? `Profil von ${me.name}` : 'Profil'}
      className="inline-flex size-9 cursor-pointer items-center justify-center rounded-ctl transition-colors duration-120 hover:bg-hover data-popup-open:bg-hover"
    >
      {me ? <Avatar user={me} decorative /> : <Skeleton className="size-7 rounded-full" />}
    </button>
  ) : (
    <button
      type="button"
      className="flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-ctl px-2 text-left text-ui transition-colors duration-120 hover:bg-hover data-popup-open:bg-hover md:h-9"
    >
      {me ? <Avatar user={me} decorative /> : <Skeleton className="size-7 rounded-full" />}
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{me?.name ?? 'Profil'}</span>
    </button>
  );

  return (
    <>
      <Menu>
        <MenuTrigger render={trigger} />
        <MenuContent side={compact ? 'right' : 'top'} align={compact ? 'end' : 'start'} className="w-64">
          <MenuGroup>
            <MenuGroupLabel>Theme</MenuGroupLabel>
            <MenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeChoice)}>
              {THEMES.map(({ value, label }) => (
                <MenuRadioItem key={value} value={value}>
                  {label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
          <MenuSeparator />
          <MenuSubmenu label="Als … ansehen" icon={Users}>
            <MenuRadioGroup value={userId} onValueChange={(value) => viewAs(String(value))}>
              {people.map((person) => (
                <MenuRadioItem key={person.id} value={person.id} closeOnClick>
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar user={person} size="sm" decorative />
                    <span className="min-w-0 truncate">{person.name}</span>
                    <span className="ml-auto pl-2 text-sm text-muted">{ROLE[person.org_role]}</span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubmenu>
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel>Demo</MenuGroupLabel>
            <MenuItem icon={Radio} onClick={simulateEvent}>
              Live-Ereignis simulieren
            </MenuItem>
            <MenuItem icon={connected ? WifiOff : Wifi} onClick={() => setConnected(!connected)}>
              {connected ? 'Live-Verbindung trennen' : 'Live-Verbindung herstellen'}
            </MenuItem>
            <MenuItem icon={RotateCcw} onClick={() => setConfirmReset(true)}>
              Demo zurücksetzen …
            </MenuItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuLinkItem icon={UserRound} render={<Link to="/me" />}>
            Persönliche Einstellungen
          </MenuLinkItem>
          <MenuLinkItem icon={LogOut} render={<Link to="/login" />}>
            Abmelden
          </MenuLinkItem>
        </MenuContent>
      </Menu>
      <AlertDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Demo zurücksetzen?"
        description="Alle Änderungen im Klickdummy gehen verloren: Die Demo-Daten werden neu geladen, und Mara Lindqvist ist wieder angemeldet. Das Theme bleibt."
        confirmLabel="Demo zurücksetzen"
        onConfirm={resetDemo}
        pending={reset.isPending}
      />
    </>
  );
}
