/*
 * The shell's own shortcuts (start set of spec 5.3) and palette commands: palette and search, the shortcut help, new
 * item, undo, navigation, theme and sidebar. Screens register theirs while they are mounted (lists, the item, …).
 */

import type { LucideIcon } from 'lucide-react';
import { Eye, FolderKanban, Inbox, Keyboard, Layers, Monitor, Moon, PanelLeft, Settings, SquarePen, Sun, SunMoon, UserRound, UserRoundCheck } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { toast } from '@/components/ui/toast';
import { registerCommand, SHELL_COMMAND_GROUPS, useCommand } from '@/lib/commands';
import { usePermissions } from '@/lib/permissions';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { isWide } from '@/lib/media';
import type { ThemeChoice } from '@/lib/theme';
import { canUndo, undoLatest } from '@/lib/undo';
import { useUiStore } from '@/store/ui';

const [ACTIONS, NAVIGATION] = SHELL_COMMAND_GROUPS;
/** Group of the help overlay for the shortcuts that work everywhere. */
const GENERAL = 'Allgemein';

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon; keywords: string[] }[] = [
  { value: 'system', label: 'System', icon: Monitor, keywords: ['automatisch', 'betriebssystem'] },
  { value: 'light', label: 'Hell', icon: Sun, keywords: ['arbeitsheft', 'light', 'tag'] },
  { value: 'dark', label: 'Dunkel', icon: Moon, keywords: ['nachtheft', 'dark', 'nacht'] },
];

/** Where the navigation commands lead; the first four also have a `g` shortcut. */
const PLACES: { id: string; to: string; label: string; command: string; keys?: string; icon: LucideIcon }[] = [
  { id: 'inbox', to: '/inbox', label: 'Inbox', command: 'Inbox öffnen', keys: 'g i', icon: Inbox },
  { id: 'my-items', to: '/my-items', label: 'Meine Items', command: 'Meine Items öffnen', keys: 'g m', icon: UserRoundCheck },
  { id: 'views', to: '/views', label: 'Views', command: 'Alle Views öffnen', keys: 'g v', icon: Layers },
  { id: 'projects', to: '/projects', label: 'Projekte', command: 'Alle Projekte öffnen', keys: 'g p', icon: FolderKanban },
  { id: 'created', to: '/created', label: 'Von mir erstellt', command: 'Von mir erstellte Items öffnen', icon: SquarePen },
  { id: 'subscribed', to: '/subscribed', label: 'Beobachtet', command: 'Beobachtete Items öffnen', icon: Eye },
  { id: 'settings', to: '/settings', label: 'Einstellungen', command: 'Einstellungen öffnen', icon: Settings },
  { id: 'me', to: '/me', label: 'Persönliche Einstellungen', command: 'Persönliche Einstellungen öffnen', icon: UserRound },
];

const ui = () => useUiStore.getState();

export function useShellBindings(): void {
  const navigate = useNavigate();
  const { can, reason } = usePermissions();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);

  function createItem() {
    // already open: a second "c" must not reset what is being typed
    if (ui().createOpen) return;
    const denied = reason('item.create');
    if (denied) toast({ title: 'Kein neues Item möglich', description: denied, tone: 'error' });
    else ui().openCreate();
  }

  useShortcut({ id: 'shell.palette', keys: 'mod+k', scope: 'global', label: 'Befehlspalette und Suche', group: GENERAL, run: () => ui().setPaletteOpen(!ui().paletteOpen) });
  useShortcut({ id: 'shell.search', keys: '/', scope: 'global', label: 'Suchen', group: GENERAL, run: () => ui().setPaletteOpen(true) });
  useShortcut({ id: 'shell.help', keys: '?', scope: 'global', label: 'Alle Kürzel', group: GENERAL, run: () => ui().setHelpOpen(true) });
  useShortcut({ id: 'shell.create', keys: 'c', scope: 'global', label: 'Neues Item', group: GENERAL, run: createItem });
  useShortcut({ id: 'shell.undo', keys: 'mod+z', scope: 'global', label: 'Rückgängig, solange der Toast steht', group: GENERAL, run: () => undoLatest(), when: canUndo });
  // g i, g m, g v, g p
  useEffect(() => {
    const offs = PLACES.flatMap(({ id, keys, label, to }) =>
      keys ? [registerShortcut({ id: `shell.go.${id}`, keys, scope: 'global', label, group: NAVIGATION, run: () => navigate(to) })] : [],
    );
    return () => offs.forEach((off) => off());
  }, [navigate]);

  // hidden without the right; the shortcut "c" says why instead (toast)
  useCommand({ id: 'shell.create', label: 'Neues Item', group: ACTIONS, keys: 'c', icon: <SquarePen />, keywords: ['anlegen', 'erstellen'], run: createItem, when: () => can('item.create') });
  useCommand({
    id: 'shell.theme',
    label: 'Theme wechseln …',
    group: ACTIONS,
    icon: <SunMoon />,
    keywords: ['farbschema', ...THEMES.flatMap((theme) => [theme.label, ...theme.keywords])],
    run: () => {},
    subpage: () => ({
      placeholder: 'Theme wählen …',
      options: THEMES.map(({ value, label, icon: Icon, keywords }) => ({
        id: value,
        label,
        icon: <Icon />,
        keywords,
        hint: ui().theme === value ? 'aktiv' : undefined,
        run: () => ui().setTheme(value),
      })),
    }),
  });
  useCommand({
    id: 'shell.sidebar',
    label: collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen',
    group: ACTIONS,
    icon: <PanelLeft />,
    run: () => ui().toggleSidebar(),
    // below md the sidebar is a drawer behind the menu button
    when: isWide,
  });
  useCommand({ id: 'shell.help', label: 'Alle Tastaturkürzel', group: ACTIONS, keys: '?', icon: <Keyboard />, keywords: ['hilfe', 'kürzel', 'tastatur'], run: () => ui().setHelpOpen(true) });

  // the navigation commands, all at once (the router's navigate does not change)
  useEffect(() => {
    const offs = PLACES.map((place) =>
      registerCommand({ id: `shell.go.${place.id}`, label: place.command, group: NAVIGATION, keys: place.keys, icon: <place.icon />, run: () => navigate(place.to) }),
    );
    return () => offs.forEach((off) => off());
  }, [navigate]);
}
